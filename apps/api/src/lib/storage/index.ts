import type { StorageClient, StorageProvider } from './types.js'
import { sharePointClient } from './sharepoint.js'
import { googleDriveClient } from './google-drive.js'
import { dropboxClient } from './dropbox.js'

export * from './types.js'
export { sharePointClient } from './sharepoint.js'
export { googleDriveClient } from './google-drive.js'
export { dropboxClient } from './dropbox.js'

/**
 * Get the storage client for a given provider
 */
export function getStorageClient(provider: StorageProvider): StorageClient {
  switch (provider) {
    case 'sharepoint':
      return sharePointClient
    case 'google-drive':
      return googleDriveClient
    case 'dropbox':
      return dropboxClient
    default:
      throw new Error(`Unknown storage provider: ${provider}`)
  }
}

/**
 * Detect storage provider from URL
 */
export function detectProvider(url: string): StorageProvider | null {
  if (url.includes('sharepoint.com') || url.includes('onedrive.com')) {
    return 'sharepoint'
  }
  if (url.includes('drive.google.com')) {
    return 'google-drive'
  }
  if (url.includes('dropbox.com')) {
    return 'dropbox'
  }
  return null
}
