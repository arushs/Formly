import { describe, it, expect } from 'vitest'
import { ChecklistItemSchema, DocumentSchema, ReconciliationSchema } from '@/types'

describe('Zod Schemas', () => {
  describe('ChecklistItemSchema', () => {
    it('should validate a valid checklist item', () => {
      const item = {
        id: 'item_001',
        title: 'W-2 Form',
        why: 'Required to report wage income',
        priority: 'high',
        status: 'pending',
        documentIds: [],
      }
      const result = ChecklistItemSchema.safeParse(item)
      expect(result.success).toBe(true)
    })

    it('should validate all priority levels', () => {
      const priorities = ['high', 'medium', 'low'] as const
      for (const priority of priorities) {
        const item = {
          id: 'item_001',
          title: 'Test Item',
          why: 'Test reason',
          priority,
          status: 'pending',
          documentIds: [],
        }
        expect(ChecklistItemSchema.safeParse(item).success).toBe(true)
      }
    })

    it('should validate all status values', () => {
      const statuses = ['pending', 'received', 'complete'] as const
      for (const status of statuses) {
        const item = {
          id: 'item_001',
          title: 'Test Item',
          why: 'Test reason',
          priority: 'high',
          status,
          documentIds: [],
        }
        expect(ChecklistItemSchema.safeParse(item).success).toBe(true)
      }
    })

    it('should reject invalid priority', () => {
      const item = {
        id: 'item_001',
        title: 'W-2 Form',
        why: 'Test',
        priority: 'urgent', // invalid
        status: 'pending',
        documentIds: [],
      }
      const result = ChecklistItemSchema.safeParse(item)
      expect(result.success).toBe(false)
    })

    it('should reject invalid status', () => {
      const item = {
        id: 'item_001',
        title: 'W-2 Form',
        why: 'Test',
        priority: 'high',
        status: 'done', // invalid
        documentIds: [],
      }
      const result = ChecklistItemSchema.safeParse(item)
      expect(result.success).toBe(false)
    })

    it('should reject missing required fields', () => {
      const item = {
        id: 'item_001',
        // missing title, why, priority, status, documentIds
      }
      const result = ChecklistItemSchema.safeParse(item)
      expect(result.success).toBe(false)
    })

    it('should accept documentIds array with values', () => {
      const item = {
        id: 'item_001',
        title: 'W-2 Form',
        why: 'Test',
        priority: 'high',
        status: 'received',
        documentIds: ['doc-1', 'doc-2'],
      }
      const result = ChecklistItemSchema.safeParse(item)
      expect(result.success).toBe(true)
    })
  })

  describe('DocumentSchema', () => {
    it('should validate a valid document', () => {
      const doc = {
        id: 'doc-1',
        fileName: 'w2-2024.pdf',
        sharepointItemId: 'sp-item-123',
        documentType: 'W-2',
        confidence: 0.95,
        taxYear: 2024,
        issues: [],
        classifiedAt: '2024-01-15T10:00:00.000Z',
      }
      const result = DocumentSchema.safeParse(doc)
      expect(result.success).toBe(true)
    })

    it('should accept null taxYear', () => {
      const doc = {
        id: 'doc-1',
        fileName: 'unknown.pdf',
        sharepointItemId: 'sp-item-123',
        documentType: 'OTHER',
        confidence: 0.5,
        taxYear: null,
        issues: ['Could not determine tax year'],
        classifiedAt: null,
      }
      const result = DocumentSchema.safeParse(doc)
      expect(result.success).toBe(true)
    })

    it('should accept null classifiedAt', () => {
      const doc = {
        id: 'doc-1',
        fileName: 'pending.pdf',
        sharepointItemId: 'sp-item-123',
        documentType: 'UNKNOWN',
        confidence: 0,
        taxYear: null,
        issues: [],
        classifiedAt: null,
      }
      const result = DocumentSchema.safeParse(doc)
      expect(result.success).toBe(true)
    })

    it('should accept documents with issues', () => {
      const doc = {
        id: 'doc-1',
        fileName: 'bad-scan.pdf',
        sharepointItemId: 'sp-item-123',
        documentType: 'W-2',
        confidence: 0.7,
        taxYear: 2023,
        issues: ['Wrong tax year', 'Partially illegible'],
        classifiedAt: '2024-01-15T10:00:00.000Z',
      }
      const result = DocumentSchema.safeParse(doc)
      expect(result.success).toBe(true)
    })

    it('should reject missing required fields', () => {
      const doc = {
        id: 'doc-1',
        fileName: 'test.pdf',
        // missing other fields
      }
      const result = DocumentSchema.safeParse(doc)
      expect(result.success).toBe(false)
    })

    it('should reject non-numeric confidence', () => {
      const doc = {
        id: 'doc-1',
        fileName: 'test.pdf',
        sharepointItemId: 'sp-item-123',
        documentType: 'W-2',
        confidence: 'high', // should be number
        taxYear: 2024,
        issues: [],
        classifiedAt: null,
      }
      const result = DocumentSchema.safeParse(doc)
      expect(result.success).toBe(false)
    })
  })

  describe('ReconciliationSchema', () => {
    it('should validate a valid reconciliation', () => {
      const reconciliation = {
        completionPercentage: 75,
        itemStatuses: [
          { itemId: 'item_001', status: 'complete', documentIds: ['doc-1'] },
          { itemId: 'item_002', status: 'pending', documentIds: [] },
        ],
        issues: ['Missing 1099-NEC'],
        ranAt: '2024-01-15T10:00:00.000Z',
      }
      const result = ReconciliationSchema.safeParse(reconciliation)
      expect(result.success).toBe(true)
    })

    it('should validate empty reconciliation', () => {
      const reconciliation = {
        completionPercentage: 0,
        itemStatuses: [],
        issues: [],
        ranAt: '2024-01-15T10:00:00.000Z',
      }
      const result = ReconciliationSchema.safeParse(reconciliation)
      expect(result.success).toBe(true)
    })

    it('should validate 100% completion', () => {
      const reconciliation = {
        completionPercentage: 100,
        itemStatuses: [
          { itemId: 'item_001', status: 'complete', documentIds: ['doc-1'] },
        ],
        issues: [],
        ranAt: '2024-01-15T10:00:00.000Z',
      }
      const result = ReconciliationSchema.safeParse(reconciliation)
      expect(result.success).toBe(true)
    })

    it('should reject invalid item status', () => {
      const reconciliation = {
        completionPercentage: 50,
        itemStatuses: [
          { itemId: 'item_001', status: 'done', documentIds: [] }, // invalid status
        ],
        issues: [],
        ranAt: '2024-01-15T10:00:00.000Z',
      }
      const result = ReconciliationSchema.safeParse(reconciliation)
      expect(result.success).toBe(false)
    })

    it('should reject missing ranAt', () => {
      const reconciliation = {
        completionPercentage: 50,
        itemStatuses: [],
        issues: [],
        // missing ranAt
      }
      const result = ReconciliationSchema.safeParse(reconciliation)
      expect(result.success).toBe(false)
    })
  })
})
