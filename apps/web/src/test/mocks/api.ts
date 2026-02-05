import { vi } from 'vitest'
import type { Engagement, Document, ChecklistItem, Reconciliation, EmailPreview, FriendlyIssue } from '../../api/client'

// Mock engagement data
export const mockEngagement: Engagement = {
  id: 'eng_001',
  clientName: 'Test Client',
  clientEmail: 'client@example.com',
  taxYear: 2025,
  status: 'COLLECTING',
  storageProvider: 'dropbox',
  storageFolderUrl: 'https://www.dropbox.com/sh/test123',
  typeformFormId: 'form_123',
  checklist: [
    {
      id: 'item_001',
      title: 'W-2 from Test Employer',
      why: 'Required for employment income',
      priority: 'high',
      status: 'pending',
      documentIds: [],
    },
  ],
  documents: [
    {
      id: 'doc_001',
      fileName: 'w2-2025.pdf',
      storageItemId: 'storage_001',
      documentType: 'W-2',
      confidence: 0.95,
      taxYear: 2025,
      issues: [],
      issueDetails: null,
      classifiedAt: new Date().toISOString(),
      approved: null,
      approvedAt: null,
      override: null,
    },
  ],
  reconciliation: {
    completionPercentage: 50,
    itemStatuses: [
      { itemId: 'item_001', status: 'received', documentIds: ['doc_001'] },
    ],
    issues: [],
    ranAt: new Date().toISOString(),
  },
  prepBrief: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

export const mockEngagementList: Engagement[] = [
  mockEngagement,
  {
    ...mockEngagement,
    id: 'eng_002',
    clientName: 'Another Client',
    status: 'READY',
    reconciliation: {
      completionPercentage: 100,
      itemStatuses: [],
      issues: [],
      ranAt: new Date().toISOString(),
    },
  },
]

export const mockEmailPreview: EmailPreview = {
  subject: 'Action Needed: Document Issue',
  body: 'Please provide the corrected document.',
  recipientEmail: 'client@example.com',
  uploadUrl: 'https://www.dropbox.com/sh/test123',
}

export const mockFriendlyIssues: FriendlyIssue[] = [
  {
    original: 'Wrong tax year',
    friendlyMessage: 'This document is from 2024, but we need 2025',
    suggestedAction: 'Request the 2025 version',
    severity: 'error',
  },
]

// Create mock API functions
export const mockApi = {
  getEngagements: vi.fn(async () => mockEngagementList),
  getEngagement: vi.fn(async (id: string) => {
    const engagement = mockEngagementList.find((e) => e.id === id)
    if (!engagement) {
      throw new Error('Engagement not found')
    }
    return engagement
  }),
  createEngagement: vi.fn(async (data: { clientName: string; clientEmail: string; storageFolderUrl: string }) => ({
    ...mockEngagement,
    ...data,
    id: `eng_${Date.now()}`,
  })),
  generateBrief: vi.fn(async () => ({
    success: true,
    brief: '# Tax Prep Brief\n\nAll documents collected.',
  })),
  approveDocument: vi.fn(async (engagementId: string, docId: string) => ({
    success: true,
    document: {
      ...mockEngagement.documents![0],
      id: docId,
      approved: true,
      approvedAt: new Date().toISOString(),
    },
  })),
  reclassifyDocument: vi.fn(async (engagementId: string, docId: string, newType: string) => ({
    success: true,
    document: {
      ...mockEngagement.documents![0],
      id: docId,
      documentType: newType,
      override: {
        originalType: 'W-2',
        reason: 'User reclassification',
      },
    },
  })),
  getEmailPreview: vi.fn(async () => mockEmailPreview),
  sendDocumentFollowUp: vi.fn(async () => ({
    success: true,
    message: 'Email sent successfully',
  })),
  getFriendlyIssues: vi.fn(async () => ({
    issues: mockFriendlyIssues,
  })),
}

// Mock the API client module
vi.mock('../../api/client', () => mockApi)

// Helper to reset all mocks
export function resetApiMocks(): void {
  Object.values(mockApi).forEach((fn) => fn.mockClear())
}

// Helper to set specific mock responses
export function setMockEngagements(engagements: Engagement[]): void {
  mockApi.getEngagements.mockResolvedValueOnce(engagements)
}

export function setMockEngagement(engagement: Engagement | null): void {
  if (engagement) {
    mockApi.getEngagement.mockResolvedValueOnce(engagement)
  } else {
    mockApi.getEngagement.mockRejectedValueOnce(new Error('Engagement not found'))
  }
}
