import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '../../mocks/prisma'
import { createMockRequest } from '../../helpers/request-factory'
import { createEngagement } from '../../helpers/fixtures'

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/sharepoint', () => ({
  resolveSharePointUrl: vi.fn().mockResolvedValue({
    driveId: 'drive-123',
    folderId: 'folder-123',
  }),
}))

vi.mock('@/lib/agents/dispatcher', () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@vercel/functions', () => ({
  waitUntil: vi.fn((promise) => promise),
}))

import { GET, POST } from '@/app/api/engagements/route'
import { dispatch } from '@/lib/agents/dispatcher'

describe('/api/engagements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('should return all engagements ordered by createdAt desc', async () => {
      const mockEngagements = [
        createEngagement({ id: 'eng-1', clientName: 'Client A', createdAt: new Date('2024-01-02') }),
        createEngagement({ id: 'eng-2', clientName: 'Client B', createdAt: new Date('2024-01-01') }),
      ]
      prismaMock.engagement.findMany.mockResolvedValue(mockEngagements)

      const request = createMockRequest('http://localhost/api/engagements')
      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveLength(2)
      expect(prismaMock.engagement.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      })
    })

    it('should return empty array when no engagements exist', async () => {
      prismaMock.engagement.findMany.mockResolvedValue([])

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual([])
    })
  })

  describe('POST', () => {
    const validPayload = {
      clientName: 'New Client',
      clientEmail: 'new@example.com',
      taxYear: 2024,
      sharepointFolderUrl: 'https://sharepoint.com/sites/tax/folder',
      typeformFormId: 'form-123',
    }

    it('should create engagement with valid payload', async () => {
      const createdEngagement = createEngagement({
        id: 'new-eng-1',
        ...validPayload,
        sharepointDriveId: 'drive-123',
        sharepointFolderId: 'folder-123',
      })
      prismaMock.engagement.create.mockResolvedValue(createdEngagement)

      const request = createMockRequest('http://localhost/api/engagements', {
        method: 'POST',
        body: validPayload,
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data.id).toBe('new-eng-1')
      expect(data.clientName).toBe('New Client')
    })

    it('should dispatch engagement_created event', async () => {
      const createdEngagement = createEngagement({ id: 'new-eng-1' })
      prismaMock.engagement.create.mockResolvedValue(createdEngagement)

      const request = createMockRequest('http://localhost/api/engagements', {
        method: 'POST',
        body: validPayload,
      })
      await POST(request)

      expect(dispatch).toHaveBeenCalledWith({
        type: 'engagement_created',
        engagementId: 'new-eng-1',
      })
    })

    it('should return 400 for missing clientName', async () => {
      const request = createMockRequest('http://localhost/api/engagements', {
        method: 'POST',
        body: {
          clientEmail: 'test@example.com',
          taxYear: 2024,
          sharepointFolderUrl: 'https://sharepoint.com/folder',
          typeformFormId: 'form-123',
        },
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('should return 400 for invalid email', async () => {
      const request = createMockRequest('http://localhost/api/engagements', {
        method: 'POST',
        body: {
          ...validPayload,
          clientEmail: 'not-an-email',
        },
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('should return 400 for invalid taxYear', async () => {
      const request = createMockRequest('http://localhost/api/engagements', {
        method: 'POST',
        body: {
          ...validPayload,
          taxYear: 2019, // below min 2020
        },
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('should return 400 for invalid URL', async () => {
      const request = createMockRequest('http://localhost/api/engagements', {
        method: 'POST',
        body: {
          ...validPayload,
          sharepointFolderUrl: 'not-a-url',
        },
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('should continue with null SharePoint IDs when resolution fails', async () => {
      const { resolveSharePointUrl } = await import('@/lib/sharepoint')
      vi.mocked(resolveSharePointUrl).mockRejectedValueOnce(new Error('Resolution failed'))

      const createdEngagement = createEngagement({
        id: 'new-eng-1',
        sharepointDriveId: null,
        sharepointFolderId: null,
      })
      prismaMock.engagement.create.mockResolvedValue(createdEngagement)

      const request = createMockRequest('http://localhost/api/engagements', {
        method: 'POST',
        body: validPayload,
      })
      const response = await POST(request)

      expect(response.status).toBe(201)
    })
  })
})
