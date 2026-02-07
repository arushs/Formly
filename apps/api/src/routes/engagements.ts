import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { getStorageClient, detectProvider } from '../lib/storage/index.js'
import { dispatch } from '../lib/agents/dispatcher.js'
import { runReconciliationAgent } from '../lib/agents/reconciliation.js'
import { generatePrepBrief } from '../lib/openai.js'
import { runInBackground } from '../workers/background.js'
import { pollEngagement } from '../lib/poll-engagement.js'
import type { ChecklistItem, Document, Reconciliation } from '../types.js'

const app = new Hono()

const CreateEngagementSchema = z.object({
  clientName: z.string().min(1),
  clientEmail: z.string().email(),
  storageFolderUrl: z.string().url(),
})

// GET /api/engagements - List all engagements
app.get('/', async (c) => {
  const engagements = await prisma.engagement.findMany({
    orderBy: { createdAt: 'desc' },
  })
  return c.json(engagements)
})

// POST /api/engagements - Create new engagement
app.post('/', zValidator('json', CreateEngagementSchema), async (c) => {
  try {
    const body = c.req.valid('json')

    // Get Typeform Form ID from environment
    const typeformFormId = process.env.TYPEFORM_FORM_ID
    if (!typeformFormId) {
      return c.json({ error: 'TYPEFORM_FORM_ID environment variable not set' }, 500)
    }

    const folderUrl = body.storageFolderUrl

    // Detect provider from URL
    const provider = detectProvider(folderUrl)
    if (!provider) {
      return c.json(
        { error: 'Unsupported storage URL. Please provide a Dropbox folder URL.' },
        400
      )
    }

    // Resolve URL to folder IDs
    let storageFolderId: string | null = null
    let storageDriveId: string | null = null

    try {
      const client = getStorageClient(provider)
      const resolved = await client.resolveUrl(folderUrl)
      if (resolved) {
        storageFolderId = resolved.folderId
        storageDriveId = resolved.driveId || null
      }
    } catch (error) {
      console.warn('Could not resolve storage URL:', error)
      // Continue without resolved IDs - they can be set later
    }

    const engagement = await prisma.engagement.create({
      data: {
        clientName: body.clientName,
        clientEmail: body.clientEmail,
        taxYear: new Date().getFullYear(),
        typeformFormId,
        storageProvider: provider,
        storageFolderUrl: folderUrl,
        storageFolderId,
        storageDriveId,
      },
    })

    // Trigger Outreach Agent to send welcome email (background)
    runInBackground(() => dispatch({
      type: 'engagement_created',
      engagementId: engagement.id
    }))

    return c.json(engagement, 201)
  } catch (error) {
    console.error('Error creating engagement:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to create engagement' },
      500
    )
  }
})

// GET /api/engagements/:id - Get single engagement
app.get('/:id', async (c) => {
  const id = c.req.param('id')
  const engagement = await prisma.engagement.findUnique({ where: { id } })

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404)
  }

  return c.json(engagement)
})

const UpdateEngagementSchema = z.object({
  storageFolderId: z.string().optional(),
  storageDriveId: z.string().optional(),
  storageFolderUrl: z.string().url().optional(),
  storageProvider: z.enum(['dropbox', 'google-drive']).optional(),
})

// PATCH /api/engagements/:id - Update engagement
app.patch('/:id', zValidator('json', UpdateEngagementSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const engagement = await prisma.engagement.findUnique({ where: { id } })

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404)
  }

  const updateData: Record<string, unknown> = {}

  if (body.storageFolderId !== undefined) {
    updateData.storageFolderId = body.storageFolderId
  }

  if (body.storageDriveId !== undefined) {
    updateData.storageDriveId = body.storageDriveId
  }

  if (body.storageFolderUrl !== undefined) {
    updateData.storageFolderUrl = body.storageFolderUrl
  }

  if (body.storageProvider !== undefined) {
    updateData.storageProvider = body.storageProvider
  }

  const updated = await prisma.engagement.update({
    where: { id },
    data: updateData,
  })

  return c.json(updated)
})

