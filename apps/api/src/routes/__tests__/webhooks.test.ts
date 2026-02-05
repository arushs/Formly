import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import crypto from 'crypto'
import webhookRoutes from '../webhooks.js'
import { createMockEngagement, resetIdCounter } from '../../test/factories.js'

// Mock dependencies
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    engagement: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../../lib/openai.js', () => ({
  generateChecklist: vi.fn(async () => [
    {
      id: 'item_001',
      title: 'W-2 from Employer',
      why: 'Required for tax filing',
      priority: 'high',
      status: 'pending',
      documentIds: [],
      expectedDocumentType: 'W-2',
    },
  ]),
}))

vi.mock('../../lib/agents/dispatcher.js', () => ({
  dispatch: vi.fn(async () => {}),
}))

vi.mock('../../workers/background.js', () => ({
  runInBackground: vi.fn((fn: () => void) => fn()),
}))

import { prisma } from '../../lib/prisma.js'
import { dispatch } from '../../lib/agents/dispatcher.js'

const app = new Hono().route('/api/webhooks', webhookRoutes)

function createRequest(path: string, options?: RequestInit): Request {
  return new Request(`http://localhost${path}`, options)
}

function createSignature(payload: string, secret: string): string {
  const hash = crypto.createHmac('sha256', secret).update(payload).digest('base64')
  return `sha256=${hash}`
}

describe('Webhook Routes', () => {
  const webhookSecret = 'test-webhook-secret'

  beforeEach(() => {
    vi.clearAllMocks()
    resetIdCounter()
    process.env.TYPEFORM_WEBHOOK_SECRET = webhookSecret
  })

  describe('POST /api/webhooks/typeform', () => {
    it('processes valid webhook with correct signature', async () => {
      const payload = {
        event_id: 'event_123',
        form_response: {
          hidden: { engagement_id: 'eng_123' },
          answers: [],
        },
      }
      const body = JSON.stringify(payload)
      const signature = createSignature(body, webhookSecret)

      const mockEngagement = createMockEngagement({ id: 'eng_123' })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/webhooks/typeform', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'typeform-signature': signature,
          },
          body,
        })
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe('processing')
    })

    it('returns 401 for missing signature', async () => {
      const payload = {
        event_id: 'event_123',
        form_response: { hidden: { engagement_id: 'eng_123' } },
      }

      const res = await app.request(
        createRequest('/api/webhooks/typeform', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      )

      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toBe('Invalid signature')
    })

    it('returns 401 for invalid signature', async () => {
      const payload = {
        event_id: 'event_123',
        form_response: { hidden: { engagement_id: 'eng_123' } },
      }

      const res = await app.request(
        createRequest('/api/webhooks/typeform', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'typeform-signature': 'sha256=invalid',
          },
          body: JSON.stringify(payload),
        })
      )

      expect(res.status).toBe(401)
    })

    it('returns 400 for missing engagement_id', async () => {
      const payload = {
        event_id: 'event_456',
        form_response: {
          hidden: {}, // No engagement_id
          answers: [],
        },
      }
      const body = JSON.stringify(payload)
      const signature = createSignature(body, webhookSecret)

      const res = await app.request(
        createRequest('/api/webhooks/typeform', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'typeform-signature': signature,
          },
          body,
        })
      )

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe('Missing engagement_id')
    })

    it('handles duplicate events', async () => {
      const payload = {
        event_id: 'duplicate_event',
        form_response: {
          hidden: { engagement_id: 'eng_123' },
          answers: [],
        },
      }
      const body = JSON.stringify(payload)
      const signature = createSignature(body, webhookSecret)

      const mockEngagement = createMockEngagement({ id: 'eng_123' })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValue(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValue(mockEngagement as any)

      // First request
      await app.request(
        createRequest('/api/webhooks/typeform', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'typeform-signature': signature,
          },
          body,
        })
      )

      // Second request with same event_id
      const res = await app.request(
        createRequest('/api/webhooks/typeform', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'typeform-signature': signature,
          },
          body,
        })
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe('duplicate')
    })

    it('triggers checklist generation and intake_complete dispatch', async () => {
      const payload = {
        event_id: 'event_789',
        form_response: {
          hidden: { engagement_id: 'eng_123' },
          answers: [{ field: { type: 'text' }, text: 'W-2 Employee' }],
        },
      }
      const body = JSON.stringify(payload)
      const signature = createSignature(body, webhookSecret)

      const mockEngagement = createMockEngagement({ id: 'eng_123', taxYear: 2025 })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce({
        ...mockEngagement,
        status: 'INTAKE_DONE',
      } as any)

      const res = await app.request(
        createRequest('/api/webhooks/typeform', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'typeform-signature': signature,
          },
          body,
        })
      )

      expect(res.status).toBe(200)

      // Wait for background processing
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(dispatch).toHaveBeenCalledWith({
        type: 'intake_complete',
        engagementId: 'eng_123',
      })
    })
  })
})
