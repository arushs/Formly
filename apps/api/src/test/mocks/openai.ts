import { vi } from 'vitest'

// Mock responses for OpenAI structured outputs
export const mockChecklistResponse = {
  items: [
    {
      id: 'item_001',
      title: 'W-2 from Test Employer',
      why: 'Required for reporting employment income',
      priority: 'high' as const,
      status: 'pending' as const,
      documentIds: [],
      expectedDocumentType: 'W-2' as const,
    },
    {
      id: 'item_002',
      title: '1099-INT from Test Bank',
      why: 'Required for reporting interest income',
      priority: 'medium' as const,
      status: 'pending' as const,
      documentIds: [],
      expectedDocumentType: '1099-INT' as const,
    },
  ],
}

export const mockClassificationResponse = {
  documentType: 'W-2',
  confidence: 0.95,
  taxYear: 2025,
  issues: [],
}

export const mockReconciliationResponse = {
  completionPercentage: 100,
  itemStatuses: [
    { itemId: 'item_001', status: 'complete' as const, documentIds: ['doc_001'] },
  ],
  issues: [],
}

export const mockFriendlyIssuesResponse = {
  issues: [
    {
      original: 'Wrong tax year',
      friendlyMessage: 'This document is from 2024, but we need 2025',
      suggestedAction: 'Request the 2025 version of this document',
      severity: 'error' as const,
    },
  ],
}

export const mockEmailResponse = {
  subject: 'Action Needed: Document Issue',
  body: 'Please provide the corrected document.',
}

// Create mock OpenAI client
export function createMockOpenAIResponse(parsed: unknown) {
  return {
    choices: [
      {
        message: {
          parsed,
          content: JSON.stringify(parsed),
        },
      },
    ],
  }
}

export const mockOpenAIClient = {
  chat: {
    completions: {
      parse: vi.fn(async () => createMockOpenAIResponse(mockChecklistResponse)),
      create: vi.fn(async () => ({
        choices: [
          {
            message: {
              content: '# Prep Brief\n\nClient is ready for tax filing.',
            },
          },
        ],
      })),
    },
  },
}

// Mock the OpenAI module
vi.mock('openai', () => ({
  default: vi.fn(() => mockOpenAIClient),
}))

// Helper to set custom responses
export function setMockOpenAIParseResponse(response: unknown): void {
  mockOpenAIClient.chat.completions.parse.mockResolvedValueOnce(
    createMockOpenAIResponse(response)
  )
}

export function setMockOpenAICreateResponse(content: string): void {
  mockOpenAIClient.chat.completions.create.mockResolvedValueOnce({
    choices: [{ message: { content } }],
  })
}
