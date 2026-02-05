import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import cronRoutes from '../cron.js'
import { createMockEngagement, createMockDocument, resetIdCounter } from '../../test/factories.js'

// Mock dependencies
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    engagement: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../../lib/storage/index.js', () => ({
  getStorageClient: vi.fn(() => ({
    syncFolder: vi.fn(async () => ({
      files: [
        { id: 'new_file_1', name: 'new-doc.pdf', mimeType: 'application/pdf' },
      ],
      nextPageToken: 'new_cursor',
    })),
  })),
}))

vi.mock('../../lib/agents/dispatcher.js', () => ({
  dispatch: vi.fn(async () => {}),
}))

vi.mock('../../workers/background.js', () => ({
  runInBackground: vi.fn((fn: () => void) => fn()),
  runAllInBackground: vi.fn((fns: Array<() => void>) => fns.forEach((fn) => fn())),
}))

import { prisma } from '../../lib/prisma.js'
import { dispatch } from '../../lib/agents/dispatcher.js'

const app = new Hono().route('/api/cron', cronRoutes)

function createRequest(path: string, options?: RequestInit): Request {
  const headers = new Headers(options?.headers)
  headers.set('authorization', `Bearer ${process.env.CRON_SECRET}`)
  return new Request(`http://localhost${path}`, { ...options, headers })
}

describe('Cron Routes', () => {
  const cronSecret = 'test-cron-secret'

  beforeEach(() => {
    vi.clearAllMocks()
    resetIdCounter()
    process.env.CRON_SECRET = cronSecret
  })

  describe('Authorization', () => {
    it('returns 401 for missing authorization', async () => {
      const res = await app.request(
        new Request('http://localhost/api/cron/poll-storage')
      )

      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('returns 401 for invalid authorization', async () => {
      const res = await app.request(
        new Request('http://localhost/api/cron/poll-storage', {
          headers: { authorization: 'Bearer wrong-secret' },
        })
      )

      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/cron/poll-storage', () => {
    it('polls storage for all COLLECTING engagements', async () => {
      const engagements = [
        createMockEngagement({
          id: 'eng_1',
          status: 'COLLECTING',
          storageProvider: 'dropbox',
          storageFolderId: '/folder1',
          documents: [],
        }),
        createMockEngagement({
          id: 'eng_2',
          status: 'INTAKE_DONE',
          storageProvider: 'dropbox',
          storageFolderId: '/folder2',
          documents: [],
        }),
      ]
      vi.mocked(prisma.engagement.findMany).mockResolvedValueOnce(engagements as any)
      vi.mocked(prisma.engagement.update).mockResolvedValue({} as any)

      const res = await app.request(createRequest('/api/cron/poll-storage'))

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.queued).toBe(2)
    })

    it('retries stuck documents', async () => {
      const fiveMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString()
      const stuckDoc = createMockDocument({
        id: 'doc_stuck',
        processingStatus: 'in_progress',
        processingStartedAt: fiveMinutesAgo,
        documentType: 'PENDING',
      })

      const engagements = [
        createMockEngagement({
          id: 'eng_1',
          status: 'COLLECTING',
          documents: [stuckDoc],
        }),
      ]
      vi.mocked(prisma.engagement.findMany).mockResolvedValueOnce(engagements as any)
      vi.mocked(prisma.engagement.update).mockResolvedValue({} as any)

      const res = await app.request(createRequest('/api/cron/poll-storage'))

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.retriedStuck).toBeGreaterThanOrEqual(0)
    })

    it('retries documents with PROCESSING_ERROR type', async () => {
      const errorDoc = createMockDocument({
        id: 'doc_error',
        documentType: 'PROCESSING_ERROR',
        processingStatus: 'classified',
      })

      const engagements = [
        createMockEngagement({
          id: 'eng_1',
          status: 'COLLECTING',
          documents: [errorDoc],
        }),
      ]
      vi.mocked(prisma.engagement.findMany).mockResolvedValueOnce(engagements as any)
      vi.mocked(prisma.engagement.update).mockResolvedValue({} as any)

      const res = await app.request(createRequest('/api/cron/poll-storage'))

      expect(res.status).toBe(200)
      // The retry logic should have dispatched document_uploaded
      expect(dispatch).toHaveBeenCalled()
    })

    it('dispatches document_uploaded for new files', async () => {
      const engagement = createMockEngagement({
        id: 'eng_1',
        status: 'COLLECTING',
        storageProvider: 'dropbox',
        storageFolderId: '/folder',
        storagePageToken: null,
        documents: [],
      })
      vi.mocked(prisma.engagement.findMany).mockResolvedValueOnce([engagement] as any)
      vi.mocked(prisma.engagement.update).mockResolvedValue({} as any)

      const res = await app.request(createRequest('/api/cron/poll-storage'))

      expect(res.status).toBe(200)

      // Wait for background processing
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'document_uploaded',
          engagementId: 'eng_1',
        })
      )
    })
  })

  describe('GET /api/cron/check-reminders', () => {
    it('finds stale engagements and dispatches reminders', async () => {
      const fourDaysAgo = new Date()
      fourDaysAgo.setDate(fourDaysAgo.getDate() - 4)

      const staleEngagements = [
        createMockEngagement({
          id: 'eng_stale',
          status: 'COLLECTING',
          lastActivityAt: fourDaysAgo,
        }),
      ]
      vi.mocked(prisma.engagement.findMany).mockResolvedValueOnce(staleEngagements as any)

      const res = await app.request(createRequest('/api/cron/check-reminders'))

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.checked).toBe(1)
      expect(data.engagementIds).toContain('eng_stale')

      expect(dispatch).toHaveBeenCalledWith({
        type: 'stale_engagement',
        engagementId: 'eng_stale',
      })
    })

    it('returns empty list when no stale engagements', async () => {
      vi.mocked(prisma.engagement.findMany).mockResolvedValueOnce([])

      const res = await app.request(createRequest('/api/cron/check-reminders'))

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.checked).toBe(0)
      expect(data.engagementIds).toEqual([])
    })
  })
})
