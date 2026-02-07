import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { ChecklistItemSchema, type ChecklistItem, type Document } from '../types.js'

const openai = new OpenAI()
const MODEL = 'gpt-4o-2024-08-06'

export async function generateChecklist(intakeData: unknown, taxYear: number): Promise<ChecklistItem[]> {
  const response = await openai.chat.completions.parse({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `You are a tax document intake specialist. Generate a checklist of documents needed based on the client's intake form responses. Tax year: ${taxYear}.

For each item include:
- id: item_001, item_002, etc.
- title: Human-friendly description (e.g., "W-2 from ABC Corp")
- why: Client-friendly explanation of why this document is needed
- priority: high/medium/low
- status: "pending"
- documentIds: empty array []
- expectedDocumentType: The document type that will satisfy this item. Must be one of: W-2, 1099-NEC, 1099-MISC, 1099-INT, K-1, RECEIPT, STATEMENT, OTHER

The expectedDocumentType is CRITICAL for automatic document matching. Use the exact type that will be uploaded:
- Employment income → W-2
- Freelance/contractor income → 1099-NEC
- Interest income → 1099-INT
- Miscellaneous income → 1099-MISC
- Partnership/S-Corp distributions → K-1
- Business expenses, charitable donations → RECEIPT
- Bank/investment statements → STATEMENT
- Other documents → OTHER`,
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

export async function classifyDocument(
  content: string,
  fileName: string,
  expectedTaxYear?: number
): Promise<{
  documentType: string
  confidence: number
  taxYear: number | null
  issues: string[]
}> {
  // Pre-check: Empty or minimal content should get low confidence
  // This catches blank/template forms that AI might misclassify with high confidence
  const trimmedContent = content.trim()
  if (trimmedContent.length < 100) {
    console.log(`[CLASSIFY] Minimal content detected (${trimmedContent.length} chars) for ${fileName}`)
    return {
      documentType: 'OTHER',
      confidence: 0.3,
      taxYear: null,
      issues: ['[WARNING:incomplete::] Document appears to be blank or has minimal content. Please upload a completed form with filled-in data.']
    }
  }

  const ClassificationSchema = z.object({
    documentType: z.string(),
    confidence: z.number(),
    taxYear: z.number().nullable(),
    issues: z.array(z.string()),
  })

  const systemPrompt = `You are a tax document classifier and validator. Analyze the document and return:

1. **documentType**: One of: W-2, 1099-NEC, 1099-MISC, 1099-INT, 1099-DIV, 1099-B, 1099-R, K-1, RECEIPT, STATEMENT, OTHER

2. **confidence**: 0-1 score. Use < 0.7 if document is unclear, partially visible, or you're uncertain.

3. **taxYear**: The tax year shown on the document (e.g., 2024, 2025). Return null if not visible.

4. **issues**: Array of problems found. Be SPECIFIC in descriptions - include actual values found.

Check for:
${expectedTaxYear ? `- Wrong tax year: If document year doesn't match ${expectedTaxYear}, flag with actual year found` : ''}
- Missing critical fields (be specific about which field):
  * W-2: employer name/EIN, wages (Box 1), federal tax withheld (Box 2), SSN
  * 1099-NEC: payer name/TIN, nonemployee compensation (Box 1)
  * 1099-INT: payer name, interest income (Box 1)
  * 1099-MISC: payer name, relevant income boxes
  * K-1: partnership/S-corp name/EIN, partner's share amounts
- Empty or template forms: If the document appears to be a blank template without filled-in data, set confidence < 0.5 and flag as incomplete
- Quality issues: specify what's illegible or cut off
- Incomplete: note which pages appear missing

IMPORTANT: Do not give high confidence to blank or unfilled forms. A form template without actual data (wages, amounts, names) should have LOW confidence.

Format: "[SEVERITY:type:expected:detected] Specific description"
- SEVERITY: ERROR (blocks tax prep) or WARNING (needs review)
- type: wrong_year, missing_field, illegible, incomplete, low_confidence, other
- expected/detected: actual values when available

GOOD examples (specific):
- "[ERROR:wrong_year:${expectedTaxYear || '2025'}:2024] Document shows tax year 2024, but we need ${expectedTaxYear || '2025'}"
- "[WARNING:missing_field:box_1_wages:] Box 1 (Wages) is not visible or illegible"
- "[ERROR:incomplete::] Only page 1 visible, W-2 Copy B typically has 2 pages"
- "[WARNING:illegible:employer_ein:] Employer EIN in Box b is too blurry to read"

BAD examples (vague - avoid these):
- "[WARNING:other::] Some fields missing"
- "[WARNING:illegible::] Document quality issues"

Only flag issues that actually affect tax preparation. Don't flag cosmetic issues.`

  const response = await openai.chat.completions.parse({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
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

// Fast model for simple tasks like email generation
const FAST_MODEL = 'gpt-4o-mini'

interface DocumentIssue {
  severity: string
  type: string
  description: string
  suggestedAction: string
}

interface DocumentIssueContext {
  clientName: string
  taxYear: number
  fileName: string
  issues: DocumentIssue[]
}

interface FriendlyIssue {
  original: string
  friendlyMessage: string
  suggestedAction: string
  severity: 'error' | 'warning'
}

/**
 * Generate human-friendly issue messages for the admin UI
 */
export async function generateFriendlyIssues(
  fileName: string,
  documentType: string,
  taxYear: number,
  issues: Array<{ severity: string; type: string; description: string }>
): Promise<FriendlyIssue[]> {
  if (issues.length === 0) return []

  const FriendlyIssuesSchema = z.object({
    issues: z.array(z.object({
      original: z.string(),
      friendlyMessage: z.string(),
      suggestedAction: z.string(),
      severity: z.enum(['error', 'warning'])
    }))
  })

  try {
    const response = await openai.chat.completions.parse({
      model: FAST_MODEL,
      messages: [
        {
          role: 'system',
          content: `You generate clear, actionable issue messages for a tax document review interface used by accountants.

For each issue, provide:
- friendlyMessage: A clear, specific 1-sentence explanation. Include relevant details like years, amounts, or field names when available. Avoid vague language like "some issues" or "problems detected".
- suggestedAction: A concrete next step starting with an action verb. Be specific about what to request or verify. Examples:
  * "Send client a follow-up email requesting their 2024 W-2"
  * "Verify the employer EIN by checking against the original document"
  * "Request a clearer photo of page 2 showing Box 1 wages"
- severity: "error" for issues that block tax preparation (wrong year, missing critical data), "warning" for issues that need review but don't block (low confidence, minor missing fields)

Keep messages concise but informative. The accountant should understand exactly what's wrong and what to do.`
        },
        {
          role: 'user',
          content: `Document: ${fileName} (${documentType}, Tax Year ${taxYear})

Issues to explain:
${issues.map((i, idx) => `${idx + 1}. [${i.severity}:${i.type}] ${i.description}`).join('\n')}`
        }
      ],
      response_format: zodResponseFormat(FriendlyIssuesSchema, 'friendly_issues'),
      temperature: 0.3
    })

    const parsed = response.choices[0]?.message?.parsed
    if (parsed) {
      return parsed.issues.map((fi, idx) => ({
        ...fi,
        original: issues[idx]?.description || ''
      }))
    }
  } catch (error) {
    console.error('[FRIENDLY-ISSUES] Error generating:', error)
  }

  // Fallback to original issues
  return issues.map(i => ({
    original: i.description,
    friendlyMessage: i.description,
    suggestedAction: 'Review and take appropriate action',
    severity: (i.severity === 'error' ? 'error' : 'warning') as 'error' | 'warning'
  }))
}

interface GeneratedEmailContent {
  subject: string
  body: string
}

/**
 * Generate a personalized follow-up email using a fast model
 */
export async function generateFollowUpEmail(
  context: DocumentIssueContext
): Promise<GeneratedEmailContent> {
  const EmailSchema = z.object({
    subject: z.string(),
    body: z.string()
  })

  try {
    const response = await openai.chat.completions.parse({
      model: FAST_MODEL,
      messages: [
        {
          role: 'system',
          content: `You write professional, friendly, concise follow-up emails for a tax document collection service. Be specific but not overly technical. Use plain text for the body (no HTML). Keep emails under 150 words.`
        },
        {
          role: 'user',
          content: `Write a follow-up email for:
Client: ${context.clientName}
Tax Year: ${context.taxYear}
Document: ${context.fileName}

Issues found:
${context.issues.map(i => `- [${i.severity.toUpperCase()}] ${i.type}: ${i.description}. Action needed: ${i.suggestedAction}`).join('\n')}`
        }
      ],
      response_format: zodResponseFormat(EmailSchema, 'email'),
      temperature: 0.7
    })

    const parsed = response.choices[0]?.message?.parsed
    if (parsed) {
      return parsed
    }
  } catch (error) {
    console.error('[EMAIL-GEN] Error generating email:', error)
  }

  // Fallback to basic message
  return {
    subject: `Action Needed: Document Issue - ${context.taxYear}`,
    body: `Hi ${context.clientName},\n\nWe found some issues with ${context.fileName} that need your attention:\n\n${context.issues.map(i => `- ${i.description}`).join('\n')}\n\nPlease upload a corrected version.\n\nThank you.`
  }
}
