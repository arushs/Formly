import { describe, it, expect } from 'vitest'
import {
  DOCUMENT_TYPES,
  ChecklistItemSchema,
  DocumentSchema,
  ReconciliationSchema,
  FriendlyIssueSchema,
  type ChecklistItem,
  type Document,
  type Reconciliation,
} from '../../types.js'

describe('DOCUMENT_TYPES', () => {
  it('contains expected document types', () => {
    expect(DOCUMENT_TYPES).toContain('W-2')
    expect(DOCUMENT_TYPES).toContain('1099-NEC')
    expect(DOCUMENT_TYPES).toContain('1099-MISC')
    expect(DOCUMENT_TYPES).toContain('1099-INT')
    expect(DOCUMENT_TYPES).toContain('K-1')
    expect(DOCUMENT_TYPES).toContain('RECEIPT')
    expect(DOCUMENT_TYPES).toContain('STATEMENT')
    expect(DOCUMENT_TYPES).toContain('OTHER')
    expect(DOCUMENT_TYPES).toContain('PENDING')
  })

  it('is readonly array', () => {
    expect(Array.isArray(DOCUMENT_TYPES)).toBe(true)
    expect(DOCUMENT_TYPES).toHaveLength(9)
  })
})

describe('ChecklistItemSchema', () => {
  it('validates valid checklist item', () => {
    const validItem = {
      id: 'item_001',
      title: 'W-2 from Employer',
      why: 'Required for tax filing',
      priority: 'high',
      status: 'pending',
      documentIds: [],
      expectedDocumentType: 'W-2',
    }

    const result = ChecklistItemSchema.safeParse(validItem)
    expect(result.success).toBe(true)
  })

  it('validates all priority levels', () => {
    const priorities = ['high', 'medium', 'low']

    for (const priority of priorities) {
      const item = {
        id: 'item_001',
        title: 'Test',
        why: 'Test',
        priority,
        status: 'pending',
        documentIds: [],
        expectedDocumentType: null,
      }
      const result = ChecklistItemSchema.safeParse(item)
      expect(result.success).toBe(true)
    }
  })

  it('validates all status values', () => {
    const statuses = ['pending', 'received', 'complete']

    for (const status of statuses) {
      const item = {
        id: 'item_001',
        title: 'Test',
        why: 'Test',
        priority: 'high',
        status,
        documentIds: [],
        expectedDocumentType: null,
      }
      const result = ChecklistItemSchema.safeParse(item)
      expect(result.success).toBe(true)
    }
  })

  it('allows null expectedDocumentType', () => {
    const item = {
      id: 'item_001',
      title: 'Test',
      why: 'Test',
      priority: 'high',
      status: 'pending',
      documentIds: [],
      expectedDocumentType: null,
    }
    const result = ChecklistItemSchema.safeParse(item)
    expect(result.success).toBe(true)
  })

  it('rejects invalid priority', () => {
    const item = {
      id: 'item_001',
      title: 'Test',
      why: 'Test',
      priority: 'invalid',
      status: 'pending',
      documentIds: [],
      expectedDocumentType: null,
    }
    const result = ChecklistItemSchema.safeParse(item)
    expect(result.success).toBe(false)
  })

  it('rejects missing required fields', () => {
    const item = { id: 'item_001' }
    const result = ChecklistItemSchema.safeParse(item)
    expect(result.success).toBe(false)
  })
})

