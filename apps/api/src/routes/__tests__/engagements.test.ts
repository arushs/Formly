import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import engagementRoutes from '../engagements.js'
import { createMockEngagement, createMockChecklistItem, createMockDocument, createMockReconciliation, resetIdCounter } from '../../test/factories.js'

// Mock dependencies
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    engagement: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../../lib/storage/index.js', () => ({
  detectProvider: vi.fn((url: string) => {
    if (url.includes('dropbox.com')) return 'dropbox'
    if (url.includes('drive.google.com')) return 'google-drive'
    return null
  }),
  getStorageClient: vi.fn(() => ({
    resolveUrl: vi.fn(async () => ({ folderId: '/test-folder' })),
  })),
}))

vi.mock('../../lib/agents/dispatcher.js', () => ({
  dispatch: vi.fn(async () => {}),
}))

vi.mock('../../lib/agents/reconciliation.js', () => ({
  runReconciliationAgent: vi.fn(async () => ({
    isReady: false,
    completionPercentage: 50,
  })),
}))

vi.mock('../../lib/openai.js', () => ({
  generatePrepBrief: vi.fn(async () => '# Prep Brief\n\nAll documents collected.'),
}))

vi.mock('../../workers/background.js', () => ({
  runInBackground: vi.fn((fn: () => void) => fn()),
}))

import { prisma } from '../../lib/prisma.js'
import { runReconciliationAgent } from '../../lib/agents/reconciliation.js'

const app = new Hono().route('/api/engagements', engagementRoutes)

function createRequest(path: string, options?: RequestInit): Request {
  return new Request(`http://localhost${path}`, options)
}

describe('Engagement Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetIdCounter()
    process.env.TYPEFORM_FORM_ID = 'test-form-id'
  })

  describe('GET /api/engagements', () => {
    it('returns list of engagements', async () => {
      const mockEngagements = [
        createMockEngagement({ id: 'eng_1', clientName: 'Client 1' }),
        createMockEngagement({ id: 'eng_2', clientName: 'Client 2' }),
      ]
      vi.mocked(prisma.engagement.findMany).mockResolvedValueOnce(mockEngagements as any)

      const res = await app.request(createRequest('/api/engagements'))

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveLength(2)
      expect(data[0].clientName).toBe('Client 1')
    })

    it('returns empty array when no engagements', async () => {
      vi.mocked(prisma.engagement.findMany).mockResolvedValueOnce([])

      const res = await app.request(createRequest('/api/engagements'))

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual([])
    })
  })

  describe('POST /api/engagements', () => {
    it('creates engagement with valid data', async () => {
      const newEngagement = createMockEngagement({
        clientName: 'New Client',
        clientEmail: 'new@example.com',
      })
      vi.mocked(prisma.engagement.create).mockResolvedValueOnce(newEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientName: 'New Client',
            clientEmail: 'new@example.com',
            storageFolderUrl: 'https://www.dropbox.com/sh/test',
          }),
        })
      )

      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.clientName).toBe('New Client')
    })

    it('returns 400 for unsupported storage URL', async () => {
      const res = await app.request(
        createRequest('/api/engagements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientName: 'Test',
            clientEmail: 'test@example.com',
            storageFolderUrl: 'https://example.com/files',
          }),
        })
      )

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('Unsupported storage URL')
    })

    it('returns validation error for missing fields', async () => {
      const res = await app.request(
        createRequest('/api/engagements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientName: 'Test',
            // missing clientEmail and storageFolderUrl
          }),
        })
      )

      expect(res.status).toBe(400)
    })

    it('returns validation error for invalid email', async () => {
      const res = await app.request(
        createRequest('/api/engagements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientName: 'Test',
            clientEmail: 'not-an-email',
            storageFolderUrl: 'https://www.dropbox.com/sh/test',
          }),
        })
      )

      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/engagements/:id', () => {
    it('returns engagement when found', async () => {
      const mockEngagement = createMockEngagement({ id: 'eng_123' })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(createRequest('/api/engagements/eng_123'))

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.id).toBe('eng_123')
    })

    it('returns 404 when not found', async () => {
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(null)

      const res = await app.request(createRequest('/api/engagements/nonexistent'))

      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe('Engagement not found')
    })
  })

  describe('PATCH /api/engagements/:id', () => {
    it('updates engagement fields', async () => {
      const existing = createMockEngagement({ id: 'eng_123' })
      const updated = { ...existing, storageFolderId: '/new-folder' }
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(existing as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce(updated as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storageFolderId: '/new-folder' }),
        })
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.storageFolderId).toBe('/new-folder')
    })

    it('returns 404 for non-existent engagement', async () => {
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(null)

      const res = await app.request(
        createRequest('/api/engagements/nonexistent', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storageFolderId: '/folder' }),
        })
      )

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/engagements/:id/brief', () => {
    it('generates brief for READY engagement', async () => {
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        status: 'READY',
        checklist: [createMockChecklistItem()],
        documents: [createMockDocument()],
        reconciliation: createMockReconciliation(),
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce({ ...mockEngagement, prepBrief: '# Brief' } as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/brief', { method: 'POST' })
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.brief).toContain('# Prep Brief')
    })

    it('returns 400 for non-READY engagement', async () => {
      const mockEngagement = createMockEngagement({ id: 'eng_123', status: 'COLLECTING' })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/brief', { method: 'POST' })
      )

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('READY status')
    })

    it('returns 404 for non-existent engagement', async () => {
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(null)

      const res = await app.request(
        createRequest('/api/engagements/nonexistent/brief', { method: 'POST' })
      )

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/engagements/:id/retry-documents', () => {
    it('retries pending documents', async () => {
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [
          createMockDocument({ id: 'doc_1', documentType: 'PENDING' }),
          createMockDocument({ id: 'doc_2', documentType: 'W-2' }),
        ],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/retry-documents', { method: 'POST' })
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.retried).toBe(1)
      expect(data.documentIds).toContain('doc_1')
    })

    it('returns message when no pending documents', async () => {
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [createMockDocument({ documentType: 'W-2' })],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/retry-documents', { method: 'POST' })
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.retried).toBe(0)
    })
  })

  describe('POST /api/engagements/:id/reconcile', () => {
    it('triggers reconciliation', async () => {
      const mockEngagement = createMockEngagement({ id: 'eng_123' })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(runReconciliationAgent).mockResolvedValueOnce({
        isReady: true,
        completionPercentage: 100,
      })

      const res = await app.request(
        createRequest('/api/engagements/eng_123/reconcile', { method: 'POST' })
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.isReady).toBe(true)
      expect(data.completionPercentage).toBe(100)
    })

    it('returns 404 for non-existent engagement', async () => {
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(null)

      const res = await app.request(
        createRequest('/api/engagements/nonexistent/reconcile', { method: 'POST' })
      )

      expect(res.status).toBe(404)
    })
  })
})
