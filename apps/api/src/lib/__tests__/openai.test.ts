import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to declare mock functions before they're used in vi.mock
const { mockParse, mockCreate } = vi.hoisted(() => ({
  mockParse: vi.fn(),
  mockCreate: vi.fn(),
}))

vi.mock('openai', () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        parse: mockParse,
        create: mockCreate,
      },
    },
  })),
}))

// Mock the zod helper
vi.mock('openai/helpers/zod', () => ({
  zodResponseFormat: vi.fn((schema, name) => ({ type: 'json_schema', json_schema: { name, schema } })),
}))

// Import after mocking
import {
  generateChecklist,
  classifyDocument,
  reconcile,
  generatePrepBrief,
  generateFollowUpEmail,
  generateFriendlyIssues,
} from '../openai.js'

describe('OpenAI functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateChecklist', () => {
    it('generates checklist from intake data', async () => {
      const mockItems = [
        {
          id: 'item_001',
          title: 'W-2 from Test Employer',
          why: 'Required for employment income',
          priority: 'high',
          status: 'pending',
          documentIds: [],
          expectedDocumentType: 'W-2',
        },
      ]

      mockParse.mockResolvedValueOnce({
        choices: [{ message: { parsed: { items: mockItems } } }],
      })

      const intakeData = { employment_type: 'W-2 Employee' }
      const result = await generateChecklist(intakeData, 2025)

      expect(mockParse).toHaveBeenCalledTimes(1)
      expect(result).toEqual(mockItems)
    })

    it('throws error on empty response', async () => {
      mockParse.mockResolvedValueOnce({
        choices: [{ message: { parsed: null } }],
      })

      await expect(generateChecklist({}, 2025)).rejects.toThrow('Failed to generate checklist')
    })
  })

  describe('classifyDocument', () => {
    it('classifies document with all fields', async () => {
      const mockClassification = {
        documentType: 'W-2',
        confidence: 0.95,
        taxYear: 2025,
        issues: [],
      }

      mockParse.mockResolvedValueOnce({
        choices: [{ message: { parsed: mockClassification } }],
      })

      const result = await classifyDocument('W-2 content here', 'w2.pdf', 2025)

      expect(result).toEqual(mockClassification)
      expect(mockParse).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('w2.pdf'),
            }),
          ]),
        })
      )
    })

    it('classifies document with issues', async () => {
      const mockClassification = {
        documentType: 'W-2',
        confidence: 0.7,
        taxYear: 2024,
        issues: ['[ERROR:wrong_year:2025:2024] Document shows 2024, expected 2025'],
      }

      mockParse.mockResolvedValueOnce({
        choices: [{ message: { parsed: mockClassification } }],
      })

      const result = await classifyDocument('W-2 2024', 'old-w2.pdf', 2025)

      expect(result.issues).toHaveLength(1)
      expect(result.taxYear).toBe(2024)
    })

    it('throws error on empty response', async () => {
      mockParse.mockResolvedValueOnce({
        choices: [{ message: { parsed: null } }],
      })

      await expect(classifyDocument('content', 'file.pdf')).rejects.toThrow('Failed to classify document')
    })
  })

  describe('reconcile', () => {
    it('reconciles documents with checklist', async () => {
      const mockReconciliation = {
        completionPercentage: 100,
        itemStatuses: [
          { itemId: 'item_001', status: 'complete', documentIds: ['doc_001'] },
        ],
        issues: [],
      }

      mockParse.mockResolvedValueOnce({
        choices: [{ message: { parsed: mockReconciliation } }],
      })

      const checklist = [
        {
          id: 'item_001',
          title: 'W-2',
          why: 'Required',
          priority: 'high' as const,
          status: 'pending' as const,
          documentIds: [],
          expectedDocumentType: 'W-2' as const,
        },
      ]
      const documents = [
        {
          id: 'doc_001',
          fileName: 'w2.pdf',
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
      ]

      const result = await reconcile(checklist, documents)

      expect(result.completionPercentage).toBe(100)
      expect(result.itemStatuses).toHaveLength(1)
    })

    it('throws error on empty response', async () => {
      mockParse.mockResolvedValueOnce({
        choices: [{ message: { parsed: null } }],
      })

      await expect(reconcile([], [])).rejects.toThrow('Failed to reconcile')
    })
  })

  describe('generatePrepBrief', () => {
    it('generates markdown brief', async () => {
      const briefContent = '# Tax Prep Brief\n\nClient is ready for filing.'
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: briefContent } }],
      })

      const engagement = {
        clientName: 'Test Client',
        taxYear: 2025,
        checklist: [],
        documents: [],
        reconciliation: { completionPercentage: 100, issues: [] },
      }

      const result = await generatePrepBrief(engagement)

      expect(result).toBe(briefContent)
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.3,
        })
      )
    })

    it('returns fallback message on empty response', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
      })

      const result = await generatePrepBrief({
        clientName: 'Test',
        taxYear: 2025,
        checklist: [],
        documents: [],
        reconciliation: { completionPercentage: 0, issues: [] },
      })

      expect(result).toBe('Failed to generate brief')
    })
  })

  describe('generateFollowUpEmail', () => {
    it('generates email content', async () => {
      const mockEmail = {
        subject: 'Action Needed: Document Issue',
        body: 'Please upload the corrected document.',
      }

      mockParse.mockResolvedValueOnce({
        choices: [{ message: { parsed: mockEmail } }],
      })

      const context = {
        clientName: 'Test Client',
        taxYear: 2025,
        fileName: 'w2.pdf',
        issues: [
          {
            severity: 'error',
            type: 'wrong_year',
            description: 'Document is from 2024',
            suggestedAction: 'Upload 2025 version',
          },
        ],
      }

      const result = await generateFollowUpEmail(context)

      expect(result).toEqual(mockEmail)
    })

    it('returns fallback email on error', async () => {
      mockParse.mockRejectedValueOnce(new Error('API error'))

      const context = {
        clientName: 'Test Client',
        taxYear: 2025,
        fileName: 'doc.pdf',
        issues: [
          {
            severity: 'error',
            type: 'incomplete',
            description: 'Missing pages',
            suggestedAction: 'Upload complete document',
          },
        ],
      }

      const result = await generateFollowUpEmail(context)

      expect(result.subject).toContain('Action Needed')
      expect(result.body).toContain('Test Client')
      expect(result.body).toContain('doc.pdf')
    })
  })

  describe('generateFriendlyIssues', () => {
    it('generates friendly issue messages', async () => {
      const mockFriendlyIssues = {
        issues: [
          {
            original: 'Wrong year',
            friendlyMessage: 'This document is from 2024, but we need 2025',
            suggestedAction: 'Request the 2025 W-2',
            severity: 'error',
          },
        ],
      }

      mockParse.mockResolvedValueOnce({
        choices: [{ message: { parsed: mockFriendlyIssues } }],
      })

      const issues = [
        { severity: 'error', type: 'wrong_year', description: 'Wrong year' },
      ]

      const result = await generateFriendlyIssues('w2.pdf', 'W-2', 2025, issues)

      expect(result).toHaveLength(1)
      expect(result[0].friendlyMessage).toBe('This document is from 2024, but we need 2025')
    })

    it('returns empty array for no issues', async () => {
      const result = await generateFriendlyIssues('file.pdf', 'W-2', 2025, [])
      expect(result).toEqual([])
    })

    it('returns fallback issues on error', async () => {
      mockParse.mockRejectedValueOnce(new Error('API error'))

      const issues = [
        { severity: 'warning', type: 'low_confidence', description: 'Low confidence score' },
      ]

      const result = await generateFriendlyIssues('doc.pdf', 'OTHER', 2025, issues)

      expect(result).toHaveLength(1)
      expect(result[0].friendlyMessage).toBe('Low confidence score')
      expect(result[0].severity).toBe('warning')
    })
  })
})
