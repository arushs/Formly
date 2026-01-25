---
title: "Tax Intake Agent Demo MVP"
type: feat
date: 2026-01-25
status: draft
tech_stack:
  - Next.js 14 (App Router)
  - TypeScript
  - Prisma (PostgreSQL)
  - OpenAI (gpt-4o)
  - Microsoft Graph API (SharePoint)
  - Typeform Webhooks
---

# Tax Intake Agent Demo MVP

> **DEMO ONLY** - This is a proof-of-concept. Not production-ready.

## Overview

Demonstrate LLM-driven tax document intake: Typeform questionnaire → checklist generation → SharePoint document classification → reconciliation → accountant prep brief.

**Hard Constraint**: All interpretation is LLM-driven. No deterministic rules.

## Demo Flow

1. Create engagement with SharePoint folder + Typeform ID
2. Client completes Typeform → webhook triggers checklist generation
3. Client uploads docs to SharePoint → cron polls and classifies
4. LLM reconciles documents against checklist
5. Generate prep brief for accountant

---

## Data Model (Single Table)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Engagement {
  id                  String   @id @default(cuid())
  clientName          String
  clientEmail         String
  taxYear             Int
  status              String   @default("PENDING") // PENDING | INTAKE_DONE | COLLECTING | READY

  // External references
  sharepointFolderUrl String
  sharepointDriveId   String?
  sharepointFolderId  String?
  typeformFormId      String
  deltaLink           String?  // SharePoint delta token

  // All data as JSONB
  intakeData          Json?    @db.JsonB  // Raw + normalized Typeform response
  checklist           Json?    @db.JsonB  // Array of ChecklistItem
  documents           Json?    @db.JsonB  // Array of Document records
  reconciliation      Json?    @db.JsonB  // Latest reconciliation result
  prepBrief           String?  @db.Text   // Markdown brief

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

### TypeScript Types

```typescript
// src/types.ts
import { z } from 'zod'

export const ChecklistItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  why: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  status: z.enum(['pending', 'received', 'complete']),
  documentIds: z.array(z.string()),
})

export const DocumentSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  sharepointItemId: z.string(),
  documentType: z.string(),
  confidence: z.number(),
  taxYear: z.number().nullable(),
  issues: z.array(z.string()),
  classifiedAt: z.string(),
})

export const ReconciliationSchema = z.object({
  completionPercentage: z.number(),
  itemStatuses: z.array(z.object({
    itemId: z.string(),
    status: z.enum(['pending', 'received', 'complete']),
    documentIds: z.array(z.string()),
  })),
  issues: z.array(z.string()),
  ranAt: z.string(),
})

export type ChecklistItem = z.infer<typeof ChecklistItemSchema>
export type Document = z.infer<typeof DocumentSchema>
export type Reconciliation = z.infer<typeof ReconciliationSchema>
```

---

## Directory Structure

```
src/
├── app/
│   ├── page.tsx                      # Simple home/list
│   ├── engagements/
│   │   ├── new/page.tsx              # Create form
│   │   └── [id]/page.tsx             # Detail view
│   └── api/
│       ├── webhooks/typeform/route.ts
│       └── cron/poll-sharepoint/route.ts
├── lib/
│   ├── prisma.ts
│   ├── openai.ts                     # Direct OpenAI calls
│   └── sharepoint.ts                 # Graph API helpers
└── types.ts
```

---

## Implementation

### 1. Typeform Webhook

```typescript
// src/app/api/webhooks/typeform/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { generateChecklist } from '@/lib/openai'

// In-memory dedup for demo (resets on deploy)
const processedEvents = new Set<string>()

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('typeform-signature')

  // Verify signature
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const payload = JSON.parse(rawBody)
  const eventId = payload.event_id

  // Simple dedup
  if (processedEvents.has(eventId)) {
    return NextResponse.json({ status: 'duplicate' })
  }
  processedEvents.add(eventId)

  const engagementId = payload.form_response?.hidden?.engagement_id
  if (!engagementId) {
    return NextResponse.json({ error: 'Missing engagement_id' }, { status: 400 })
  }

  // Process in background
  waitUntil(processIntake(engagementId, payload.form_response))

  return NextResponse.json({ status: 'processing' })
}

async function processIntake(engagementId: string, formResponse: unknown) {
  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId },
  })

  if (!engagement) {
    console.error(`Engagement not found: ${engagementId}`)
    return
  }

  // Generate checklist via LLM
  const checklist = await generateChecklist(formResponse, engagement.taxYear)

  await prisma.engagement.update({
    where: { id: engagementId },
    data: {
      status: 'INTAKE_DONE',
      intakeData: formResponse,
      checklist,
    },
  })

  console.log(`[INTAKE] Generated ${checklist.length} checklist items for ${engagementId}`)
}

function verifySignature(payload: string, signature: string | null): boolean {
  if (!signature) return false
  const secret = process.env.TYPEFORM_WEBHOOK_SECRET!
  const hash = crypto.createHmac('sha256', secret).update(payload).digest('base64')
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(`sha256=${hash}`)
  )
}
```

