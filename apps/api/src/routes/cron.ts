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

  // Also retry stuck documents (in_progress for > 5 minutes)
  const stuckCount = await retryStuckDocuments(engagements)

  return c.json({ queued: engagements.length, retriedStuck: stuckCount })
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

// Retry documents stuck in 'in_progress' status for > 5 minutes OR with PROCESSING_ERROR
async function retryStuckDocuments(engagements: { id: string; documents: unknown }[]): Promise<number> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  let retriedCount = 0

  for (const engagement of engagements) {
    const documents = (engagement.documents as Document[]) || []

    // Find documents that need retry:
    // 1. Stuck in 'in_progress' for > 5 minutes
    // 2. Have PROCESSING_ERROR type (failed extraction/classification)
    const needsRetry = (doc: Document) => {
      const isStuck = doc.processingStatus === 'in_progress' &&
        doc.processingStartedAt &&
        doc.processingStartedAt < fiveMinutesAgo
      const hasError = doc.documentType === 'PROCESSING_ERROR'
      return isStuck || hasError
    }

    const docsToRetry = documents.filter(needsRetry)
    if (docsToRetry.length === 0) continue

    // Reset documents to pending
    let updated = false
    for (const doc of documents) {
      if (needsRetry(doc)) {
        const reason = doc.documentType === 'PROCESSING_ERROR' ? 'PROCESSING_ERROR' : 'stuck'
        doc.documentType = 'PENDING'
        doc.processingStatus = 'pending'
        doc.processingStartedAt = null
        doc.issues = []
        doc.classifiedAt = null
        updated = true
        retriedCount++

        // Re-dispatch the document_uploaded event
        runInBackground(() => dispatch({
          type: 'document_uploaded',
          engagementId: engagement.id,
          documentId: doc.id,
          storageItemId: doc.storageItemId,
          fileName: doc.fileName
        }))

        console.log(`[CRON] Retrying ${reason} document ${doc.id} (${doc.fileName}) for engagement ${engagement.id}`)
      }
    }

    if (updated) {
      await prisma.engagement.update({
        where: { id: engagement.id },
        data: { documents }
      })
    }
  }

  return retriedCount
}

async function pollEngagement(engagement: {
  id: string
  storageProvider: string
  storageFolderId: string | null
  storageFolderUrl: string | null
  storageDriveId: string | null
  storagePageToken: string | null
  checklist: unknown
  documents: unknown
}) {
  const provider = (engagement.storageProvider || 'dropbox') as StorageProvider
  const folderId = engagement.storageFolderId
  const driveId = engagement.storageDriveId
  const pageToken = engagement.storagePageToken
  const folderUrl = engagement.storageFolderUrl

  // For Dropbox shared folders, we can sync using the URL even without folderId
  if (provider !== 'dropbox' && !folderId) return
  if (provider === 'dropbox' && !folderId && !folderUrl) return

  // Google Drive may require driveId for shared drives
  if (provider === 'google-drive' && !driveId && !folderId) return

  try {
    const client = getStorageClient(provider)
    const { files, nextPageToken } = await client.syncFolder(
      folderId || '', // For Dropbox shared links, folderId can be empty
      pageToken,
      { driveId: driveId || undefined, sharedLinkUrl: folderUrl || undefined }
    )

    const existingDocs = (engagement.documents as Document[]) || []
    const existingIds = new Set(existingDocs.map(d => d.storageItemId))

    // Process new files
    const newFiles = files.filter(file => !file.deleted && !existingIds.has(file.id))

    if (newFiles.length === 0) {
      // Just update page token if no new files
      await prisma.engagement.update({
        where: { id: engagement.id },
        data: { storagePageToken: nextPageToken }
      })
      return
    }

    // Add placeholder documents for new files
    for (const file of newFiles) {
      const newDoc: Document = {
        id: crypto.randomUUID(),
        fileName: file.name,
        storageItemId: file.id,
        documentType: 'PENDING',
        confidence: 0,
        taxYear: null,
        issues: [],
        classifiedAt: null,
        approved: null,
        approvedAt: null,
        override: null,
      }

      existingDocs.push(newDoc)
    }

    // Update documents list and page token
    await prisma.engagement.update({
      where: { id: engagement.id },
      data: {
        storagePageToken: nextPageToken,
        documents: existingDocs,
        status: 'COLLECTING'
      }
    })

    // Dispatch document_uploaded events for each new file
    for (const file of newFiles) {
      const doc = existingDocs.find(d => d.storageItemId === file.id)
      if (!doc) continue

      await dispatch({
        type: 'document_uploaded',
        engagementId: engagement.id,
        documentId: doc.id,
        storageItemId: file.id,
        fileName: file.name
      })
    }

    console.log(`[POLL] ${engagement.id}: Dispatched ${newFiles.length} documents (${provider})`)
  } catch (error) {
    console.error(`[POLL] Error processing engagement ${engagement.id}:`, error)
  }
}

export default app
