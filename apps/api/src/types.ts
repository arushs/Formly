import { z } from 'zod'

// Shared constant for document types
export const DOCUMENT_TYPES = ['W-2', '1099-NEC', '1099-MISC', '1099-INT', 'K-1', 'RECEIPT', 'STATEMENT', 'OTHER', 'PENDING'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const ChecklistItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  why: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  status: z.enum(['pending', 'received', 'complete']),
  documentIds: z.array(z.string()),
  expectedDocumentType: z.enum(['W-2', '1099-NEC', '1099-MISC', '1099-INT', 'K-1', 'RECEIPT', 'STATEMENT', 'OTHER']).nullable(),
})

// Friendly issue format for cached LLM-generated messages
export const FriendlyIssueSchema = z.object({
  original: z.string(),
  friendlyMessage: z.string(),
  suggestedAction: z.string(),
  severity: z.enum(['error', 'warning'])
})

export const DocumentSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  storageItemId: z.string(), // File ID in storage provider (Dropbox)
  documentType: z.string(),
  confidence: z.number(),
  taxYear: z.number().nullable(),
  issues: z.array(z.string()),
  issueDetails: z.array(FriendlyIssueSchema).nullable().default(null), // Cached LLM-generated issue details
  classifiedAt: z.string().nullable(),
  // Processing state tracking for retry logic
  processingStatus: z.enum(['pending', 'downloading', 'extracting', 'classifying', 'classified', 'error']).optional(), // defaults to 'pending' if missing
  processingStartedAt: z.string().nullable().optional(), // ISO timestamp when processing started
  // Document review fields
  approved: z.boolean().nullable().default(null), // null = not reviewed, true = approved
  approvedAt: z.string().nullable().default(null),
  override: z.object({
    originalType: z.string(),
    reason: z.string(),
  }).nullable().default(null),
  // Archive fields for document replacement flow
  archived: z.boolean().default(false),
  archivedAt: z.string().nullable().default(null),
  archivedReason: z.string().nullable().default(null), // e.g., "Replaced by newer document"
})

export const ReconciliationSchema = z.object({
  completionPercentage: z.number(),
  itemStatuses: z.array(z.object({
    itemId: z.string(),
    status: z.enum(['pending', 'received', 'complete']),
    documentIds: z.array(z.string()),
  })),
  issues: z.array(z.string()),
  ranAt: z.string(),
})

export type ChecklistItem = z.infer<typeof ChecklistItemSchema>
export type Document = z.infer<typeof DocumentSchema>
export type FriendlyIssue = z.infer<typeof FriendlyIssueSchema>
export type Reconciliation = z.infer<typeof ReconciliationSchema>