### 2. SharePoint Polling (Cron)

```typescript
// src/app/api/cron/poll-sharepoint/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/prisma'
import { syncFolder, downloadFile } from '@/lib/sharepoint'
import { classifyDocument, reconcile } from '@/lib/openai'
import { DocumentSchema, type Document } from '@/types'

export async function GET(request: NextRequest) {
  // Verify cron secret
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const engagements = await prisma.engagement.findMany({
    where: { status: { in: ['INTAKE_DONE', 'COLLECTING'] } },
  })

  // Process all in background
  waitUntil(Promise.all(engagements.map(pollEngagement)))

  return NextResponse.json({ queued: engagements.length })
}

async function pollEngagement(engagement: { id: string; sharepointDriveId: string | null; sharepointFolderId: string | null; deltaLink: string | null; checklist: unknown; documents: unknown }) {
  if (!engagement.sharepointDriveId || !engagement.sharepointFolderId) return

  const { items, newDeltaLink } = await syncFolder(
    engagement.sharepointDriveId,
    engagement.sharepointFolderId,
    engagement.deltaLink
  )

  const existingDocs = (engagement.documents as Document[]) || []
  const existingIds = new Set(existingDocs.map(d => d.sharepointItemId))

  // Process new files
  const newFiles = items.filter(item => item.file && !item.deleted && !existingIds.has(item.id!))

  for (const file of newFiles) {
    const content = await downloadFile(engagement.sharepointDriveId!, file.id!)
    const classification = await classifyDocument(content, file.name!)

    const newDoc: Document = {
      id: crypto.randomUUID(),
      fileName: file.name!,
      sharepointItemId: file.id!,
      documentType: classification.documentType,
      confidence: classification.confidence,
      taxYear: classification.taxYear,
      issues: classification.issues,
      classifiedAt: new Date().toISOString(),
    }

    existingDocs.push(newDoc)
  }

  // Run reconciliation
  const checklist = engagement.checklist as ChecklistItem[]
  const reconciliation = await reconcile(checklist, existingDocs)

  const newStatus = reconciliation.completionPercentage === 100 ? 'READY' : 'COLLECTING'

  await prisma.engagement.update({
    where: { id: engagement.id },
    data: {
      deltaLink: newDeltaLink,
      documents: existingDocs,
      reconciliation,
      status: newStatus,
    },
  })

  console.log(`[POLL] ${engagement.id}: ${newFiles.length} new docs, ${reconciliation.completionPercentage}% complete`)
}
```

### 3. OpenAI Integration (Direct Calls)

```typescript
// src/lib/openai.ts
import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { ChecklistItemSchema, type ChecklistItem, type Document } from '@/types'

const openai = new OpenAI()
const MODEL = 'gpt-4o-2024-08-06'

export async function generateChecklist(intakeData: unknown, taxYear: number): Promise<ChecklistItem[]> {
  const response = await openai.chat.completions.parse({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `You are a tax document intake specialist. Generate a checklist of documents needed based on the client's intake form responses. Tax year: ${taxYear}. For each item include: id (item_001, etc), title, why (client-friendly explanation), priority (high/medium/low). Set status to "pending" and documentIds to empty array.`,
      },
      { role: 'user', content: JSON.stringify(intakeData) },
    ],
    response_format: zodResponseFormat(
      z.object({ items: z.array(ChecklistItemSchema) }),
      'checklist'
    ),
    temperature: 0,
  })

  const parsed = response.choices[0]?.message?.parsed
  if (!parsed) {
    throw new Error('Failed to generate checklist: empty response')
  }
  return parsed.items
}

