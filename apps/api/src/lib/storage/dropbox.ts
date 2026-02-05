import { Dropbox } from 'dropbox'
import type { StorageClient, SyncResult, DownloadResult, FolderInfo, StorageFile, SyncOptions } from './types.js'
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
  async syncFolder(folderId: string, pageToken: string | null, options?: SyncOptions): Promise<SyncResult> {
    const dbx = getClient()
    const sharedLinkUrl = options?.sharedLinkUrl

    if (pageToken) {
      // Continue from cursor
      try {
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
      } catch (error: unknown) {
        // Handle cursor reset - Dropbox returns 409 when cursor expires
        // Make check robust against different SDK versions/error structures
        const errorStr = String(error)
        const dropboxError = error as { status?: number; error?: { error_summary?: string; error?: { '.tag'?: string } } }
        const isReset = errorStr.includes('409') ||
          dropboxError.status === 409 ||
          dropboxError.error?.error_summary?.includes('reset') ||
          dropboxError.error?.error?.['.tag'] === 'reset'

        if (isReset) {
          console.log('[DROPBOX] Cursor expired or invalid, restarting sync from scratch')
          // Fall through to initial sync below
        } else {
          throw error
        }
      }
    }

    // Initial sync - list all files in folder
    // If we have a shared link URL, use it for accessing the shared folder
    if (sharedLinkUrl) {
      try {
        const response = await dbx.filesListFolder({
          path: '', // Root of the shared folder
          shared_link: { url: sharedLinkUrl },
          recursive: false,
        })

        const files: StorageFile[] = response.result.entries
          .filter(entry => entry['.tag'] === 'file')
          .map(entry => ({
            // For shared folders, use path_display as ID since download needs the path
            id: (entry as { path_display: string }).path_display || `/${entry.name}`,
            name: entry.name,
            mimeType: getMimeType(entry.name),
          }))

        return {
          files,
          nextPageToken: response.result.cursor,
        }
      } catch (error) {
        console.error('[DROPBOX] Error listing shared folder:', error)
        throw error
      }
    }

    // Standard folder listing (for direct access)
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

  async downloadFile(fileId: string, options?: SyncOptions): Promise<DownloadResult> {
    const dbx = getClient()
    const sharedLinkUrl = options?.sharedLinkUrl

    console.log(`[DROPBOX] Downloading file: ${fileId}${sharedLinkUrl ? ' (shared folder)' : ''}`)

    try {
      // For shared folders accessed via URL, use sharingGetSharedLinkFile
      // The fileId for shared folders is the path (e.g., /filename.jpg) stored during sync
      if (sharedLinkUrl) {
        console.log(`[DROPBOX] Using shared link download with path: ${fileId}`)

        const response = await dbx.sharingGetSharedLinkFile({
          url: sharedLinkUrl,
          path: fileId  // fileId is actually the path for shared folders
        })

        const result = response.result as unknown as { fileBinary: Buffer; name: string; size: number }
        const fileBlob = result.fileBinary
        const fileName = result.name
        const size = result.size || fileBlob.length

        console.log(`[DROPBOX] Downloaded ${fileBlob.length} bytes via shared link`)

        // Validate file size
        if (size > MAX_FILE_SIZE) {
          throw new DocumentTooLargeError(
            `File ${fileName} is ${(size / 1024 / 1024).toFixed(1)}MB, ` +
              `exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit. Please compress and re-upload.`
          )
        }

        return {
          buffer: Buffer.from(fileBlob),
          mimeType: getMimeType(fileName),
          fileName,
          size,
        }
      }

      // Standard download for files in user's own Dropbox
      const metadata = await dbx.filesGetMetadata({ path: fileId })

      if (metadata.result['.tag'] !== 'file') {
        throw new Error('Not a file')
      }

      const fileMetadata = metadata.result as { name: string; size: number }
      const fileName = fileMetadata.name
      const size = fileMetadata.size

      console.log(`[DROPBOX] File metadata: ${fileName}, ${size} bytes`)

      if (size > MAX_FILE_SIZE) {
        throw new DocumentTooLargeError(
          `File ${fileName} is ${(size / 1024 / 1024).toFixed(1)}MB, ` +
            `exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit. Please compress and re-upload.`
        )
      }

      const response = await dbx.filesDownload({ path: fileId })
      const fileBlob = (response.result as unknown as { fileBinary: Buffer }).fileBinary

      console.log(`[DROPBOX] Downloaded ${fileBlob.length} bytes`)

      return {
        buffer: Buffer.from(fileBlob),
        mimeType: getMimeType(fileName),
        fileName,
        size,
      }
    } catch (error) {
      console.error(`[DROPBOX] Download failed for ${fileId}:`, error)
      throw error
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
