import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { ChecklistItemSchema, type ChecklistItem, type Document } from '@/types'

const openai = new OpenAI()
const MODEL = 'gpt-4o-2024-08-06'

export async function generateChecklist(intakeData: unknown, taxYear: number): Promise<ChecklistItem[]> {
  const response = await openai.chat.completions.parse({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `You are a tax document intake specialist. Generate a checklist of documents needed based on the client's intake form responses. Tax year: ${taxYear}. For each item include: id (item_001, etc), title, why (client-friendly explanation), priority (high/medium/low). Set status to "pending" and documentIds to empty array.`,
      },
      { role: 'user', content: JSON.stringify(intakeData) },
    ],
    response_format: zodResponseFormat(
      z.object({ items: z.array(ChecklistItemSchema) }),
      'checklist'
    ),
    temperature: 0,
  })

  const parsed = response.choices[0]?.message?.parsed
  if (!parsed) {
    throw new Error('Failed to generate checklist: empty response')
  }
  return parsed.items
}

export async function classifyDocument(content: string, fileName: string): Promise<{
  documentType: string
  confidence: number
  taxYear: number | null
  issues: string[]
}> {
  const ClassificationSchema = z.object({
    documentType: z.string(),
    confidence: z.number(),
    taxYear: z.number().nullable(),
    issues: z.array(z.string()),
  })

  const response = await openai.chat.completions.parse({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Classify this tax document. Identify type (W-2, 1099-NEC, 1099-MISC, K-1, RECEIPT, STATEMENT, OTHER), confidence (0-1), tax year, and any issues (wrong year, missing info, etc).',
      },
      { role: 'user', content: `File: ${fileName}\n\nContent:\n${content.slice(0, 10000)}` },
    ],
    response_format: zodResponseFormat(ClassificationSchema, 'classification'),
    temperature: 0,
  })

  const parsed = response.choices[0]?.message?.parsed
  if (!parsed) {
    throw new Error('Failed to classify document: empty response')
  }
  return parsed
}

export async function reconcile(checklist: ChecklistItem[], documents: Document[]): Promise<{
  completionPercentage: number
  itemStatuses: { itemId: string; status: 'pending' | 'received' | 'complete'; documentIds: string[] }[]
  issues: string[]
}> {
  const ReconciliationSchema = z.object({
    completionPercentage: z.number(),
    itemStatuses: z.array(z.object({
      itemId: z.string(),
      status: z.enum(['pending', 'received', 'complete']),
      documentIds: z.array(z.string()),
    })),
    issues: z.array(z.string()),
  })

  const response = await openai.chat.completions.parse({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Match documents to checklist items. For each checklist item, determine status: pending (no match), received (matched but has issues), complete (matched and valid). Calculate overall completion percentage weighted by priority (high=50%, medium=35%, low=15%).',
      },
      { role: 'user', content: JSON.stringify({ checklist, documents }) },
    ],
    response_format: zodResponseFormat(ReconciliationSchema, 'reconciliation'),
    temperature: 0,
  })

  const parsed = response.choices[0]?.message?.parsed
  if (!parsed) {
    throw new Error('Failed to reconcile: empty response')
  }
  return parsed
}

export async function generatePrepBrief(engagement: {
  clientName: string
  taxYear: number
  checklist: ChecklistItem[]
  documents: Document[]
  reconciliation: { completionPercentage: number; issues: string[] }
}): Promise<string> {
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Generate a markdown prep brief for the accountant. Include: client summary, documents received, missing items, issues to discuss, and recommended next steps.',
      },
      { role: 'user', content: JSON.stringify(engagement) },
    ],
    temperature: 0.3,
  })

  return response.choices[0]?.message?.content ?? 'Failed to generate brief'
}
