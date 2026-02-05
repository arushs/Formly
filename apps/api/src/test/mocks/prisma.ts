import { vi } from 'vitest'
import type { MockEngagement } from '../factories.js'

// In-memory store for mock data
let mockEngagements: Map<string, MockEngagement> = new Map()

export function resetMockPrisma(): void {
  mockEngagements = new Map()
}

export function addMockEngagement(engagement: MockEngagement): void {
  mockEngagements.set(engagement.id, engagement)
}

export function getMockEngagements(): MockEngagement[] {
  return Array.from(mockEngagements.values())
}

export const mockPrisma = {
  engagement: {
    findMany: vi.fn(async (args?: { orderBy?: Record<string, string> }) => {
      const engagements = Array.from(mockEngagements.values())
      if (args?.orderBy?.createdAt === 'desc') {
        return engagements.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      }
      return engagements
    }),

    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      return mockEngagements.get(args.where.id) || null
    }),

    create: vi.fn(async (args: { data: Partial<MockEngagement> }) => {
      const id = args.data.id || `eng_${Date.now()}`
      const now = new Date()
      const engagement: MockEngagement = {
        id,
        clientName: args.data.clientName || '',
        clientEmail: args.data.clientEmail || '',
        taxYear: args.data.taxYear || 2025,
        status: args.data.status || 'PENDING',
        typeformFormId: args.data.typeformFormId || '',
        storageProvider: args.data.storageProvider || 'dropbox',
        storageFolderUrl: args.data.storageFolderUrl || '',
        storageFolderId: args.data.storageFolderId || null,
        storageDriveId: args.data.storageDriveId || null,
        storagePageToken: args.data.storagePageToken || null,
        intakeData: args.data.intakeData || null,
        checklist: args.data.checklist || null,
        documents: args.data.documents || null,
        reconciliation: args.data.reconciliation || null,
        prepBrief: args.data.prepBrief || null,
        lastActivityAt: args.data.lastActivityAt || now,
        createdAt: args.data.createdAt || now,
        updatedAt: args.data.updatedAt || now,
      }
      mockEngagements.set(id, engagement)
      return engagement
    }),

    update: vi.fn(async (args: { where: { id: string }; data: Partial<MockEngagement> }) => {
      const existing = mockEngagements.get(args.where.id)
      if (!existing) {
        throw new Error(`Engagement not found: ${args.where.id}`)
      }
      const updated = { ...existing, ...args.data, updatedAt: new Date() }
      mockEngagements.set(args.where.id, updated)
      return updated
    }),

    delete: vi.fn(async (args: { where: { id: string } }) => {
      const engagement = mockEngagements.get(args.where.id)
      if (engagement) {
        mockEngagements.delete(args.where.id)
      }
      return engagement
    }),
  },
}

// Mock the prisma module
vi.mock('../../lib/prisma.js', () => ({
  prisma: mockPrisma,
}))
