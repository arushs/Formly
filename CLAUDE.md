# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (all-in-one with Docker Compose)
./bin/dev                                      # Start everything (API + Web + PostgreSQL)
./bin/dev --tunnel                             # Start with Cloudflare tunnel for webhooks
docker compose down                            # Stop all services
docker compose logs -f api                     # Tail API logs
docker compose logs -f web                     # Tail web logs

# Services (after running ./bin/dev)
# - API:        http://localhost:3009
# - Web:        http://localhost:3010
# - PostgreSQL: localhost:5432
# - Tunnel:     https://xxx.ngrok-free.app (when --tunnel enabled)
# - ngrok UI:   http://localhost:4040 (inspect requests)

# Database (run inside api container or locally with DATABASE_URL set)
docker compose exec api npx prisma studio      # Open Prisma Studio
docker compose exec api npx prisma db push     # Push schema changes
docker compose exec api npx prisma generate    # Regenerate client

# Build for production
cd apps/api && npm run build
cd apps/web && npm run build

# Testing
cd apps/api && npm test              # Run API tests (194 tests)
cd apps/web && npm test              # Run Web tests (67 tests)
cd apps/api && npm run test:coverage # API coverage report
cd apps/web && npm run test:coverage # Web coverage report
cd apps/web && npx playwright test   # E2E tests (requires app running)

# Deploy to Render
git push origin production                     # Auto-deploys via render.yaml (NOT main/master)
```

## Architecture

Tax Intake Agent - an automated document collection system for tax accountants.

### Data Flow

1. **Engagement Creation** → UI creates engagement with client info, storage folder URL (SharePoint or Google Drive), Typeform ID
2. **Intake Processing** → Typeform webhook receives client responses, LLM generates document checklist
3. **Document Collection** → Cron polls storage (SharePoint or Google Drive), downloads new files, LLM classifies each document
4. **Reconciliation** → LLM matches documents to checklist items, calculates completion percentage
5. **Brief Generation** → When 100% complete, accountant can generate prep brief via LLM

### Status Flow

`PENDING` → `INTAKE_DONE` → `COLLECTING` → `READY`

### Single Model Design

All data lives in one `Engagement` model with JSONB columns:
- `intakeData` - Raw Typeform responses
- `checklist` - Generated document checklist (`ChecklistItem[]`)
- `documents` - Classified documents (`Document[]`)
- `reconciliation` - Matching results and completion status

### Key Files (Monorepo Structure)

**API (`apps/api/src/`):**
- `routes/engagements.ts` - CRUD operations for engagements
- `routes/documents.ts` - Document approval, reclassification, email preview
- `routes/webhooks.ts` - Typeform webhook handler
- `routes/cron.ts` - Cron endpoints (poll-storage, check-reminders, retry-stuck)
- `lib/openai.ts` - LLM functions: `generateChecklist`, `classifyDocument`, `reconcile`, `generatePrepBrief`
- `lib/storage/` - Storage provider abstraction (SharePoint, Google Drive, Dropbox)
- `lib/agents/assessment.ts` - Document assessment agent
- `lib/agents/dispatcher.ts` - Event dispatch for agent workflows
- `lib/agents/reconciliation.ts` - Document-checklist matching agent
- `lib/issues.ts` - Issue string parsing and helpers
- `scheduler.ts` - node-cron job definitions
- `index.ts` - Hono app entry point
- `test/` - Test factories, mocks, and setup

**Web (`apps/web/src/`):**
- `pages/Dashboard.tsx` - Main engagement list
- `pages/NewEngagement.tsx` - Create engagement form
- `pages/EngagementDetail.tsx` - Single engagement view
- `api/client.ts` - API client functions
- `utils/issues.ts` - Frontend issue parsing utilities

### Background Processing

Uses `node-cron` for scheduled jobs (runs in the same container):
- Every 2 minutes: Poll storage for new documents
- Daily at 9 AM: Send reminder emails
- Every minute: Retry stuck documents (in_progress > 5 min)

## Environment Variables

Required in `.env`:
- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` - For GPT-4o structured outputs
- `MISTRAL_API_KEY` - For Mistral OCR document extraction
- `TYPEFORM_WEBHOOK_SECRET` - HMAC signature verification
- `CRON_SECRET` - Vercel cron authorization
- `RESEND_API_KEY` - For sending emails via Resend
- `EMAIL_FROM` - Sender email address (e.g., noreply@yourdomain.com)
- `ACCOUNTANT_EMAIL` - Email address for accountant notifications

