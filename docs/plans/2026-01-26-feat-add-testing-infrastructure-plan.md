---
title: Add Testing Infrastructure with Vitest
type: feat
date: 2026-01-26
---

# Add Testing Infrastructure with Vitest

## Overview

Add comprehensive testing infrastructure to the tax-agent project using Vitest. This includes unit tests for LLM functions and utilities, integration tests for API routes, and tests for the Claude Agent SDK agents. The goal is to establish patterns that enable confident refactoring and catch regressions early.

## Problem Statement / Motivation

The codebase currently has **zero tests**. As the agent-based architecture grows in complexity (3 agents, 4 LLM functions, 5 API routes, multiple external integrations), the risk of regressions increases. Testing is critical for:

1. **Agent reliability** - Agents make autonomous decisions; bugs could send wrong emails or misclassify documents
2. **LLM function stability** - Prompt changes or schema updates could break structured outputs
3. **Webhook security** - Signature verification must work correctly
4. **Integration confidence** - SharePoint, Resend, Mistral integrations need isolation for testing

## Proposed Solution

Implement Vitest with a layered testing approach:

1. **Unit tests** - Pure functions, Zod schemas, email templates, LLM response parsing
2. **Integration tests** - API routes with mocked external services
3. **Agent tool tests** - Individual MCP tool handlers (isolated from Claude SDK)

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Test runner | Vitest | Native ESM, fast, Jest-compatible API, better Next.js 16 support |
| Coverage | @vitest/coverage-v8 | V8 native coverage, faster than Istanbul |
| Prisma mocking | vitest-mock-extended | Deep mocking with type safety |
| HTTP mocking | Direct module mocks | Simpler than MSW for this codebase size |
| Agent testing | Tool handler isolation | Test MCP tools directly without invoking Claude |

## Technical Approach

### Test Structure

```
tests/
├── setup.ts                          # Global setup + Prisma mock
├── helpers/
│   ├── request-factory.ts            # NextRequest helpers
│   └── fixtures.ts                   # Test data factories
├── mocks/
│   ├── prisma.ts                     # PrismaClient mock
│   ├── openai.ts                     # OpenAI SDK mock
│   ├── claude-agent-sdk.ts           # Agent SDK + generator mocks
│   ├── microsoft-graph.ts            # Graph API mock
│   ├── resend.ts                     # Email SDK mock
│   └── mistral.ts                    # Mistral OCR mock
├── unit/
│   ├── types.test.ts                 # Zod schema validation
│   ├── lib/
│   │   ├── openai.test.ts            # LLM functions
│   │   ├── email.test.ts             # Email templates + sending
│   │   ├── sharepoint.test.ts        # SharePoint utilities
│   │   └── mistral-ocr.test.ts       # OCR functions
│   └── agents/
│       ├── assessment-tools.test.ts  # Assessment agent tools
│       ├── outreach-tools.test.ts    # Outreach agent tools
│       └── reconciliation-tools.test.ts
└── integration/
    └── api/
        ├── engagements.test.ts       # GET/POST /api/engagements
        ├── typeform-webhook.test.ts  # Signature verification, dedup
        ├── poll-sharepoint.test.ts   # Cron job logic
        ├── check-reminders.test.ts   # Stale engagement detection
        └── brief.test.ts             # Brief generation
```

### Implementation Phases

#### Phase 1: Foundation

Set up Vitest configuration and mock infrastructure.

**Files to create:**
- `vitest.config.ts` - Vitest configuration with path aliases
- `tests/setup.ts` - Global setup with Prisma mock
- `tests/mocks/prisma.ts` - Type-safe Prisma mock
- `tests/mocks/openai.ts` - OpenAI SDK mock with structured output helpers
- `tests/helpers/request-factory.ts` - NextRequest/Response factories

**vitest.config.ts:**
```typescript
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/app/**/*.tsx'],
    },
  },
})
```

**tests/mocks/prisma.ts:**
```typescript
import { PrismaClient } from '@prisma/client'
import { beforeEach } from 'vitest'
import { mockDeep, mockReset, DeepMockProxy } from 'vitest-mock-extended'

export const prismaMock = mockDeep<PrismaClient>()

beforeEach(() => {
  mockReset(prismaMock)
})
```