// POST /api/engagements/:id/brief - Generate prep brief
app.post('/:id/brief', async (c) => {
  const id = c.req.param('id')

  const engagement = await prisma.engagement.findUnique({ where: { id } })

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404)
  }

  if (engagement.status !== 'READY') {
    return c.json(
      { error: 'Engagement must be in READY status to generate brief' },
      400
    )
  }

  const checklist = (engagement.checklist as ChecklistItem[]) || []
  const documents = (engagement.documents as Document[]) || []
  const reconciliation = (engagement.reconciliation as Reconciliation) || {
    completionPercentage: 0,
    issues: [],
  }

  const brief = await generatePrepBrief({
    clientName: engagement.clientName,
    taxYear: engagement.taxYear,
    checklist,
    documents,
    reconciliation: {
      completionPercentage: reconciliation.completionPercentage,
      issues: reconciliation.issues,
    },
  })

  await prisma.engagement.update({
    where: { id },
    data: { prepBrief: brief },
  })

  return c.json({ success: true, brief })
})

// POST /api/engagements/:id/retry-documents - Retry processing of PENDING documents
app.post('/:id/retry-documents', async (c) => {
  const id = c.req.param('id')

  const engagement = await prisma.engagement.findUnique({ where: { id } })

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404)
  }

  const documents = (engagement.documents as Document[]) || []
  const pendingDocs = documents.filter(d => d.documentType === 'PENDING')

  if (pendingDocs.length === 0) {
    return c.json({ message: 'No PENDING documents to retry', retried: 0 })
  }

  // Dispatch document_uploaded events for each pending document
  for (const doc of pendingDocs) {
    runInBackground(() => dispatch({
      type: 'document_uploaded',
      engagementId: engagement.id,
      documentId: doc.id,
      storageItemId: doc.storageItemId,
      fileName: doc.fileName
    }))
  }

  console.log(`[RETRY] Dispatched ${pendingDocs.length} PENDING documents for ${id}`)

  return c.json({
    message: `Retrying ${pendingDocs.length} PENDING documents`,
    retried: pendingDocs.length,
    documentIds: pendingDocs.map(d => d.id)
  })
})

// POST /api/engagements/:id/process - Poll storage and dispatch pending docs
app.post('/:id/process', async (c) => {
  const id = c.req.param('id')

  const engagement = await prisma.engagement.findUnique({ where: { id } })

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404)
  }

  if (!['INTAKE_DONE', 'COLLECTING'].includes(engagement.status)) {
    return c.json(
      { error: 'Engagement must be in INTAKE_DONE or COLLECTING status' },
      400
    )
  }

  // Poll storage for new files
  await pollEngagement(engagement)

  // Re-fetch to get updated document list
  const updated = await prisma.engagement.findUnique({ where: { id } })
  const documents = (updated?.documents as Document[]) || []

  // Dispatch document_uploaded for any remaining PENDING docs
  const pendingDocs = documents.filter(d => d.documentType === 'PENDING' && d.processingStatus !== 'in_progress')
  for (const doc of pendingDocs) {
    runInBackground(() => dispatch({
      type: 'document_uploaded',
      engagementId: id,
      documentId: doc.id,
      storageItemId: doc.storageItemId,
      fileName: doc.fileName
    }))
  }

  return c.json({
    success: true,
    totalDocuments: documents.length,
    pendingDocuments: pendingDocs.length,
  })
})

// POST /api/engagements/:id/reconcile - Manually trigger reconciliation
app.post('/:id/reconcile', async (c) => {
  const { id } = c.req.param()

  const engagement = await prisma.engagement.findUnique({
    where: { id }
  })

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404)
  }

  try {
    const result = await runReconciliationAgent({
      trigger: 'manual_reconciliation',
      engagementId: id
    })

    return c.json({
      message: 'Reconciliation complete',
      isReady: result.isReady,
      completionPercentage: result.completionPercentage
    })
  } catch (error) {
    console.error(`[RECONCILE] Error for ${id}:`, error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Reconciliation failed' },
      500
    )
  }
})

// DELETE /api/engagements/:id - Delete an engagement
app.delete('/:id', async (c) => {
  const id = c.req.param('id')

  const engagement = await prisma.engagement.findUnique({
    where: { id }
  })

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404)
  }

  // Delete related records first (documents, etc.)
  await prisma.document.deleteMany({
    where: { engagementId: id }
  })

  // Delete the engagement
  await prisma.engagement.delete({
    where: { id }
  })

  return c.json({ message: 'Engagement deleted successfully' })
})

export default app
