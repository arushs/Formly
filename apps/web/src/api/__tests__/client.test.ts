import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getEngagements,
  getEngagement,
  createEngagement,
  generateBrief,
  approveDocument,
  reclassifyDocument,
  getEmailPreview,
  sendDocumentFollowUp,
  getFriendlyIssues,
  DOCUMENT_TYPES,
} from '../client'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('API Client', () => {
  beforeEach(() => {
    mockFetch.mockClear()
  })

  const mockEngagement = {
    id: 'eng_001',
    clientName: 'Test Client',
    clientEmail: 'test@example.com',
    taxYear: 2025,
    status: 'COLLECTING',
    storageProvider: 'dropbox',
    storageFolderUrl: 'https://dropbox.com/sh/test',
    typeformFormId: 'form_123',
    checklist: null,
    documents: null,
    reconciliation: null,
    prepBrief: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  }

  describe('getEngagements', () => {
    it('fetches list of engagements', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [mockEngagement],
      })

      const result = await getEngagements()

      expect(mockFetch).toHaveBeenCalledWith('/api/engagements', expect.any(Object))
      expect(result).toHaveLength(1)
      expect(result[0].clientName).toBe('Test Client')
    })

    it('handles error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      })

      await expect(getEngagements()).rejects.toThrow('Server error')
    })
  })

  describe('getEngagement', () => {
    it('fetches single engagement by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEngagement,
      })

      const result = await getEngagement('eng_001')

      expect(mockFetch).toHaveBeenCalledWith('/api/engagements/eng_001', expect.any(Object))
      expect(result.id).toBe('eng_001')
    })

    it('handles 404 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Engagement not found' }),
      })

      await expect(getEngagement('nonexistent')).rejects.toThrow('Engagement not found')
    })
  })

  describe('createEngagement', () => {
    it('creates new engagement', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEngagement,
      })

      const data = {
        clientName: 'Test Client',
        clientEmail: 'test@example.com',
        storageFolderUrl: 'https://dropbox.com/sh/test',
      }

      const result = await createEngagement(data)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/engagements',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(data),
        })
      )
      expect(result.clientName).toBe('Test Client')
    })

    it('handles validation error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: { issues: [{ message: 'Invalid email' }] },
        }),
      })

      const data = {
        clientName: 'Test',
        clientEmail: 'invalid',
        storageFolderUrl: 'https://dropbox.com/sh/test',
      }

      await expect(createEngagement(data)).rejects.toThrow()
    })
  })

  describe('generateBrief', () => {
    it('generates prep brief', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, brief: '# Prep Brief' }),
      })

      const result = await generateBrief('eng_001')

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/engagements/eng_001/brief',
        expect.objectContaining({ method: 'POST' })
      )
      expect(result.success).toBe(true)
      expect(result.brief).toBe('# Prep Brief')
    })
  })

  describe('approveDocument', () => {
    it('approves document', async () => {
      const approvedDoc = {
        id: 'doc_001',
        fileName: 'w2.pdf',
        documentType: 'W-2',
        approved: true,
        approvedAt: '2025-01-15T00:00:00Z',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, document: approvedDoc }),
      })

      const result = await approveDocument('eng_001', 'doc_001')

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/engagements/eng_001/documents/doc_001/approve',
        expect.objectContaining({ method: 'POST' })
      )
      expect(result.document.approved).toBe(true)
    })
  })

  describe('reclassifyDocument', () => {
    it('reclassifies document', async () => {
      const reclassifiedDoc = {
        id: 'doc_001',
        fileName: 'doc.pdf',
        documentType: '1099-NEC',
        override: { originalType: 'W-2', reason: 'Reclassified' },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, document: reclassifiedDoc }),
      })

      const result = await reclassifyDocument('eng_001', 'doc_001', '1099-NEC')

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/engagements/eng_001/documents/doc_001/reclassify',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ newType: '1099-NEC' }),
        })
      )
      expect(result.document.documentType).toBe('1099-NEC')
    })
  })

  describe('getEmailPreview', () => {
    it('gets email preview', async () => {
      const preview = {
        subject: 'Action Needed',
        body: 'Please provide corrected document.',
        recipientEmail: 'test@example.com',
        uploadUrl: 'https://dropbox.com/sh/test',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => preview,
      })

      const result = await getEmailPreview('eng_001', 'doc_001')

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/engagements/eng_001/documents/doc_001/email-preview',
        expect.any(Object)
      )
      expect(result.subject).toBe('Action Needed')
    })
  })

  describe('sendDocumentFollowUp', () => {
    it('sends follow-up email', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: 'Email sent' }),
      })

      const result = await sendDocumentFollowUp('eng_001', 'doc_001', {
        email: 'test@example.com',
        subject: 'Test Subject',
        body: 'Test body',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/engagements/eng_001/documents/doc_001/send-followup',
        expect.objectContaining({ method: 'POST' })
      )
      expect(result.success).toBe(true)
    })
  })

  describe('getFriendlyIssues', () => {
    it('gets friendly issues', async () => {
      const issues = [
        {
          original: 'Wrong year',
          friendlyMessage: 'Document is from 2024',
          suggestedAction: 'Request 2025 version',
          severity: 'error',
        },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ issues }),
      })

      const result = await getFriendlyIssues('eng_001', 'doc_001')

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/engagements/eng_001/documents/doc_001/friendly-issues',
        expect.any(Object)
      )
      expect(result.issues).toHaveLength(1)
    })
  })

  describe('DOCUMENT_TYPES', () => {
    it('exports document types constant', () => {
      expect(DOCUMENT_TYPES).toContain('W-2')
      expect(DOCUMENT_TYPES).toContain('1099-NEC')
      expect(DOCUMENT_TYPES).toContain('PENDING')
    })
  })

  describe('error handling', () => {
    it('handles network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(getEngagements()).rejects.toThrow('Network error')
    })

    it('handles response with error message object', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Detailed error' } }),
      })

      await expect(getEngagements()).rejects.toThrow('Detailed error')
    })

    it('handles response with unknown error format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      })

      await expect(getEngagements()).rejects.toThrow('HTTP 500')
    })
  })
})