**tests/mocks/openai.ts:**
```typescript
import { vi } from 'vitest'

export const mockOpenAI = {
  chat: {
    completions: {
      parse: vi.fn(),
      create: vi.fn(),
    },
  },
}

export function mockStructuredOutput<T>(data: T) {
  mockOpenAI.chat.completions.parse.mockResolvedValue({
    choices: [{ message: { parsed: data } }],
  })
}
```

#### Phase 2: Unit Tests

Test pure functions and LLM response parsing.

**tests/unit/types.test.ts:**
```typescript
import { describe, it, expect } from 'vitest'
import { ChecklistItemSchema, DocumentSchema } from '@/types'

describe('Zod Schemas', () => {
  describe('ChecklistItemSchema', () => {
    it('should validate a valid checklist item', () => {
      const item = {
        id: '1',
        description: 'W-2 Form',
        priority: 'high',
        received: false,
      }
      expect(ChecklistItemSchema.safeParse(item).success).toBe(true)
    })

    it('should reject invalid priority', () => {
      const item = { id: '1', description: 'W-2', priority: 'urgent' }
      expect(ChecklistItemSchema.safeParse(item).success).toBe(false)
    })
  })
})
```

**tests/unit/lib/openai.test.ts:**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockOpenAI, mockStructuredOutput } from '../../mocks/openai'

vi.mock('openai', () => ({ default: vi.fn(() => mockOpenAI) }))

import { generateChecklist, classifyDocument } from '@/lib/openai'

describe('generateChecklist', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should generate checklist from intake data', async () => {
    mockStructuredOutput({
      items: [
        { id: '1', description: 'W-2 Form', priority: 'high' },
      ],
    })

    const result = await generateChecklist({
      employmentType: 'W2',
      hasInvestments: false,
    })

    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('W-2 Form')
  })

  it('should handle empty intake gracefully', async () => {
    mockStructuredOutput({ items: [] })
    const result = await generateChecklist({})
    expect(result).toEqual([])
  })
})
```

#### Phase 3: Agent Tool Tests

Test MCP tool handlers in isolation (without invoking Claude).

**tests/mocks/claude-agent-sdk.ts:**
```typescript
import { vi } from 'vitest'

// Mock async generator for query()
export function createMockQueryGenerator(messages: unknown[]) {
  return (async function* () {
    for (const msg of messages) yield msg
  })()
}

export const mockQuery = vi.fn()

export function mockQueryResponse(messages: unknown[]) {
  mockQuery.mockReturnValue(createMockQueryGenerator(messages))
}
```

**tests/unit/agents/assessment-tools.test.ts:**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '../../mocks/prisma'

vi.mock('@/lib/prisma', () => ({ default: prismaMock }))
vi.mock('@/lib/mistral-ocr', () => ({
  extractDocument: vi.fn().mockResolvedValue({
    text: 'W-2 Wage and Tax Statement',
    fields: { employer: 'Acme Corp', wages: 50000 },
  }),
}))

// Import the tool handlers directly from the agent
import { assessmentServer } from '@/lib/agents/assessment'

describe('Assessment Agent Tools', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('extract_document tool', () => {
    it('should extract document content using Mistral OCR', async () => {
      const extractTool = assessmentServer.tools.find(
        t => t.name === 'extract_document'
      )

      prismaMock.engagement.findUnique.mockResolvedValue({
        id: 'eng-1',
        documents: [{ id: 'doc-1', fileName: 'w2.pdf' }],
      })

      const result = await extractTool.handler({
        engagementId: 'eng-1',
        documentId: 'doc-1',
      })

      expect(result).toContain('W-2 Wage and Tax Statement')
    })
  })

  describe('classify_document tool', () => {
    it('should classify document based on extracted text', async () => {
      const classifyTool = assessmentServer.tools.find(
        t => t.name === 'classify_document'
      )

      const result = await classifyTool.handler({
        engagementId: 'eng-1',
        documentId: 'doc-1',
        extractedText: 'W-2 Wage and Tax Statement for John Doe',
      })

      expect(result).toMatch(/W-2|wage/i)
    })
  })
})
```

#### Phase 4: Integration Tests

Test API routes with mocked dependencies.

**tests/helpers/request-factory.ts:**
```typescript
export function createMockRequest(
  url: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Request {
  return new Request(url, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
}
```

**tests/integration/api/typeform-webhook.test.ts:**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import { prismaMock } from '../../mocks/prisma'
import { createMockRequest } from '../../helpers/request-factory'

