import { vi } from 'vitest'
import type { StorageClient, SyncResult, DownloadResult, FolderInfo } from '../../lib/storage/types.js'

// Mock storage files
export const mockStorageFiles = [
  { id: 'file_001', name: 'w2-2025.pdf', mimeType: 'application/pdf' },
  { id: 'file_002', name: 'bank-statement.jpg', mimeType: 'image/jpeg' },
]

export const mockSyncResult: SyncResult = {
  files: mockStorageFiles,
  nextPageToken: 'cursor_abc123',
}

export const mockDownloadResult: DownloadResult = {
  buffer: Buffer.from('mock file content'),
  mimeType: 'application/pdf',
  fileName: 'w2-2025.pdf',
  size: 1024,
}

export const mockFolderInfo: FolderInfo = {
  folderId: '/test-folder',
  driveId: undefined,
}

// Create mock storage clients
export function createMockStorageClient(): StorageClient {
  return {
    syncFolder: vi.fn(async () => mockSyncResult),
    downloadFile: vi.fn(async () => mockDownloadResult),
    resolveUrl: vi.fn(async () => mockFolderInfo),
  }
}

export const mockDropboxClient = createMockStorageClient()
export const mockGoogleDriveClient = createMockStorageClient()
export const mockSharePointClient = createMockStorageClient()

// Mock the storage module
vi.mock('../../lib/storage/dropbox.js', () => ({
  dropboxClient: mockDropboxClient,
}))

vi.mock('../../lib/storage/google-drive.js', () => ({
  googleDriveClient: mockGoogleDriveClient,
}))

vi.mock('../../lib/storage/sharepoint.js', () => ({
  sharePointClient: mockSharePointClient,
}))

// Reset all storage mocks
export function resetStorageMocks(): void {
  mockDropboxClient.syncFolder.mockClear()
  mockDropboxClient.downloadFile.mockClear()
  mockDropboxClient.resolveUrl.mockClear()

  mockGoogleDriveClient.syncFolder.mockClear()
  mockGoogleDriveClient.downloadFile.mockClear()
  mockGoogleDriveClient.resolveUrl.mockClear()

  mockSharePointClient.syncFolder.mockClear()
  mockSharePointClient.downloadFile.mockClear()
  mockSharePointClient.resolveUrl.mockClear()
}

// Helper to set custom sync results
export function setMockSyncResult(client: StorageClient, result: SyncResult): void {
  (client.syncFolder as ReturnType<typeof vi.fn>).mockResolvedValueOnce(result)
}

export function setMockDownloadResult(client: StorageClient, result: DownloadResult): void {
  (client.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(result)
}

export function setMockFolderInfo(client: StorageClient, info: FolderInfo | null): void {
  (client.resolveUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce(info)
}
