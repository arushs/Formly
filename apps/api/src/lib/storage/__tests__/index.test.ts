import { describe, it, expect } from 'vitest'
import { detectProvider, getStorageClient } from '../index.js'

describe('detectProvider', () => {
  describe('Dropbox URLs', () => {
    it('detects Dropbox shared folder URL (sh format)', () => {
      expect(detectProvider('https://www.dropbox.com/sh/abc123/xyz?dl=0')).toBe('dropbox')
    })

    it('detects Dropbox shared folder URL (scl/fo format)', () => {
      expect(detectProvider('https://www.dropbox.com/scl/fo/abc123/xyz?dl=0')).toBe('dropbox')
    })

    it('detects Dropbox home URL', () => {
      expect(detectProvider('https://www.dropbox.com/home/Documents/Tax')).toBe('dropbox')
    })

    it('detects Dropbox without www', () => {
      expect(detectProvider('https://dropbox.com/sh/abc123/xyz')).toBe('dropbox')
    })
  })

  describe('Google Drive URLs', () => {
    it('detects Google Drive folder URL', () => {
      expect(detectProvider('https://drive.google.com/drive/folders/abc123')).toBe('google-drive')
    })

    it('detects Google Drive shared URL', () => {
      expect(detectProvider('https://drive.google.com/drive/u/0/folders/abc123')).toBe('google-drive')
    })
  })

  describe('SharePoint URLs', () => {
    it('detects SharePoint URL', () => {
      expect(detectProvider('https://company.sharepoint.com/sites/team/Shared%20Documents')).toBe('sharepoint')
    })

    it('detects OneDrive personal URL', () => {
      expect(detectProvider('https://onedrive.com/personal/user/Documents')).toBe('sharepoint')
    })

    it('detects OneDrive for Business URL', () => {
      expect(detectProvider('https://company-my.sharepoint.com/personal/user/Documents')).toBe('sharepoint')
    })
  })

  describe('invalid URLs', () => {
    it('returns null for unknown URLs', () => {
      expect(detectProvider('https://example.com/files')).toBe(null)
    })

    it('returns null for empty string', () => {
      expect(detectProvider('')).toBe(null)
    })

    it('returns null for non-storage URLs', () => {
      expect(detectProvider('https://github.com/repo')).toBe(null)
    })
  })
})

describe('getStorageClient', () => {
  it('returns dropbox client for dropbox provider', () => {
    const client = getStorageClient('dropbox')
    expect(client).toBeDefined()
    expect(client.syncFolder).toBeDefined()
    expect(client.downloadFile).toBeDefined()
    expect(client.resolveUrl).toBeDefined()
  })

  it('returns google drive client for google-drive provider', () => {
    const client = getStorageClient('google-drive')
    expect(client).toBeDefined()
    expect(client.syncFolder).toBeDefined()
  })

  it('returns sharepoint client for sharepoint provider', () => {
    const client = getStorageClient('sharepoint')
    expect(client).toBeDefined()
    expect(client.syncFolder).toBeDefined()
  })

  it('throws for unknown provider', () => {
    expect(() => getStorageClient('unknown' as any)).toThrow('Unknown storage provider')
  })
})
