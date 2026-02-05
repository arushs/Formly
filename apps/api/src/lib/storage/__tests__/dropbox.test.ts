import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dropboxClient } from '../dropbox.js'
import { DocumentTooLargeError, MAX_FILE_SIZE } from '../types.js'

// Mock the Dropbox SDK
const mockFilesListFolder = vi.fn()
const mockFilesListFolderContinue = vi.fn()
const mockFilesGetMetadata = vi.fn()
const mockFilesDownload = vi.fn()
const mockSharingGetSharedLinkMetadata = vi.fn()
const mockSharingGetSharedLinkFile = vi.fn()

vi.mock('dropbox', () => ({
  Dropbox: vi.fn(() => ({
    filesListFolder: mockFilesListFolder,
    filesListFolderContinue: mockFilesListFolderContinue,
    filesGetMetadata: mockFilesGetMetadata,
    filesDownload: mockFilesDownload,
    sharingGetSharedLinkMetadata: mockSharingGetSharedLinkMetadata,
    sharingGetSharedLinkFile: mockSharingGetSharedLinkFile,
  })),
}))

describe('dropboxClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('syncFolder', () => {
    describe('initial sync', () => {
      it('lists files in folder without cursor', async () => {
        mockFilesListFolder.mockResolvedValueOnce({
          result: {
            entries: [
              { '.tag': 'file', id: 'id:file1', name: 'document.pdf' },
              { '.tag': 'file', id: 'id:file2', name: 'image.jpg' },
              { '.tag': 'folder', name: 'subfolder' },
            ],
            cursor: 'cursor_123',
            has_more: false,
          },
        })

        const result = await dropboxClient.syncFolder('/test-folder', null)

        expect(mockFilesListFolder).toHaveBeenCalledWith({
          path: '/test-folder',
          recursive: false,
        })
        expect(result.files).toHaveLength(2)
        expect(result.files[0]).toEqual({
          id: 'id:file1',
          name: 'document.pdf',
          mimeType: 'application/pdf',
        })
        expect(result.files[1]).toEqual({
          id: 'id:file2',
          name: 'image.jpg',
          mimeType: 'image/jpeg',
        })
        expect(result.nextPageToken).toBe('cursor_123')
      })

      it('handles root folder path', async () => {
        mockFilesListFolder.mockResolvedValueOnce({
          result: {
            entries: [],
            cursor: 'cursor_abc',
            has_more: false,
          },
        })

        await dropboxClient.syncFolder('root', null)

        expect(mockFilesListFolder).toHaveBeenCalledWith({
          path: '',
          recursive: false,
        })
      })

      it('uses shared link URL when provided', async () => {
        const sharedLinkUrl = 'https://www.dropbox.com/sh/abc123/xyz'
        mockFilesListFolder.mockResolvedValueOnce({
          result: {
            entries: [
              { '.tag': 'file', path_display: '/doc.pdf', name: 'doc.pdf' },
            ],
            cursor: 'cursor_shared',
            has_more: false,
          },
        })

        const result = await dropboxClient.syncFolder('/shared-folder', null, { sharedLinkUrl })

        expect(mockFilesListFolder).toHaveBeenCalledWith({
          path: '',
          shared_link: { url: sharedLinkUrl },
          recursive: false,
        })
        expect(result.files[0].id).toBe('/doc.pdf')
      })
    })

    describe('cursor continuation', () => {
      it('continues from cursor when provided', async () => {
        mockFilesListFolderContinue.mockResolvedValueOnce({
          result: {
            entries: [
              { '.tag': 'file', id: 'id:file3', name: 'new-doc.pdf' },
            ],
            cursor: 'cursor_456',
            has_more: false,
          },
        })

        const result = await dropboxClient.syncFolder('/test-folder', 'cursor_123')

        expect(mockFilesListFolderContinue).toHaveBeenCalledWith({ cursor: 'cursor_123' })
        expect(result.files).toHaveLength(1)
        expect(result.nextPageToken).toBe('cursor_456')
      })

      it('handles deleted files in continuation', async () => {
        mockFilesListFolderContinue.mockResolvedValueOnce({
          result: {
            entries: [
              { '.tag': 'deleted', name: 'removed.pdf' },
            ],
            cursor: 'cursor_789',
            has_more: false,
          },
        })

        const result = await dropboxClient.syncFolder('/test-folder', 'cursor_123')

        expect(result.files).toHaveLength(1)
        expect(result.files[0]).toEqual({
          id: 'removed.pdf',
          name: 'removed.pdf',
          mimeType: 'application/octet-stream',
          deleted: true,
        })
      })

      it('handles 409 cursor reset error and falls back to fresh sync', async () => {
        mockFilesListFolderContinue.mockRejectedValueOnce({
          status: 409,
          error: { error_summary: 'reset/' },
        })
        mockFilesListFolder.mockResolvedValueOnce({
          result: {
            entries: [
              { '.tag': 'file', id: 'id:file1', name: 'doc.pdf' },
            ],
            cursor: 'new_cursor',
            has_more: false,
          },
        })

        const result = await dropboxClient.syncFolder('/test-folder', 'expired_cursor')

        expect(mockFilesListFolderContinue).toHaveBeenCalled()
        expect(mockFilesListFolder).toHaveBeenCalled()
        expect(result.nextPageToken).toBe('new_cursor')
      })

      it('handles reset error in error_summary', async () => {
        mockFilesListFolderContinue.mockRejectedValueOnce({
          error: { error_summary: 'reset/...' },
        })
        mockFilesListFolder.mockResolvedValueOnce({
          result: {
            entries: [],
            cursor: 'fresh_cursor',
            has_more: false,
          },
        })

        await dropboxClient.syncFolder('/folder', 'old_cursor')

        expect(mockFilesListFolder).toHaveBeenCalled()
      })
    })
  })

  describe('downloadFile', () => {
    it('downloads file by ID', async () => {
      const fileBuffer = Buffer.from('PDF content')
      mockFilesGetMetadata.mockResolvedValueOnce({
        result: { '.tag': 'file', name: 'document.pdf', size: 1024 },
      })
      mockFilesDownload.mockResolvedValueOnce({
        result: { fileBinary: fileBuffer },
      })

      const result = await dropboxClient.downloadFile('id:abc123')

      expect(mockFilesGetMetadata).toHaveBeenCalledWith({ path: 'id:abc123' })
      expect(mockFilesDownload).toHaveBeenCalledWith({ path: 'id:abc123' })
      expect(result).toEqual({
        buffer: fileBuffer,
        mimeType: 'application/pdf',
        fileName: 'document.pdf',
        size: 1024,
      })
    })

    it('uses shared link download for shared folder files', async () => {
      const sharedLinkUrl = 'https://www.dropbox.com/sh/abc123'
      const fileBuffer = Buffer.from('Image content')
      mockSharingGetSharedLinkFile.mockResolvedValueOnce({
        result: { fileBinary: fileBuffer, name: 'photo.jpg', size: 2048 },
      })

      const result = await dropboxClient.downloadFile('/photo.jpg', { sharedLinkUrl })

      expect(mockSharingGetSharedLinkFile).toHaveBeenCalledWith({
        url: sharedLinkUrl,
        path: '/photo.jpg',
      })
      expect(result).toEqual({
        buffer: fileBuffer,
        mimeType: 'image/jpeg',
        fileName: 'photo.jpg',
        size: 2048,
      })
    })

    it('throws DocumentTooLargeError for files exceeding limit', async () => {
      mockFilesGetMetadata.mockResolvedValueOnce({
        result: { '.tag': 'file', name: 'large.pdf', size: MAX_FILE_SIZE + 1 },
      })

      await expect(dropboxClient.downloadFile('id:large')).rejects.toThrow(DocumentTooLargeError)
    })

    it('throws error for non-file entries', async () => {
      mockFilesGetMetadata.mockResolvedValueOnce({
        result: { '.tag': 'folder', name: 'folder' },
      })

      await expect(dropboxClient.downloadFile('id:folder')).rejects.toThrow('Not a file')
    })
  })

  describe('resolveUrl', () => {
    it('resolves shared folder URL (sh format)', async () => {
      mockSharingGetSharedLinkMetadata.mockResolvedValueOnce({
        result: { '.tag': 'folder', path_lower: '/shared/folder' },
      })

      const result = await dropboxClient.resolveUrl('https://www.dropbox.com/sh/abc123/xyz?dl=0')

      expect(mockSharingGetSharedLinkMetadata).toHaveBeenCalledWith({
        url: 'https://www.dropbox.com/sh/abc123/xyz?dl=0',
      })
      expect(result).toEqual({ folderId: '/shared/folder' })
    })

    it('resolves shared folder URL (scl/fo format)', async () => {
      mockSharingGetSharedLinkMetadata.mockResolvedValueOnce({
        result: { '.tag': 'folder', path_lower: '/scl/folder' },
      })

      const result = await dropboxClient.resolveUrl('https://www.dropbox.com/scl/fo/abc123/xyz')

      expect(result).toEqual({ folderId: '/scl/folder' })
    })

    it('resolves home path URL', async () => {
      mockFilesGetMetadata.mockResolvedValueOnce({
        result: { '.tag': 'folder', name: 'Tax Documents' },
      })

      const result = await dropboxClient.resolveUrl('https://www.dropbox.com/home/Tax%20Documents')

      expect(mockFilesGetMetadata).toHaveBeenCalledWith({ path: '/Tax Documents' })
      expect(result).toEqual({ folderId: '/Tax Documents' })
    })

    it('returns null for non-folder shared links', async () => {
      mockSharingGetSharedLinkMetadata.mockResolvedValueOnce({
        result: { '.tag': 'file', name: 'file.pdf' },
      })

      const result = await dropboxClient.resolveUrl('https://www.dropbox.com/sh/abc/xyz')

      expect(result).toBe(null)
    })

    it('returns null for failed lookups', async () => {
      mockSharingGetSharedLinkMetadata.mockRejectedValueOnce(new Error('Not found'))

      const result = await dropboxClient.resolveUrl('https://www.dropbox.com/sh/invalid/xyz')

      expect(result).toBe(null)
    })

    it('returns null for unrecognized URL format', async () => {
      const result = await dropboxClient.resolveUrl('https://www.dropbox.com/unknown/path')

      expect(result).toBe(null)
    })
  })

  describe('MIME type detection', () => {
    beforeEach(() => {
      mockFilesListFolder.mockResolvedValue({
        result: {
          entries: [],
          cursor: 'cursor',
          has_more: false,
        },
      })
    })

    it('detects common file types', async () => {
      mockFilesListFolder.mockResolvedValueOnce({
        result: {
          entries: [
            { '.tag': 'file', id: 'id:1', name: 'doc.pdf' },
            { '.tag': 'file', id: 'id:2', name: 'photo.jpg' },
            { '.tag': 'file', id: 'id:3', name: 'image.jpeg' },
            { '.tag': 'file', id: 'id:4', name: 'pic.png' },
            { '.tag': 'file', id: 'id:5', name: 'word.docx' },
            { '.tag': 'file', id: 'id:6', name: 'sheet.xlsx' },
            { '.tag': 'file', id: 'id:7', name: 'data.csv' },
            { '.tag': 'file', id: 'id:8', name: 'unknown.xyz' },
          ],
          cursor: 'cursor',
          has_more: false,
        },
      })

      const result = await dropboxClient.syncFolder('/folder', null)

      expect(result.files[0].mimeType).toBe('application/pdf')
      expect(result.files[1].mimeType).toBe('image/jpeg')
      expect(result.files[2].mimeType).toBe('image/jpeg')
      expect(result.files[3].mimeType).toBe('image/png')
      expect(result.files[4].mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      expect(result.files[5].mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      expect(result.files[6].mimeType).toBe('text/csv')
      expect(result.files[7].mimeType).toBe('application/octet-stream')
    })
  })
})
