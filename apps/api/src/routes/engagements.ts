import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { getStorageClient, detectProvider } from '../lib/storage/index.js'
import { dispatch } from '../lib/agents/dispatcher.js'
import { generatePrepBrief } from '../lib/openai.js'
import { runInBackground } from '../workers/background.js'
import type { ChecklistItem, Document, Reconciliation } from '../types.js'

const app = new Hono()

const CreateEngagementSchema = z.object({
  clientName: z.string().min(1),
  clientEmail: z.string().email(),
  taxYear: z.number().int().min(2020).max(2030),
  storageFolderUrl: z.string().url(),
  // Legacy field - accept but prefer storageFolderUrl
  sharepointFolderUrl: z.string().url().optional(),
  typeformFormId: z.string().min(1),
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

    // Use storageFolderUrl, fallback to legacy sharepointFolderUrl
    const folderUrl = body.storageFolderUrl || body.sharepointFolderUrl!

    // Detect provider from URL
    const provider = detectProvider(folderUrl)
    if (!provider) {
      return c.json(
        { error: 'Unsupported storage URL. Use SharePoint, Google Drive, or Dropbox.' },
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
        taxYear: body.taxYear,
        typeformFormId: body.typeformFormId,
        // New storage fields
        storageProvider: provider,
        storageFolderUrl: folderUrl,
        storageFolderId,
        storageDriveId,
        // Legacy fields (for backwards compatibility)
        sharepointFolderUrl: provider === 'sharepoint' ? folderUrl : null,
        sharepointDriveId: provider === 'sharepoint' ? storageDriveId : null,
        sharepointFolderId: provider === 'sharepoint' ? storageFolderId : null,
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

export default app