vi.mock('@/lib/prisma', () => ({ default: prismaMock }))
vi.mock('@/lib/openai', () => ({
  generateChecklist: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/agents/dispatcher', () => ({
  dispatch: vi.fn(),
}))

import { POST } from '@/app/api/webhooks/typeform/route'

describe('POST /api/webhooks/typeform', () => {
  const secret = 'test-secret'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('TYPEFORM_WEBHOOK_SECRET', secret)
  })

  function signPayload(payload: string): string {
    return `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('base64')}`
  }

  it('should reject invalid signature', async () => {
    const request = createMockRequest('http://localhost/api/webhooks/typeform', {
      method: 'POST',
      body: { form_response: { form_id: 'test' } },
      headers: { 'typeform-signature': 'invalid' },
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('should process valid webhook and generate checklist', async () => {
    const body = JSON.stringify({
      form_response: {
        form_id: 'form-123',
        answers: [{ field: { id: 'q1' }, text: 'W2 employee' }],
      },
    })

    prismaMock.engagement.findFirst.mockResolvedValue({
      id: 'eng-1',
      typeformId: 'form-123',
      status: 'PENDING',
    })
    prismaMock.engagement.update.mockResolvedValue({
      id: 'eng-1',
      status: 'INTAKE_DONE',
    })

    const request = createMockRequest('http://localhost/api/webhooks/typeform', {
      method: 'POST',
      body: JSON.parse(body),
      headers: { 'typeform-signature': signPayload(body) },
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(prismaMock.engagement.update).toHaveBeenCalled()
  })
})
```

**tests/integration/api/engagements.test.ts:**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '../../mocks/prisma'
import { createMockRequest } from '../../helpers/request-factory'

vi.mock('@/lib/prisma', () => ({ default: prismaMock }))
vi.mock('@/lib/agents/dispatcher', () => ({ dispatch: vi.fn() }))

import { GET, POST } from '@/app/api/engagements/route'

describe('/api/engagements', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('GET', () => {
    it('should return all engagements', async () => {
      prismaMock.engagement.findMany.mockResolvedValue([
        { id: '1', clientName: 'Client A', status: 'PENDING' },
        { id: '2', clientName: 'Client B', status: 'READY' },
      ])

      const request = createMockRequest('http://localhost/api/engagements')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveLength(2)
    })
  })

  describe('POST', () => {
    it('should create engagement and dispatch welcome event', async () => {
      prismaMock.engagement.create.mockResolvedValue({
        id: 'new-1',
        clientName: 'New Client',
        status: 'PENDING',
      })

      const request = createMockRequest('http://localhost/api/engagements', {
        method: 'POST',
        body: {
          clientName: 'New Client',
          clientEmail: 'new@example.com',
          typeformId: 'form-1',
          sharePointUrl: 'https://sharepoint.com/folder',
        },
      })

      const response = await POST(request)
      expect(response.status).toBe(201)
    })

    it('should return 400 for invalid request body', async () => {
      const request = createMockRequest('http://localhost/api/engagements', {
        method: 'POST',
        body: { clientName: '' }, // missing required fields
      })

      const response = await POST(request)
      expect(response.status).toBe(400)
    })
  })
})
```

## Acceptance Criteria

### Functional Requirements

- [x] Vitest runs with `npm test` command
- [x] All mocks correctly isolate external dependencies
- [x] Unit tests cover:
  - [x] Zod schema validation (src/types.ts)
  - [x] LLM functions: generateChecklist, classifyDocument, reconcile, generatePrepBrief
  - [ ] Email template rendering (deferred - lower priority)
  - [ ] SharePoint URL parsing (deferred - lower priority)
- [ ] Agent tool tests cover:
  - [ ] Assessment agent tools (extract, classify, validate, flag) - deferred
  - [ ] Outreach agent tools (send_email, get_missing_documents) - deferred
  - [ ] Reconciliation agent tools (match, calculate_completion) - deferred
- [x] Integration tests cover:
  - [x] POST /api/engagements (create)
  - [x] GET /api/engagements (list)
  - [x] POST /api/webhooks/typeform (signature verification + processing)
  - [ ] GET /api/cron/poll-sharepoint (cron authorization) - deferred
  - [ ] GET /api/cron/check-reminders - deferred
  - [ ] GET /api/engagements/[id]/brief - deferred

### Non-Functional Requirements

- [x] Test execution completes in under 30 seconds
- [x] Coverage report generated in HTML format
- [x] No flaky tests (deterministic mocks, no real network calls)

### Quality Gates

- [x] Minimum 70% line coverage on src/lib/** (100% on openai.ts, types.ts, dispatcher.ts)
- [x] All critical paths tested (webhook signature, agent tools)
- [x] TypeScript strict mode passes on test files

## Dependencies & Prerequisites

**Install these packages:**
```bash
npm install -D vitest @vitest/coverage-v8 vite-tsconfig-paths vitest-mock-extended
```

**No changes required to:**
- Production code (tests run in isolation)
- Database schema
- Environment variables (tests use stubs)

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Claude Agent SDK mocking complexity | Medium | High | Test tool handlers directly, not full agent runs |
| Async generator edge cases | Low | Medium | Use controlled mock generator factory |
| Test isolation failures | Low | High | Reset all mocks in beforeEach, use vitest-mock-extended |
| Coverage gaps in agents | Medium | Medium | Prioritize tool handler tests over runner tests |

## Success Metrics

- **Immediate:** `npm test` passes with all tests green
- **Short-term:** Coverage report shows 70%+ on lib/ directory
- **Long-term:** Zero regressions introduced in subsequent PRs

## SpecFlow Analysis: Additional Test Scenarios

The following edge cases and error scenarios were identified during spec analysis and should be included:

### Error Handling Tests (High Priority)

| Scenario | Test |
|----------|------|
| OpenAI API rate limit (429) | LLM functions should handle gracefully |
| OpenAI API server error (500) | LLM functions should handle gracefully |
| Mistral OCR failure + fallback | Assessment tool should use fallback content |
| Claude Agent SDK query timeout | Agent runner should catch and log error |
| Email send failure + retry | Outreach tool should retry with backoff |

### Concurrency Tests (Medium Priority)

| Scenario | Test |
|----------|------|
| Concurrent document updates | Two agents updating same documents array |
| Webhook deduplication | Same event_id submitted twice |
| Cron job overlap detection | Poll-sharepoint running longer than 5 min |

### Agent Tool Edge Cases

**Assessment Agent:**
- `extract_document` with missing SharePoint config → error message
- `extract_document` with OCR failure → fallback content returned
- `flag_issue` with duplicate issue text → idempotent (no duplicate)
- `cross_validate` with empty documents array → appropriate message

**Outreach Agent:**
- `send_email` with invalid template type → error
- `schedule_reminder` behavior (updates lastActivityAt, not actual scheduling)
- `get_missing_documents` with no checklist → appropriate message

**Reconciliation Agent:**
- `match_document_to_item` with non-existent checklist item → error
- `calculate_completion` with empty checklist → 0%
- `calculate_completion` priority weighting (high=50%, medium=35%, low=15%)
- `check_ready` when high-priority items complete but has issues → not ready

### Dispatcher Event Routing

| Test | Expected Behavior |
|------|-------------------|
| `engagement_created` event | Routes to Outreach Agent |
| `intake_complete` event | Routes to Outreach Agent |
| `document_uploaded` event | Routes to Assessment Agent |
| `document_assessed` event | Routes to Reconciliation Agent (if no issues) |
| `stale_engagement` event | Routes to Outreach Agent |
| Unknown event type | Logs warning, no crash |
| Event chaining failure | First event complete, second fails → logged |

### API Route Error Scenarios

**Typeform Webhook:**
- Missing `typeform-signature` header → 401
- Valid signature but engagement not found → 200 (log error, no crash)
- Missing `engagement_id` in hidden fields → 400

**Cron Endpoints:**
- Missing `CRON_SECRET` header → 401
- Invalid `CRON_SECRET` → 401
- Engagement with null SharePoint IDs → skipped

**Brief Generation:**
- Engagement status != READY → 400
- Engagement not found → 404

## References

### Internal References

- Agent implementations: `src/lib/agents/*.ts`
- LLM functions: `src/lib/openai.ts:1-150`
- API routes: `src/app/api/*/route.ts`
- Type definitions: `src/types.ts`

### External References

- [Vitest Documentation](https://vitest.dev/)
- [Next.js Testing with Vitest](https://nextjs.org/docs/app/guides/testing/vitest)
- [Prisma Mocking Guide](https://www.prisma.io/blog/testing-series-1-8eRB5p0Y8o)
- [vitest-mock-extended](https://github.com/eratio08/vitest-mock-extended)
