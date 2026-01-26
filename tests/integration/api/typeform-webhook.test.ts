import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import { prismaMock } from '../../mocks/prisma'
import { createMockRequest } from '../../helpers/request-factory'
import { createEngagement, createChecklistItem } from '../../helpers/fixtures'

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/openai', () => ({
  generateChecklist: vi.fn().mockResolvedValue([
    { id: 'item_001', title: 'W-2 Form', why: 'Report wages', priority: 'high', status: 'pending', documentIds: [] },
  ]),
}))

vi.mock('@/lib/agents/dispatcher', () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@vercel/functions', () => ({
  waitUntil: vi.fn((promise) => promise),
}))

import { POST } from '@/app/api/webhooks/typeform/route'
import { generateChecklist } from '@/lib/openai'
import { dispatch } from '@/lib/agents/dispatcher'

describe('POST /api/webhooks/typeform', () => {
  const secret = 'test-typeform-secret'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('TYPEFORM_WEBHOOK_SECRET', secret)
  })

  function signPayload(payload: string): string {
    const hash = crypto.createHmac('sha256', secret).update(payload).digest('base64')
    return `sha256=${hash}`
  }

  // Generate unique event IDs to avoid dedup interference between tests
  let eventCounter = 0
  function createTypeformPayload(engagementId: string, eventId?: string) {
    return {
      event_id: eventId ?? `evt-${Date.now()}-${++eventCounter}`,
      form_response: {
        form_id: 'form-123',
        hidden: {
          engagement_id: engagementId,
        },
        answers: [
          { field: { id: 'q1' }, text: 'W2 employee' },
          { field: { id: 'q2' }, boolean: true },
        ],
      },
    }
  }

  it('should reject request with missing signature', async () => {
    const body = JSON.stringify(createTypeformPayload('eng-1'))
    const request = new Request('http://localhost/api/webhooks/typeform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    const response = await POST(request)

    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBe('Invalid signature')
  })

  it('should reject request with invalid signature', async () => {
    const body = JSON.stringify(createTypeformPayload('eng-1'))
    const request = new Request('http://localhost/api/webhooks/typeform', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'typeform-signature': 'sha256=invalid-signature',
      },
      body,
    })

    const response = await POST(request)

    expect(response.status).toBe(401)
  })

  it('should reject request with missing engagement_id', async () => {
    const payload = {
      event_id: 'evt-123',
      form_response: {
        form_id: 'form-123',
        hidden: {}, // no engagement_id
        answers: [],
      },
    }
    const body = JSON.stringify(payload)
    const request = new Request('http://localhost/api/webhooks/typeform', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'typeform-signature': signPayload(body),
      },
      body,
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Missing engagement_id')
  })

  it('should process valid webhook and generate checklist', async () => {
    const engagement = createEngagement({ id: 'eng-1', taxYear: 2024 })
    prismaMock.engagement.findUnique.mockResolvedValue(engagement)
    prismaMock.engagement.update.mockResolvedValue({
      ...engagement,
      status: 'INTAKE_DONE',
    })

    const payload = createTypeformPayload('eng-1')
    const body = JSON.stringify(payload)
    const request = new Request('http://localhost/api/webhooks/typeform', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'typeform-signature': signPayload(body),
      },
      body,
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.status).toBe('processing')
    expect(generateChecklist).toHaveBeenCalledWith(payload.form_response, 2024)
    expect(prismaMock.engagement.update).toHaveBeenCalledWith({
      where: { id: 'eng-1' },
      data: expect.objectContaining({
        status: 'INTAKE_DONE',
      }),
    })
  })

  it('should dispatch intake_complete event after processing', async () => {
    const engagement = createEngagement({ id: 'eng-1', taxYear: 2024 })
    prismaMock.engagement.findUnique.mockResolvedValue(engagement)
    prismaMock.engagement.update.mockResolvedValue({
      ...engagement,
      status: 'INTAKE_DONE',
    })

    const payload = createTypeformPayload('eng-1')
    const body = JSON.stringify(payload)
    const request = new Request('http://localhost/api/webhooks/typeform', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'typeform-signature': signPayload(body),
      },
      body,
    })

    await POST(request)

    // Give the waitUntil promise time to complete
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(dispatch).toHaveBeenCalledWith({
      type: 'intake_complete',
      engagementId: 'eng-1',
    })
  })

  it('should deduplicate events with same event_id', async () => {
    const engagement = createEngagement({ id: 'eng-1' })
    prismaMock.engagement.findUnique.mockResolvedValue(engagement)
    prismaMock.engagement.update.mockResolvedValue(engagement)

    // Use a unique event_id for this test to avoid interference
    const uniqueEventId = `evt-dedup-${Date.now()}`
    const payload = createTypeformPayload('eng-1', uniqueEventId)
    const body = JSON.stringify(payload)

    // First request
    const request1 = new Request('http://localhost/api/webhooks/typeform', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'typeform-signature': signPayload(body),
      },
      body,
    })

    const response1 = await POST(request1)
    expect(response1.status).toBe(200)
    const data1 = await response1.json()
    expect(data1.status).toBe('processing')

    // Second request with same event_id
    const request2 = new Request('http://localhost/api/webhooks/typeform', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'typeform-signature': signPayload(body),
      },
      body,
    })

    const response2 = await POST(request2)
    expect(response2.status).toBe(200)
    const data2 = await response2.json()
    expect(data2.status).toBe('duplicate')
  })

  it('should handle engagement not found gracefully', async () => {
    prismaMock.engagement.findUnique.mockResolvedValue(null)

    const payload = createTypeformPayload('non-existent')
    const body = JSON.stringify(payload)
    const request = new Request('http://localhost/api/webhooks/typeform', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'typeform-signature': signPayload(body),
      },
      body,
    })

    // Should return 200 (processing) but log error in background
    const response = await POST(request)
    expect(response.status).toBe(200)

    // Update should not be called since engagement not found
    expect(prismaMock.engagement.update).not.toHaveBeenCalled()
  })
})