describe('DocumentSchema', () => {
  it('validates valid document', () => {
    const validDoc = {
      id: 'doc_001',
      fileName: 'w2-2025.pdf',
      storageItemId: 'storage_abc123',
      documentType: 'W-2',
      confidence: 0.95,
      taxYear: 2025,
      issues: [],
      issueDetails: null,
      classifiedAt: '2025-01-15T10:00:00Z',
      processingStatus: 'classified',
      processingStartedAt: null,
      approved: null,
      approvedAt: null,
      override: null,
    }

    const result = DocumentSchema.safeParse(validDoc)
    expect(result.success).toBe(true)
  })

  it('validates document with issues', () => {
    const doc = {
      id: 'doc_001',
      fileName: 'w2.pdf',
      storageItemId: 'storage_001',
      documentType: 'W-2',
      confidence: 0.7,
      taxYear: 2024,
      issues: ['[ERROR:wrong_year:2025:2024] Wrong year'],
      issueDetails: [
        {
          original: 'Wrong year',
          friendlyMessage: 'Document is from 2024',
          suggestedAction: 'Request 2025 version',
          severity: 'error',
        },
      ],
      classifiedAt: '2025-01-15T10:00:00Z',
    }

    const result = DocumentSchema.safeParse(doc)
    expect(result.success).toBe(true)
  })

  it('validates approved document', () => {
    const doc = {
      id: 'doc_001',
      fileName: 'w2.pdf',
      storageItemId: 'storage_001',
      documentType: 'W-2',
      confidence: 0.95,
      taxYear: 2025,
      issues: [],
      issueDetails: null,
      classifiedAt: '2025-01-15T10:00:00Z',
      approved: true,
      approvedAt: '2025-01-16T10:00:00Z',
      override: null,
    }

    const result = DocumentSchema.safeParse(doc)
    expect(result.success).toBe(true)
  })

  it('validates document with override', () => {
    const doc = {
      id: 'doc_001',
      fileName: 'doc.pdf',
      storageItemId: 'storage_001',
      documentType: '1099-NEC',
      confidence: 0.8,
      taxYear: 2025,
      issues: [],
      issueDetails: null,
      classifiedAt: '2025-01-15T10:00:00Z',
      approved: null,
      approvedAt: null,
      override: {
        originalType: 'W-2',
        reason: 'User reclassification',
      },
    }

    const result = DocumentSchema.safeParse(doc)
    expect(result.success).toBe(true)
  })

  it('validates all processing statuses', () => {
    const statuses = ['pending', 'downloading', 'extracting', 'classifying', 'classified', 'error']

    for (const status of statuses) {
      const doc = {
        id: 'doc_001',
        fileName: 'file.pdf',
        storageItemId: 'storage_001',
        documentType: 'OTHER',
        confidence: 0.5,
        taxYear: null,
        issues: [],
        issueDetails: null,
        classifiedAt: null,
        processingStatus: status,
      }
      const result = DocumentSchema.safeParse(doc)
      expect(result.success).toBe(true)
    }
  })

  it('allows null taxYear', () => {
    const doc = {
      id: 'doc_001',
      fileName: 'receipt.jpg',
      storageItemId: 'storage_001',
      documentType: 'RECEIPT',
      confidence: 0.8,
      taxYear: null,
      issues: [],
      issueDetails: null,
      classifiedAt: '2025-01-15T10:00:00Z',
    }

    const result = DocumentSchema.safeParse(doc)
    expect(result.success).toBe(true)
  })
})

describe('ReconciliationSchema', () => {
  it('validates valid reconciliation', () => {
    const valid = {
      completionPercentage: 75,
      itemStatuses: [
        { itemId: 'item_001', status: 'complete', documentIds: ['doc_001'] },
        { itemId: 'item_002', status: 'pending', documentIds: [] },
      ],
      issues: [],
      ranAt: '2025-01-15T10:00:00Z',
    }

    const result = ReconciliationSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('validates all item status values', () => {
    const statuses = ['pending', 'received', 'complete']

    for (const status of statuses) {
      const recon = {
        completionPercentage: 50,
        itemStatuses: [{ itemId: 'item_001', status, documentIds: [] }],
        issues: [],
        ranAt: '2025-01-15T10:00:00Z',
      }
      const result = ReconciliationSchema.safeParse(recon)
      expect(result.success).toBe(true)
    }
  })

  it('validates reconciliation with issues', () => {
    const recon = {
      completionPercentage: 50,
      itemStatuses: [],
      issues: ['Missing W-2', 'Document has wrong year'],
      ranAt: '2025-01-15T10:00:00Z',
    }

    const result = ReconciliationSchema.safeParse(recon)
    expect(result.success).toBe(true)
  })

  it('accepts completion percentage at boundaries', () => {
    const zeroPercent = {
      completionPercentage: 0,
      itemStatuses: [],
      issues: [],
      ranAt: '2025-01-15T10:00:00Z',
    }
    expect(ReconciliationSchema.safeParse(zeroPercent).success).toBe(true)

    const hundredPercent = {
      completionPercentage: 100,
      itemStatuses: [],
      issues: [],
      ranAt: '2025-01-15T10:00:00Z',
    }
    expect(ReconciliationSchema.safeParse(hundredPercent).success).toBe(true)
  })
})

describe('FriendlyIssueSchema', () => {
  it('validates valid friendly issue', () => {
    const issue = {
      original: '[ERROR:wrong_year:2025:2024] Wrong year',
      friendlyMessage: 'This document is from 2024, but we need 2025',
      suggestedAction: 'Request the 2025 version of this document',
      severity: 'error',
    }

    const result = FriendlyIssueSchema.safeParse(issue)
    expect(result.success).toBe(true)
  })

  it('validates warning severity', () => {
    const issue = {
      original: 'Low confidence',
      friendlyMessage: 'Not sure about document type',
      suggestedAction: 'Manually verify',
      severity: 'warning',
    }

    const result = FriendlyIssueSchema.safeParse(issue)
    expect(result.success).toBe(true)
  })

  it('rejects invalid severity', () => {
    const issue = {
      original: 'Issue',
      friendlyMessage: 'Message',
      suggestedAction: 'Action',
      severity: 'info',
    }

    const result = FriendlyIssueSchema.safeParse(issue)
    expect(result.success).toBe(false)
  })
})
