import { vi } from 'vitest'

/**
 * Mock Microsoft Graph client with chainable API
 */
export const mockGraphClient = {
  api: vi.fn().mockReturnThis(),
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  select: vi.fn().mockReturnThis(),
  expand: vi.fn().mockReturnThis(),
  filter: vi.fn().mockReturnThis(),
  top: vi.fn().mockReturnThis(),
}

/**
 * Helper to mock SharePoint file listing
 */
export function mockSharePointFiles(
  files: Array<{ id: string; name: string; downloadUrl?: string }>
): void {
  mockGraphClient.get.mockResolvedValue({
    value: files.map((f) => ({
      id: f.id,
      name: f.name,
      '@microsoft.graph.downloadUrl': f.downloadUrl ?? `https://sharepoint.com/download/${f.id}`,
    })),
  })
}

/**
 * Helper to mock SharePoint URL resolution
 */
export function mockSharePointResolution(driveId: string, folderId: string): void {
  mockGraphClient.get.mockResolvedValueOnce({ id: driveId })
  mockGraphClient.get.mockResolvedValueOnce({ id: folderId })
}

/**
 * Helper to mock file download
 */
export function mockFileDownload(content: string): void {
  mockGraphClient.get.mockResolvedValue(content)
}

/**
 * Factory for vi.mock
 */
export function createGraphClientMock() {
  return {
    Client: {
      initWithMiddleware: vi.fn(() => mockGraphClient),
    },
  }
}
