import { z } from 'zod'

export const ChecklistItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  why: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  status: z.enum(['pending', 'received', 'complete']),
  documentIds: z.array(z.string()),
})

export const DocumentSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  sharepointItemId: z.string(),
  documentType: z.string(),
  confidence: z.number(),
  taxYear: z.number().nullable(),
  issues: z.array(z.string()),
  classifiedAt: z.string(),
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
export type Reconciliation = z.infer<typeof ReconciliationSchema>