export async function classifyDocument(content: string, fileName: string): Promise<{
  documentType: string
  confidence: number
  taxYear: number | null
  issues: string[]
}> {
  const ClassificationSchema = z.object({
    documentType: z.string(),
    confidence: z.number(),
    taxYear: z.number().nullable(),
    issues: z.array(z.string()),
  })

  const response = await openai.chat.completions.parse({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Classify this tax document. Identify type (W-2, 1099-NEC, 1099-MISC, K-1, RECEIPT, STATEMENT, OTHER), confidence (0-1), tax year, and any issues (wrong year, missing info, etc).',
      },
      { role: 'user', content: `File: ${fileName}\n\nContent:\n${content.slice(0, 10000)}` },
    ],
    response_format: zodResponseFormat(ClassificationSchema, 'classification'),
    temperature: 0,
  })

  const parsed = response.choices[0]?.message?.parsed
  if (!parsed) {
    throw new Error('Failed to classify document: empty response')
  }
  return parsed
}

export async function reconcile(checklist: ChecklistItem[], documents: Document[]): Promise<{
  completionPercentage: number
  itemStatuses: { itemId: string; status: 'pending' | 'received' | 'complete'; documentIds: string[] }[]
  issues: string[]
}> {
  const ReconciliationSchema = z.object({
    completionPercentage: z.number(),
    itemStatuses: z.array(z.object({
      itemId: z.string(),
      status: z.enum(['pending', 'received', 'complete']),
      documentIds: z.array(z.string()),
    })),
    issues: z.array(z.string()),
  })

  const response = await openai.chat.completions.parse({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Match documents to checklist items. For each checklist item, determine status: pending (no match), received (matched but has issues), complete (matched and valid). Calculate overall completion percentage weighted by priority (high=50%, medium=35%, low=15%).',
      },
      { role: 'user', content: JSON.stringify({ checklist, documents }) },
    ],
    response_format: zodResponseFormat(ReconciliationSchema, 'reconciliation'),
    temperature: 0,
  })

  const parsed = response.choices[0]?.message?.parsed
  if (!parsed) {
    throw new Error('Failed to reconcile: empty response')
  }
  return parsed
}

export async function generatePrepBrief(engagement: {
  clientName: string
  taxYear: number
  checklist: ChecklistItem[]
  documents: Document[]
  reconciliation: { completionPercentage: number; issues: string[] }
}): Promise<string> {
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Generate a markdown prep brief for the accountant. Include: client summary, documents received, missing items, issues to discuss, and recommended next steps.',
      },
      { role: 'user', content: JSON.stringify(engagement) },
    ],
    temperature: 0.3,
  })

  return response.choices[0]?.message?.content ?? 'Failed to generate brief'
}
```

### 4. SharePoint Helper

```typescript
// src/lib/sharepoint.ts
import { Client } from '@microsoft/microsoft-graph-client'
import { ClientSecretCredential } from '@azure/identity'
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js'

let client: Client | null = null

function getClient(): Client {
  if (!client) {
    const credential = new ClientSecretCredential(
      process.env.AZURE_TENANT_ID!,
      process.env.AZURE_CLIENT_ID!,
      process.env.AZURE_CLIENT_SECRET!
    )
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ['https://graph.microsoft.com/.default'],
    })
    client = Client.initWithMiddleware({ authProvider })
  }
  return client
}

export async function syncFolder(driveId: string, folderId: string, deltaLink: string | null) {
  const c = getClient()
  const url = deltaLink || `/drives/${driveId}/items/${folderId}/delta`

  const response = await c.api(url).get()

  return {
    items: response.value as Array<{ id?: string; name?: string; file?: { mimeType: string }; deleted?: boolean }>,
    newDeltaLink: response['@odata.deltaLink'] || null,
  }
}

export async function downloadFile(driveId: string, itemId: string): Promise<string> {
  const c = getClient()
  const item = await c.api(`/drives/${driveId}/items/${itemId}`).select('@microsoft.graph.downloadUrl').get()
  const response = await fetch(item['@microsoft.graph.downloadUrl'])
  const buffer = await response.arrayBuffer()

  // For demo: just return text. Production would use PDF parser.
  return Buffer.from(buffer).toString('utf-8').slice(0, 50000)
}

