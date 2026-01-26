import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockOpenAI, MockOpenAI, mockStructuredOutput, mockChatCompletion, mockOpenAIError } from '../../mocks/openai'

// Mock the OpenAI module before importing the functions
vi.mock('openai', () => ({
  default: MockOpenAI,
}))

// Mock zodResponseFormat
vi.mock('openai/helpers/zod', () => ({
  zodResponseFormat: vi.fn((schema, name) => ({ type: 'json_schema', name, schema })),
}))

import { generateChecklist, classifyDocument, reconcile, generatePrepBrief } from '@/lib/openai'

describe('OpenAI LLM Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateChecklist', () => {
    it('should generate checklist from intake data', async () => {
      const mockChecklist = {
        items: [
          { id: 'item_001', title: 'W-2 Form', why: 'Report wage income', priority: 'high', status: 'pending', documentIds: [] },
          { id: 'item_002', title: '1099-INT', why: 'Interest income', priority: 'medium', status: 'pending', documentIds: [] },
        ],
      }
      mockStructuredOutput(mockChecklist)

      const result = await generateChecklist({ employmentType: 'W2', hasInvestments: true }, 2024)

      expect(result).toHaveLength(2)
      expect(result[0].title).toBe('W-2 Form')
      expect(result[1].title).toBe('1099-INT')
      expect(mockOpenAI.chat.completions.parse).toHaveBeenCalledTimes(1)
    })

    it('should handle empty intake data', async () => {
      mockStructuredOutput({ items: [] })

      const result = await generateChecklist({}, 2024)

      expect(result).toEqual([])
    })

    it('should include tax year in system prompt', async () => {
      mockStructuredOutput({ items: [] })

      await generateChecklist({}, 2024)

      const call = mockOpenAI.chat.completions.parse.mock.calls[0][0]
      expect(call.messages[0].content).toContain('2024')
    })

    it('should throw error on empty response', async () => {
      mockOpenAI.chat.completions.parse.mockResolvedValue({
        choices: [{ message: { parsed: null } }],
      })

      await expect(generateChecklist({}, 2024)).rejects.toThrow('Failed to generate checklist: empty response')
    })

    it('should propagate API errors', async () => {
      mockOpenAIError('Rate limit exceeded', 429)

      await expect(generateChecklist({}, 2024)).rejects.toThrow('Rate limit exceeded')
    })
  })

  describe('classifyDocument', () => {
    it('should classify a document', async () => {
      const mockClassification = {
        documentType: 'W-2',
        confidence: 0.95,
        taxYear: 2024,
        issues: [],
      }
      mockStructuredOutput(mockClassification)

      const result = await classifyDocument('W-2 Wage and Tax Statement...', 'w2-2024.pdf')

      expect(result.documentType).toBe('W-2')
      expect(result.confidence).toBe(0.95)
      expect(result.taxYear).toBe(2024)
      expect(result.issues).toEqual([])
    })

    it('should return issues when found', async () => {
      const mockClassification = {
        documentType: 'W-2',
        confidence: 0.7,
        taxYear: 2023,
        issues: ['Wrong tax year', 'Partially illegible'],
      }
      mockStructuredOutput(mockClassification)

      const result = await classifyDocument('W-2 2023...', 'w2.pdf')

      expect(result.issues).toHaveLength(2)
      expect(result.issues).toContain('Wrong tax year')
    })

    it('should handle null tax year', async () => {
      const mockClassification = {
        documentType: 'RECEIPT',
        confidence: 0.8,
        taxYear: null,
        issues: [],
      }
      mockStructuredOutput(mockClassification)

      const result = await classifyDocument('Receipt for...', 'receipt.pdf')

      expect(result.taxYear).toBeNull()
    })

    it('should truncate long content', async () => {
      mockStructuredOutput({
        documentType: 'OTHER',
        confidence: 0.5,
        taxYear: null,
        issues: [],
      })

      const longContent = 'x'.repeat(20000)
      await classifyDocument(longContent, 'large.pdf')

      const call = mockOpenAI.chat.completions.parse.mock.calls[0][0]
      // Content should be sliced to 10000 chars
      expect(call.messages[1].content.length).toBeLessThan(20000)
    })

    it('should throw error on empty response', async () => {
      mockOpenAI.chat.completions.parse.mockResolvedValue({
        choices: [{ message: { parsed: null } }],
      })

      await expect(classifyDocument('content', 'file.pdf')).rejects.toThrow('Failed to classify document: empty response')
    })
  })

  describe('reconcile', () => {
    it('should reconcile documents with checklist', async () => {
      const mockReconciliation = {
        completionPercentage: 50,
        itemStatuses: [
          { itemId: 'item_001', status: 'complete', documentIds: ['doc-1'] },
          { itemId: 'item_002', status: 'pending', documentIds: [] },
        ],
        issues: ['Missing 1099-NEC'],
      }
      mockStructuredOutput(mockReconciliation)

      const checklist = [
        { id: 'item_001', title: 'W-2', why: 'Test', priority: 'high' as const, status: 'pending' as const, documentIds: [] },
        { id: 'item_002', title: '1099-NEC', why: 'Test', priority: 'medium' as const, status: 'pending' as const, documentIds: [] },
      ]
      const documents = [
        { id: 'doc-1', fileName: 'w2.pdf', sharepointItemId: 'sp-1', documentType: 'W-2', confidence: 0.95, taxYear: 2024, issues: [], classifiedAt: '2024-01-01' },
      ]

      const result = await reconcile(checklist, documents)

      expect(result.completionPercentage).toBe(50)
      expect(result.itemStatuses).toHaveLength(2)
      expect(result.issues).toContain('Missing 1099-NEC')
    })

    it('should handle empty checklist', async () => {
      mockStructuredOutput({
        completionPercentage: 0,
        itemStatuses: [],
        issues: [],
      })

      const result = await reconcile([], [])

      expect(result.completionPercentage).toBe(0)
      expect(result.itemStatuses).toEqual([])
    })

    it('should throw error on empty response', async () => {
      mockOpenAI.chat.completions.parse.mockResolvedValue({
        choices: [{ message: { parsed: null } }],
      })

      await expect(reconcile([], [])).rejects.toThrow('Failed to reconcile: empty response')
    })
  })

  describe('generatePrepBrief', () => {
    it('should generate a prep brief', async () => {
      const mockBrief = '# Tax Prep Brief\n\n## Client: Test Client\n\n...'
      mockChatCompletion(mockBrief)

      const engagement = {
        clientName: 'Test Client',
        taxYear: 2024,
        checklist: [],
        documents: [],
        reconciliation: { completionPercentage: 100, issues: [] },
      }

      const result = await generatePrepBrief(engagement)

      expect(result).toContain('Tax Prep Brief')
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(1)
    })

    it('should return fallback on empty response', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: null } }],
      })

      const engagement = {
        clientName: 'Test Client',
        taxYear: 2024,
        checklist: [],
        documents: [],
        reconciliation: { completionPercentage: 100, issues: [] },
      }

      const result = await generatePrepBrief(engagement)

      expect(result).toBe('Failed to generate brief')
    })

    it('should use temperature 0.3 for creative output', async () => {
      mockChatCompletion('Brief content')

      await generatePrepBrief({
        clientName: 'Test',
        taxYear: 2024,
        checklist: [],
        documents: [],
        reconciliation: { completionPercentage: 100, issues: [] },
      })

      const call = mockOpenAI.chat.completions.create.mock.calls[0][0]
      expect(call.temperature).toBe(0.3)
    })
  })
})