### Storage Provider (configure one or more)

**SharePoint:**
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`

**Google Drive:**
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` - e.g., `tax-agent@project.iam.gserviceaccount.com`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` - Private key (use `\n` for newlines)

**Dropbox:**
- `DROPBOX_APP_KEY` - App key from Dropbox App Console
- `DROPBOX_APP_SECRET` - App secret
- `DROPBOX_ACCESS_TOKEN` - Long-lived access token (or use refresh token)
- `DROPBOX_REFRESH_TOKEN` - Optional, for token refresh

## Learnings & Gotchas

### Hosting Platform Comparison

When migrating from Vercel, consider these alternatives:

| Platform | Free Postgres | Free Cron | Best For |
|----------|--------------|-----------|----------|
| Vercel | No (need Neon/Supabase) | 2 jobs, 1x/day max | Next.js apps |
| Railway | Yes ($5/mo credit) | Yes | Simple backend apps |
| Fly.io | No (removed) | DIY in container | Long-running processes, WebSockets |
| Render | 90 days only | Paid only | Simple deploy, native cron (paid) |
| Cloudflare Workers | D1 (SQLite) free | Yes, free | Edge compute, requires code rewrite |

**Railway** is the easiest path for backend apps with cron jobs and Postgres.

### Typeform API

**Creating Forms Programmatically**: When using the Typeform Create API:
- Welcome/thank you screens go in separate `welcome_screens` and `thankyou_screens` arrays
- Each choice option requires a `ref` property (not just `label`)
- Number validations go in `validations`, not `properties`
- Logic jumps are easier to configure in the Typeform UI after creation

**Webhook Setup**: After creating a form via API, configure the webhook manually:
1. Go to Connect > Webhooks in Typeform
2. Add your endpoint URL (e.g., `https://yourdomain.com/api/webhooks/typeform`)
3. Generate and save the webhook secret to `TYPEFORM_WEBHOOK_SECRET`

### Monorepo Migration Pattern (Next.js → Hono + React)

If migrating from Next.js to a simpler backend (Hono/Express) + React SPA:

**Directory Structure:**
```
apps/
  api/           # Hono backend
    src/
      routes/    # API endpoints
      agents/    # Background processing
      lib/       # Shared utilities
      index.ts   # Entry point with scheduler
    Dockerfile
  web/           # React frontend (Vite)
    src/
      pages/
      components/
    Dockerfile
packages/
  shared/        # Shared types, utilities
```

**Key Patterns:**
- Use `node-cron` for scheduling in Hono instead of Vercel cron
- Extract Next.js API routes to Hono routes (`app.get()`, `app.post()`)
- Move `src/lib/` to `apps/api/src/lib/` (business logic)
- Create React SPA pages from Next.js pages (remove `use client`, add React Router)
- Use Docker Compose for local dev (`Dockerfile.dev` for each service with hot reload)

### Docker Local Development

**Full Stack with Docker Compose**: The dev environment runs all services in containers with hot reload:

```yaml
# docker-compose.yml services:
postgres:  # PostgreSQL 16, healthcheck enabled
api:       # Hono API with tsx watch (Dockerfile.dev)
web:       # Vite React with HMR (Dockerfile.dev)
```

**Volume Mounts for Hot Reload**:
- `apps/api/src` and `apps/api/prisma` are mounted into the API container
- `apps/web/src` and `apps/web/index.html` are mounted into the web container
- Changes to source files trigger automatic reload

**Database Commands** (run inside container):
```bash
docker compose exec api npx prisma generate    # Regenerate client after schema changes
docker compose exec api npx prisma db push     # Push schema to database
docker compose exec api npx prisma studio      # Visual database browser
```

**Rebuilding Containers** (after package.json changes):
```bash
docker compose up --build
```

