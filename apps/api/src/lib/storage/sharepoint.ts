import { Client } from '@microsoft/microsoft-graph-client'
import { ClientSecretCredential } from '@azure/identity'
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js'
import type { StorageClient, SyncResult, DownloadResult, FolderInfo, StorageFile } from './types.js'
import { DocumentTooLargeError, MAX_FILE_SIZE } from './types.js'

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

export const sharePointClient: StorageClient = {
  async syncFolder(folderId: string, pageToken: string | null, driveId?: string): Promise<SyncResult> {
    if (!driveId) {
      throw new Error('SharePoint requires driveId')
    }

    const c = getClient()
    const url = pageToken || `/drives/${driveId}/items/${folderId}/delta`

    const response = await c.api(url).get()

    const files: StorageFile[] = (response.value || [])
      .filter((item: { file?: object }) => item.file) // Only files, not folders
      .map((item: { id?: string; name?: string; file?: { mimeType: string }; deleted?: object }) => ({
        id: item.id || '',
        name: item.name || 'unknown',
        mimeType: item.file?.mimeType || 'application/octet-stream',
        deleted: !!item.deleted,
      }))

    return {
      files,
      nextPageToken: response['@odata.deltaLink'] || null,
    }
  },

  async downloadFile(fileId: string, driveId?: string): Promise<DownloadResult> {
    if (!driveId) {
      throw new Error('SharePoint requires driveId')
    }

    const c = getClient()

    // Get item metadata including presigned URL
    const item = await c
      .api(`/drives/${driveId}/items/${fileId}`)
      .select('name,size,file,@microsoft.graph.downloadUrl')
      .get()

    const presignedUrl = item['@microsoft.graph.downloadUrl']
    const mimeType = item.file?.mimeType || 'application/octet-stream'
    const fileName = item.name
    const size = item.size

    // Validate file size
    if (size > MAX_FILE_SIZE) {
      throw new DocumentTooLargeError(
        `File ${fileName} is ${(size / 1024 / 1024).toFixed(1)}MB, ` +
          `exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit. Please compress and re-upload.`
      )
    }

    // Download the actual file
    const response = await fetch(presignedUrl)
    const buffer = Buffer.from(await response.arrayBuffer())

    return {
      buffer,
      mimeType,
      fileName,
      size,
    }
  },

  async resolveUrl(url: string): Promise<FolderInfo | null> {
    const c = getClient()
    try {
      const encoded = Buffer.from(url).toString('base64')
      const response = await c.api(`/shares/u!${encoded}/driveItem`).get()
      return {
        folderId: response.id,
        driveId: response.parentReference.driveId,
      }
    } catch {
      return null
    }
  },
}
