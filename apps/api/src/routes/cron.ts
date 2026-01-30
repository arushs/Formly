import { Hono } from 'hono'
import { prisma } from '../lib/prisma.js'
import { getStorageClient, type StorageProvider } from '../lib/storage/index.js'
import { dispatch } from '../lib/agents/dispatcher.js'
import { runInBackground, runAllInBackground } from '../workers/background.js'
import type { Document } from '../types.js'

const app = new Hono()

// Middleware to verify CRON_SECRET
app.use('*', async (c, next) => {
  const auth = c.req.header('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

// GET /api/cron/poll-storage - Poll storage for new documents
app.get('/poll-storage', async (c) => {
  const engagements = await prisma.engagement.findMany({
    where: { status: { in: ['INTAKE_DONE', 'COLLECTING'] } },
  })

  // Process all in background
  runAllInBackground(engagements.map(engagement => () => pollEngagement(engagement)))

  return c.json({ queued: engagements.length })
})

// GET /api/cron/check-reminders - Check for stale engagements and send reminders
app.get('/check-reminders', async (c) => {
  // Find engagements that need reminders:
  // - Status is INTAKE_DONE or COLLECTING
  // - No activity in the last 3 days
  // - Haven't exceeded max reminders (5)
  const threeDaysAgo = new Date()
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

  const staleEngagements = await prisma.engagement.findMany({
    where: {
      status: { in: ['INTAKE_DONE', 'COLLECTING'] },
      lastActivityAt: { lt: threeDaysAgo },
      reminderCount: { lt: 5 }
    }
  })

  // Process each stale engagement in background
  for (const engagement of staleEngagements) {
    runInBackground(() => dispatch({
      type: 'stale_engagement',
      engagementId: engagement.id
    }))
  }

  console.log(`[REMINDERS] Dispatched reminders for ${staleEngagements.length} stale engagements`)

  return c.json({
    checked: staleEngagements.length,
    engagementIds: staleEngagements.map(e => e.id)
  })
})

async function pollEngagement(engagement: {
  id: string
  storageProvider: string
  storageFolderId: string | null
  storageDriveId: string | null
  storagePageToken: string | null
  // Legacy fields
  sharepointDriveId: string | null
  sharepointFolderId: string | null
  deltaLink: string | null
  checklist: unknown
  documents: unknown
}) {
  // Support both new and legacy field names
  const provider = (engagement.storageProvider || 'sharepoint') as StorageProvider
  const folderId = engagement.storageFolderId || engagement.sharepointFolderId
  const driveId = engagement.storageDriveId || engagement.sharepointDriveId
  const pageToken = engagement.storagePageToken || engagement.deltaLink

  if (!folderId) return

  // SharePoint requires driveId
  if (provider === 'sharepoint' && !driveId) return

  try {
    const client = getStorageClient(provider)
    const { files, nextPageToken } = await client.syncFolder(folderId, pageToken, driveId || undefined)

    const existingDocs = (engagement.documents as Document[]) || []
    const existingIds = new Set(existingDocs.map(d => d.storageItemId || d.sharepointItemId))

    // Process new files
    const newFiles = files.filter(file => !file.deleted && !existingIds.has(file.id))

    if (newFiles.length === 0) {
      // Just update page token if no new files
      await prisma.engagement.update({
        where: { id: engagement.id },
        data: { storagePageToken: nextPageToken, deltaLink: nextPageToken }
      })
      return
    }

    // Add placeholder documents for new files
    for (const file of newFiles) {
      const newDoc: Document = {
        id: crypto.randomUUID(),
        fileName: file.name,
        storageItemId: file.id,
        sharepointItemId: file.id, // Keep for backwards compatibility
        documentType: 'PENDING',
        confidence: 0,
        taxYear: null,
        issues: [],
        classifiedAt: null,
      }

      existingDocs.push(newDoc)
    }

    // Update documents list and page token
    await prisma.engagement.update({
      where: { id: engagement.id },
      data: {
        storagePageToken: nextPageToken,
        deltaLink: nextPageToken, // Keep legacy field in sync
        documents: existingDocs,
        status: 'COLLECTING'
      }
    })

    // Dispatch document_uploaded events for each new file
    for (const file of newFiles) {
      const doc = existingDocs.find(d => d.storageItemId === file.id || d.sharepointItemId === file.id)
      if (!doc) continue

      await dispatch({
        type: 'document_uploaded',
        engagementId: engagement.id,
        documentId: doc.id,
        sharepointItemId: file.id, // Keep event shape for backwards compatibility
        fileName: file.name
      })
    }

    console.log(`[POLL] ${engagement.id}: Dispatched ${newFiles.length} documents (${provider})`)
  } catch (error) {
    console.error(`[POLL] Error processing engagement ${engagement.id}:`, error)
  }
}

export default app