export async function resolveSharePointUrl(url: string): Promise<{ driveId: string; folderId: string } | null> {
  const c = getClient()
  try {
    const encoded = Buffer.from(url).toString('base64')
    const response = await c.api(`/shares/u!${encoded}/driveItem`).get()
    return { driveId: response.parentReference.driveId, folderId: response.id }
  } catch {
    return null
  }
}
```

### 5. Simple UI (Engagement Detail)

```typescript
// src/app/engagements/[id]/page.tsx
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { generatePrepBrief } from '@/lib/openai'
import type { ChecklistItem, Document, Reconciliation } from '@/types'

export default async function EngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const engagement = await prisma.engagement.findUnique({ where: { id } })
  if (!engagement) notFound()

  const checklist = (engagement.checklist as ChecklistItem[]) || []
  const documents = (engagement.documents as Document[]) || []
  const reconciliation = engagement.reconciliation as Reconciliation | null

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold">{engagement.clientName} - {engagement.taxYear}</h1>
      <p className="text-gray-600">Status: {engagement.status}</p>

      {reconciliation && (
        <div className="mt-4 p-4 bg-blue-50 rounded">
          <strong>{reconciliation.completionPercentage}% Complete</strong>
        </div>
      )}

      <h2 className="mt-6 text-xl font-semibold">Checklist</h2>
      <ul className="mt-2 space-y-2">
        {checklist.map(item => (
          <li key={item.id} className="p-3 border rounded">
            <span className={item.status === 'complete' ? 'line-through' : ''}>
              {item.title}
            </span>
            <span className="ml-2 text-sm text-gray-500">({item.priority})</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-6 text-xl font-semibold">Documents ({documents.length})</h2>
      <ul className="mt-2 space-y-2">
        {documents.map(doc => (
          <li key={doc.id} className="p-3 border rounded">
            {doc.fileName} → {doc.documentType} ({Math.round(doc.confidence * 100)}%)
            {doc.issues.length > 0 && (
              <span className="ml-2 text-red-600">{doc.issues.join(', ')}</span>
            )}
          </li>
        ))}
      </ul>

      {engagement.prepBrief && (
        <>
          <h2 className="mt-6 text-xl font-semibold">Prep Brief</h2>
          <div className="mt-2 p-4 bg-gray-50 rounded whitespace-pre-wrap">
            {engagement.prepBrief}
          </div>
        </>
      )}
    </div>
  )
}
```

---

## Environment Variables

```env
DATABASE_URL="postgres://..."
OPENAI_API_KEY="sk-..."
AZURE_TENANT_ID="..."
AZURE_CLIENT_ID="..."
AZURE_CLIENT_SECRET="..."
TYPEFORM_WEBHOOK_SECRET="..."
CRON_SECRET="..."
```

---

## Deployment (Vercel)

```bash
# Setup
npx create-next-app@latest tax-agent --typescript --tailwind --app
cd tax-agent
npm install @prisma/client openai @microsoft/microsoft-graph-client @azure/identity zod
npm install -D prisma

# Database
npx prisma init
# Edit schema.prisma with the model above
npx prisma migrate dev

# Deploy
vercel

# Configure cron in vercel.json
```

```json
{
  "crons": [
    {
      "path": "/api/cron/poll-sharepoint",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

---

## What's NOT Included (Intentionally)

- Multi-tenancy (Firm/User hierarchy)
- Authentication/authorization
- Multiple LLM providers
- BullMQ/Redis job queue
- Comprehensive test suite
- Security hardening
- Performance optimizations
- Audit logging

**These are production concerns.** The demo proves the concept works.

---

## Success Criteria

1. Create engagement → status is PENDING
2. Typeform webhook → checklist generated, status is INTAKE_DONE
3. Upload doc to SharePoint → cron classifies it, status is COLLECTING
4. All docs received → status is READY
5. Generate prep brief for accountant

---

## Future Enhancements (Post-Demo)

If the demo succeeds and we need production:

1. Add proper auth (NextAuth or Clerk)
2. Add Firm/User/Client models
3. Add BullMQ for reliable job processing
4. Add proper test coverage
5. Add security hardening
6. Add EventLog for audit trail
7. Consider Anthropic fallback