**Database Sync Issues**: If you get "column not found" errors, the schema is out of sync:
```bash
docker compose exec api npx prisma db push
```

### Render Deployment (added 2026-01-31)

**render.yaml Configuration**: When deploying a monorepo with separate API and web services:
```yaml
databases:
  - name: tax-agent-db
    plan: free

services:
  - type: web
    name: tax-agent-api
    runtime: docker
    dockerfilePath: ./apps/api/Dockerfile
    dockerContext: ./apps/api
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: tax-agent-db
          property: connectionString
      - key: FRONTEND_URL
        fromService:
          name: tax-agent-web
          type: web
          property: host
```

**Common Deployment Error**: "Unexpected token '<'" means the API is returning HTML (likely a 404 from the frontend) instead of JSON. Check:
1. API routes are correctly configured
2. CORS allows the frontend origin
3. API URL environment variable points to the correct service

### Dropbox Integration (added 2026-01-31)

**Shared Folders Require Special Handling**: When accessing files in Dropbox shared folders:
- Use `shared_link` parameter in API calls
- The folder ID from shared link URL differs from regular folder paths
- Example shared folder ID format: `id:vuUpKVsJxuEAAAAAAAAD_A`

**Token Refresh Flow**: Dropbox access tokens expire. Implement OAuth refresh:
1. Store both `DROPBOX_ACCESS_TOKEN` and `DROPBOX_REFRESH_TOKEN`
2. When `expired_access_token` error occurs, use refresh token to get new access token
3. OAuth authorization URL: `https://www.dropbox.com/oauth2/authorize?client_id={app_key}&response_type=code&token_access_type=offline`
4. Exchange code for tokens: POST to `https://api.dropboxapi.com/oauth2/token`

### Document Processing Patterns (added 2026-01-31)

**Three-State Model for Resilient Processing**: To handle container restarts and interrupted processing:
```typescript
// Document states
type ProcessingStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

// Before processing
document.processingStatus = 'in_progress'
document.processingStartedAt = new Date().toISOString()

// Cron retry for stuck documents (in_progress > 5 minutes)
const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
const stuckDocs = documents.filter(d =>
  d.processingStatus === 'in_progress' &&
  d.processingStartedAt < fiveMinutesAgo
)
```

**Generic Storage Client Pattern**: Use a storage abstraction instead of provider-specific code:
```typescript
import { getStorageClient, type StorageProvider } from '../storage/index.js'

// In document processing
const client = getStorageClient(provider) // 'sharepoint' | 'googledrive' | 'dropbox'
const { buffer, mimeType, fileName } = await client.downloadFile(itemId, driveId)
```

### Typeform Webhook (added 2026-01-31)

**HMAC Signature Verification**: Typeform uses **base64** encoding (not hex):
```typescript
const hash = crypto.createHmac('sha256', secret).update(payload).digest('base64')
```

**Programmatic Webhook Setup**: After creating a form via API, create webhook via API:
```bash
curl -X PUT "https://api.typeform.com/forms/{form_id}/webhooks/{tag}" \
  -H "Authorization: Bearer {token}" \
  -d '{"url": "https://yourapi.com/webhooks/typeform", "enabled": true}'
```

**Debugging Missing Signature Header** (added 2026-02-02): If `typeform-signature` header is missing entirely (not just invalid), the webhook secret isn't configured in Typeform:
1. Go to form → **Connect** → **Webhooks**
2. Click on your webhook endpoint
3. Find the **Secret** field and set a value
4. Copy that exact value to `.env` as `TYPEFORM_WEBHOOK_SECRET`

Debug with header logging:
```typescript
console.log('[WEBHOOK] Headers:', Object.fromEntries(c.req.raw.headers.entries()))
```

### Parseable Issue String Format (added 2026-01-31)

