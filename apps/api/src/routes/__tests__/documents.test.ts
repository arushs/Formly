import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import documentRoutes from '../documents.js'
import { createMockEngagement, createMockDocument, resetIdCounter } from '../../test/factories.js'

// Mock dependencies
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    engagement: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../../lib/email.js', () => ({
  sendEmail: vi.fn(async () => ({ id: 'email_123' })),
}))

vi.mock('../../lib/openai.js', () => ({
  generateFollowUpEmail: vi.fn(async () => ({
    subject: 'Action Needed: Document Issue',
    body: 'Please provide the corrected document.',
  })),
  generateFriendlyIssues: vi.fn(async () => [
    {
      original: 'Wrong year',
      friendlyMessage: 'This document is from 2024',
      suggestedAction: 'Request 2025 version',
      severity: 'error',
    },
  ]),
}))

vi.mock('../../lib/agents/reconciliation.js', () => ({
  runReconciliationAgent: vi.fn(async () => ({
    isReady: false,
    completionPercentage: 50,
  })),
}))

import { prisma } from '../../lib/prisma.js'
import { sendEmail } from '../../lib/email.js'
import { generateFollowUpEmail, generateFriendlyIssues } from '../../lib/openai.js'

const app = new Hono().route('/api/engagements', documentRoutes)

function createRequest(path: string, options?: RequestInit): Request {
  return new Request(`http://localhost${path}`, options)
}

describe('Document Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetAllMocks()
    resetIdCounter()
  })

  describe('POST /api/engagements/:engagementId/documents/:docId/approve', () => {
    it('approves document successfully', async () => {
      const doc = createMockDocument({ id: 'doc_123', approved: null })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/approve', {
          method: 'POST',
        })
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.document.approved).toBe(true)
      expect(data.document.approvedAt).toBeDefined()
    })

    it('returns 404 for non-existent engagement', async () => {
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(null)

      const res = await app.request(
        createRequest('/api/engagements/nonexistent/documents/doc_123/approve', {
          method: 'POST',
        })
      )

      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe('Engagement not found')
    })

    it('returns 404 for non-existent document', async () => {
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/nonexistent/approve', {
          method: 'POST',
        })
      )

      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe('Document not found')
    })
  })

  describe('POST /api/engagements/:engagementId/documents/:docId/reclassify', () => {
    it('reclassifies document successfully', async () => {
      const doc = createMockDocument({ id: 'doc_123', documentType: 'W-2' })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/reclassify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newType: '1099-NEC' }),
        })
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.document.documentType).toBe('1099-NEC')
      expect(data.document.override.originalType).toBe('W-2')
    })

    it('returns 400 for invalid document type', async () => {
      const doc = createMockDocument({ id: 'doc_123' })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/reclassify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newType: 'INVALID_TYPE' }),
        })
      )

      expect(res.status).toBe(400)
    })

    it('returns 404 for non-existent document', async () => {
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/nonexistent/reclassify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newType: 'W-2' }),
        })
      )

      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/engagements/:engagementId/documents/:docId/email-preview', () => {
    it('generates email preview for document with issues', async () => {
      const doc = createMockDocument({
        id: 'doc_123',
        issues: ['[ERROR:wrong_year:2025:2024] Wrong year'],
      })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/email-preview')
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.subject).toBeDefined()
      expect(data.body).toBeDefined()
      expect(data.recipientEmail).toBe('client@example.com')
    })

    it('returns 400 for document without issues', async () => {
      const doc = createMockDocument({ id: 'doc_123', issues: [] })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/email-preview')
      )

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('no issues')
    })

    it('returns 404 for non-existent engagement', async () => {
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(null)

      const res = await app.request(
        createRequest('/api/engagements/nonexistent/documents/doc_123/email-preview')
      )

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/engagements/:engagementId/documents/:docId/send-followup', () => {
    it('sends follow-up email with custom content', async () => {
      const doc = createMockDocument({ id: 'doc_123' })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/send-followup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: 'Custom Subject',
            body: 'Custom message body',
          }),
        })
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(sendEmail).toHaveBeenCalledWith(
        'client@example.com',
        expect.objectContaining({ subject: 'Custom Subject' })
      )
    })

    it('sends email to custom address', async () => {
      const doc = createMockDocument({ id: 'doc_123' })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/send-followup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'other@example.com',
            subject: 'Test',
            body: 'Test body',
          }),
        })
      )

      expect(res.status).toBe(200)
      expect(sendEmail).toHaveBeenCalledWith('other@example.com', expect.any(Object))
    })

    it('generates email content when not provided', async () => {
      const doc = createMockDocument({
        id: 'doc_123',
        issues: ['[ERROR:wrong_year:2025:2024] Wrong year'],
      })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/send-followup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      )

      expect(res.status).toBe(200)
      expect(generateFollowUpEmail).toHaveBeenCalled()
    })

    it('returns 400 for document without issues when no content provided', async () => {
      const doc = createMockDocument({ id: 'doc_123', issues: [] })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/send-followup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      )

      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/engagements/:engagementId/documents/:docId/friendly-issues', () => {
    it('returns cached issue details when available', async () => {
      const cachedIssues = [
        {
          original: 'Wrong year',
          friendlyMessage: 'This is cached',
          suggestedAction: 'Do something',
          severity: 'error',
        },
      ]
      const doc = createMockDocument({
        id: 'doc_123',
        issues: ['[ERROR:wrong_year:2025:2024] Wrong year'],
        issueDetails: cachedIssues,
      })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/friendly-issues')
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.issues[0].friendlyMessage).toBe('This is cached')
      expect(generateFriendlyIssues).not.toHaveBeenCalled()
    })

    it('generates friendly issues for legacy documents', async () => {
      const doc = createMockDocument({
        id: 'doc_123',
        issues: ['[ERROR:wrong_year:2025:2024] Wrong year'],
        issueDetails: null,
      })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/friendly-issues')
      )

      expect(res.status).toBe(200)
      expect(generateFriendlyIssues).toHaveBeenCalled()
    })

    it('returns empty array for document without issues', async () => {
      const doc = createMockDocument({ id: 'doc_123', issues: [] })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/friendly-issues')
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.issues).toEqual([])
    })

    it('returns 404 for non-existent document', async () => {
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/nonexistent/friendly-issues')
      )

      expect(res.status).toBe(404)
    })
  })
})
