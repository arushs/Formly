import { google } from 'googleapis'
import type { StorageClient, SyncResult, DownloadResult, FolderInfo, StorageFile } from './types.js'
import { DocumentTooLargeError, MAX_FILE_SIZE } from './types.js'

let driveClient: ReturnType<typeof google.drive> | null = null

function getClient() {
  if (!driveClient) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    })

    driveClient = google.drive({ version: 'v3', auth })
  }
  return driveClient
}

export const googleDriveClient: StorageClient = {
  async syncFolder(folderId: string, pageToken: string | null): Promise<SyncResult> {
    const drive = getClient()

    // Use changes API if we have a page token, otherwise list files
    if (pageToken) {
      const response = await drive.changes.list({
        pageToken,
        spaces: 'drive',
        fields: 'nextPageToken, newStartPageToken, changes(fileId, removed, file(id, name, mimeType, trashed))',
      })

      const files: StorageFile[] = (response.data.changes || [])
        .filter(change => {
          // Only include files from our target folder
          // Changes API returns all changes, so we filter by checking parent
          return change.file && !change.file.mimeType?.includes('folder')
        })
        .map(change => ({
          id: change.fileId!,
          name: change.file?.name || 'unknown',
          mimeType: change.file?.mimeType || 'application/octet-stream',
          deleted: change.removed || change.file?.trashed || false,
        }))

      return {
        files,
        nextPageToken: response.data.newStartPageToken || response.data.nextPageToken || null,
      }
    }

    // Initial sync - list all files in folder
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 100,
    })

    const files: StorageFile[] = (response.data.files || []).map(file => ({
      id: file.id!,
      name: file.name || 'unknown',
      mimeType: file.mimeType || 'application/octet-stream',
    }))

    // Get start page token for future change tracking
    const startPageTokenResponse = await drive.changes.getStartPageToken({})
    const startPageToken = startPageTokenResponse.data.startPageToken

    return {
      files,
      nextPageToken: startPageToken || null,
    }
  },

  async downloadFile(fileId: string): Promise<DownloadResult> {
    const drive = getClient()

    // Get file metadata
    const metadata = await drive.files.get({
      fileId,
      fields: 'name, size, mimeType',
    })

    const fileName = metadata.data.name || 'unknown'
    const size = parseInt(metadata.data.size || '0', 10)
    const mimeType = metadata.data.mimeType || 'application/octet-stream'

    // Validate file size
    if (size > MAX_FILE_SIZE) {
      throw new DocumentTooLargeError(
        `File ${fileName} is ${(size / 1024 / 1024).toFixed(1)}MB, ` +
          `exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit. Please compress and re-upload.`
      )
    }

    // Download file content
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    )

    const buffer = Buffer.from(response.data as ArrayBuffer)

    return {
      buffer,
      mimeType,
      fileName,
      size,
    }
  },

  async resolveUrl(url: string): Promise<FolderInfo | null> {
    // Google Drive folder URLs can be:
    // https://drive.google.com/drive/folders/{folderId}
    // https://drive.google.com/drive/u/0/folders/{folderId}
    // https://drive.google.com/drive/folders/{folderId}?usp=sharing

    const patterns = [
      /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/,
      /drive\.google\.com\/folderview\?id=([a-zA-Z0-9_-]+)/,
    ]

    for (const pattern of patterns) {
      const match = url.match(pattern)
      if (match) {
        const folderId = match[1]

        // Verify we have access to the folder
        try {
          const drive = getClient()
          await drive.files.get({ fileId: folderId, fields: 'id' })
          return { folderId }
        } catch {
          // No access or invalid folder
          return null
        }
      }
    }

    return null
  },
}