**Structured Data in Strings**: Store structured data as parseable strings to avoid schema bloat while keeping data queryable:
```typescript
// Format: [SEVERITY:TYPE:EXPECTED:DETECTED] Human-readable description
const issue = "[ERROR:wrong_year:2025:2024] Document is from 2024, expected 2025"
const issue2 = "[WARNING:low_confidence::] Classification confidence below 70%"

// Parser function derives severity/expected/detected at render time
export function parseIssue(issue: string): ParsedIssue {
  const match = issue.match(/^\[(\w+):(\w+):([^:]*):([^\]]*)\]\s*(.+)$/)
  if (!match) return { severity: 'warning', type: 'other', expected: null, detected: null, description: issue }

  const [, severity, type, expected, detected, description] = match
  return { severity: severity.toLowerCase(), type, expected: expected || null, detected: detected || null, description }
}
```

**Benefits over JSON/nested objects**:
- Human-readable in database/logs
- No schema migration for new issue types
- Easy to grep/search
- Backwards compatible (parser handles legacy formats)

### Document Review UI Patterns (added 2026-01-31)

**Split-View with URL State**: Use URL query params for selection state instead of React state:
```tsx
// URL: /engagements/[id]?doc=[docId]
// Benefits: shareable, bookmarkable, works with browser back button
interface Props {
  params: { id: string }
  searchParams: { doc?: string }
}

const selectedDoc = searchParams.doc
  ? documents.find(d => d.id === searchParams.doc)
  : null
```

**Simple Approval Model**: Prefer boolean + timestamp over complex status enums:
```typescript
// Instead of: reviewStatus: 'pending' | 'approved' | 'rejected' | 'needs_clarification'
// Use:
approved: z.boolean().nullable().default(null)  // null = not reviewed, true = approved
approvedAt: z.string().nullable().default(null)

// "Resolved" = no issues OR explicitly approved
const isResolved = (doc) => doc.issues.length === 0 || doc.approved === true
```

**Override Pattern for Reclassification**: Track original values when users override system decisions:
```typescript
override: z.object({
  originalType: z.string(),  // What AI classified it as
  reason: z.string(),        // Why user changed it
}).nullable().default(null)
```

### Shared Constants Pattern (added 2026-01-31)

**Export Constants from Types**: Define allowed values once and derive types from them:
```typescript
// src/types.ts
export const DOCUMENT_TYPES = ['W-2', '1099-NEC', '1099-MISC', '1099-INT', 'K-1', 'RECEIPT', 'STATEMENT', 'OTHER'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

// Usage in components - enables runtime validation AND type safety
if (!DOCUMENT_TYPES.includes(newType as any)) {
  throw new Error('Invalid document type')
}
```

### Dropbox Download Simplification (added 2026-01-31)

**Use `downloadZip` for Shared Folders**: When downloading from Dropbox shared folders, `downloadZip` is simpler than `download` for single files:
```typescript
// The downloadZip endpoint handles shared folder permissions better
const response = await this.client.filesDownloadZip({ path: folderPath })
// Then extract the single file from the zip
```

**Logging for Storage Operations**: Add detailed logging for debugging storage issues:
```typescript
console.log(`[DROPBOX] Listing folder: ${path}`)
console.log(`[DROPBOX] Found ${entries.length} entries`)
console.log(`[DROPBOX] Downloading: ${entry.name} (${entry.size} bytes)`)
```

### Render Deployment Branch (added 2026-02-04)

**CRITICAL: Render deploys from `production` branch, not `master`**. When pushing fixes:
```bash
# Wrong - this won't trigger a deploy
git push origin master

# Correct - merge to production and push
git checkout production && git merge master --no-edit && git push origin production
git checkout master
```

The `render.yaml` `preDeployCommand` runs BEFORE the Docker container starts. If you need Prisma flags like `--accept-data-loss`, add them there, not in `docker-entrypoint.sh`.

### Dropbox Cursor Reset (added 2026-02-04)

**Handle 409 "reset" errors**: Dropbox cursors (storagePageToken) can expire. When this happens, `filesListFolderContinue` returns a 409 error with `error_summary: 'reset/'`. Handle by catching and falling through to fresh sync:
```typescript
try {
  await dbx.filesListFolderContinue({ cursor: pageToken })
} catch (error) {
  if (error.status === 409 && error.error?.error_summary?.includes('reset')) {
    console.log('[DROPBOX] Cursor expired, restarting sync from scratch')
    // Fall through to initial sync
  } else {
    throw error
  }
}
