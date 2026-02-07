import { prisma } from './prisma.js'
import { getStorageClient, type StorageProvider } from './storage/index.js'
import { dispatch } from './agents/dispatcher.js'
import type { Document } from '../types.js'

export async function pollEngagement(engagement: {
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
        issueDetails: null,
        classifiedAt: null,
        approved: null,
        approvedAt: null,
        override: null,
        archived: false,
        archivedAt: null,
        archivedReason: null,
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
