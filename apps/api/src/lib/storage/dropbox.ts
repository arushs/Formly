import { Dropbox } from 'dropbox'
import type { StorageClient, SyncResult, DownloadResult, FolderInfo, StorageFile } from './types.js'
import { DocumentTooLargeError, MAX_FILE_SIZE } from './types.js'

let dbxClient: Dropbox | null = null

function getClient(): Dropbox {
  if (!dbxClient) {
    dbxClient = new Dropbox({
      accessToken: process.env.DROPBOX_ACCESS_TOKEN,
      refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
      clientId: process.env.DROPBOX_APP_KEY,
      clientSecret: process.env.DROPBOX_APP_SECRET,
    })
  }
  return dbxClient
}

export const dropboxClient: StorageClient = {
  async syncFolder(folderId: string, pageToken: string | null): Promise<SyncResult> {
    const dbx = getClient()

    if (pageToken) {
      // Continue from cursor
      const response = await dbx.filesListFolderContinue({ cursor: pageToken })

      const files: StorageFile[] = response.result.entries
        .filter(entry => entry['.tag'] === 'file')
        .map(entry => ({
          id: (entry as { id: string }).id,
          name: entry.name,
          mimeType: getMimeType(entry.name),
          deleted: false,
        }))

      // Check for deleted files
      const deletedFiles: StorageFile[] = response.result.entries
        .filter(entry => entry['.tag'] === 'deleted')
        .map(entry => ({
          id: entry.name, // Deleted entries don't have ID
          name: entry.name,
          mimeType: 'application/octet-stream',
          deleted: true,
        }))

      return {
        files: [...files, ...deletedFiles],
        nextPageToken: response.result.cursor,
      }
    }

    // Initial sync - list all files in folder
    const response = await dbx.filesListFolder({
      path: folderId === 'root' ? '' : folderId,
      recursive: false,
    })

    const files: StorageFile[] = response.result.entries
      .filter(entry => entry['.tag'] === 'file')
      .map(entry => ({
        id: (entry as { id: string }).id,
        name: entry.name,
        mimeType: getMimeType(entry.name),
      }))

    return {
      files,
      nextPageToken: response.result.cursor,
    }
  },

  async downloadFile(fileId: string): Promise<DownloadResult> {
    const dbx = getClient()

    // Get file metadata first
    const metadata = await dbx.filesGetMetadata({ path: fileId })

    if (metadata.result['.tag'] !== 'file') {
      throw new Error('Not a file')
    }

    const fileMetadata = metadata.result as { name: string; size: number }
    const fileName = fileMetadata.name
    const size = fileMetadata.size

    // Validate file size
    if (size > MAX_FILE_SIZE) {
      throw new DocumentTooLargeError(
        `File ${fileName} is ${(size / 1024 / 1024).toFixed(1)}MB, ` +
          `exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit. Please compress and re-upload.`
      )
    }

    // Download file
    const response = await dbx.filesDownload({ path: fileId })
    // Dropbox SDK returns fileBinary on the result in Node.js
    const fileBlob = (response.result as unknown as { fileBinary: Buffer }).fileBinary

    return {
      buffer: Buffer.from(fileBlob),
      mimeType: getMimeType(fileName),
      fileName,
      size,
    }
  },

  async resolveUrl(url: string): Promise<FolderInfo | null> {
    // Dropbox shared folder URLs:
    // https://www.dropbox.com/sh/{id}/{hash}?dl=0
    // https://www.dropbox.com/scl/fo/{id}/{hash}?dl=0
    // https://www.dropbox.com/home/{path}

    const dbx = getClient()

    // Try to extract shared link
    const sharedLinkPattern = /dropbox\.com\/(?:sh|scl\/fo)\/([^/?]+)/
    const match = url.match(sharedLinkPattern)

    if (match) {
      try {
        // Get shared folder metadata
        const response = await dbx.sharingGetSharedLinkMetadata({ url })

        if (response.result['.tag'] === 'folder') {
          // For shared links, we use the path as the folder ID
          return { folderId: response.result.path_lower || '' }
        }
      } catch {
        return null
      }
    }

    // Try direct path pattern: /home/path/to/folder
    const pathPattern = /dropbox\.com\/home(\/[^?]+)/
    const pathMatch = url.match(pathPattern)

    if (pathMatch) {
      const folderPath = decodeURIComponent(pathMatch[1])
      try {
        // Verify the folder exists
        await dbx.filesGetMetadata({ path: folderPath })
        return { folderId: folderPath }
      } catch {
        return null
      }
    }

    return null
  },
}

/**
 * Get MIME type from filename extension
 */
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    txt: 'text/plain',
    heic: 'image/heic',
  }
  return mimeTypes[ext || ''] || 'application/octet-stream'
}
