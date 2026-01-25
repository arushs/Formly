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
