import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { generatePrepBrief } from '../openai.js'
import type { Document, ChecklistItem, Reconciliation } from '../../types.js'

// Define the Reconciliation Agent's MCP server with tools
export const reconciliationServer = createSdkMcpServer({
  name: 'reconciliation',
  version: '1.0.0',
  tools: [
    tool(
      'get_checklist_and_documents',
      'Get the current checklist and documents for an engagement',
      {
        engagementId: z.string().describe('The engagement ID')
      },
      async (args) => {
        const engagement = await prisma.engagement.findUnique({
          where: { id: args.engagementId }
        })

        if (!engagement) {
          return {
            content: [{ type: 'text', text: 'Error: Engagement not found' }],
            isError: true
          }
        }

        const checklist = (engagement.checklist as ChecklistItem[] | null) ?? []
        const documents = (engagement.documents as Document[] | null) ?? []
        const reconciliation = engagement.reconciliation as Reconciliation | null

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              engagementId: args.engagementId,
              status: engagement.status,
              taxYear: engagement.taxYear,
              checklist: checklist.map(item => ({
                id: item.id,
                title: item.title,
                priority: item.priority,
                status: item.status,
                documentIds: item.documentIds,
                expectedDocumentType: item.expectedDocumentType || null
              })),
              documents: documents.map(doc => ({
                id: doc.id,
                fileName: doc.fileName,
                documentType: doc.documentType,
                confidence: doc.confidence,
                taxYear: doc.taxYear,
                issues: doc.issues,
                approved: doc.approved,
                override: doc.override
              })),
              currentReconciliation: reconciliation ? {
                completionPercentage: reconciliation.completionPercentage,
                issues: reconciliation.issues
              } : null
            }, null, 2)
          }]
        }
      }
    ),

    tool(
      'match_document_to_item',
      'Link a document to a checklist item',
      {
        engagementId: z.string().describe('The engagement ID'),
        documentId: z.string().describe('The document ID'),
        checklistItemId: z.string().describe('The checklist item ID'),
        confidence: z.number().min(0).max(1).describe('Confidence in the match')
      },
      async (args) => {
        const engagement = await prisma.engagement.findUnique({
          where: { id: args.engagementId }
        })

        if (!engagement) {
          return {
            content: [{ type: 'text', text: 'Error: Engagement not found' }],
            isError: true
          }
        }

        const checklist = (engagement.checklist as ChecklistItem[] | null) ?? []
        const itemIndex = checklist.findIndex(item => item.id === args.checklistItemId)

        if (itemIndex === -1) {
          return {
            content: [{ type: 'text', text: `Error: Checklist item ${args.checklistItemId} not found` }],
            isError: true
          }
        }

        // Add document to the checklist item
        if (!checklist[itemIndex].documentIds.includes(args.documentId)) {
          checklist[itemIndex].documentIds.push(args.documentId)
        }

        await prisma.engagement.update({
          where: { id: args.engagementId },
          data: { checklist }
        })

        return {
          content: [{
            type: 'text',
            text: `Matched document ${args.documentId} to checklist item "${checklist[itemIndex].title}" with ${Math.round(args.confidence * 100)}% confidence`
          }]
        }
      }
    ),

    tool(
      'update_item_status',
      'Set the status of a checklist item',
      {
        engagementId: z.string().describe('The engagement ID'),
        itemId: z.string().describe('The checklist item ID'),
        status: z.enum(['pending', 'received', 'complete']).describe('The new status')
      },
      async (args) => {
        const engagement = await prisma.engagement.findUnique({
          where: { id: args.engagementId }
        })

        if (!engagement) {
          return {
            content: [{ type: 'text', text: 'Error: Engagement not found' }],
            isError: true
          }
        }

        const checklist = (engagement.checklist as ChecklistItem[] | null) ?? []
        const itemIndex = checklist.findIndex(item => item.id === args.itemId)

        if (itemIndex === -1) {
          return {
            content: [{ type: 'text', text: `Error: Checklist item ${args.itemId} not found` }],
            isError: true
          }
        }

        const oldStatus = checklist[itemIndex].status
        checklist[itemIndex].status = args.status

        await prisma.engagement.update({
          where: { id: args.engagementId },
          data: { checklist }
        })

        return {
          content: [{
            type: 'text',
            text: `Updated item "${checklist[itemIndex].title}" status: ${oldStatus} -> ${args.status}`
          }]
        }
      }
    ),

    tool(
      'calculate_completion',
      'Calculate the weighted completion percentage',
      {
        engagementId: z.string().describe('The engagement ID')
      },
      async (args) => {
        const engagement = await prisma.engagement.findUnique({
          where: { id: args.engagementId }
        })

        if (!engagement) {
          return {
            content: [{ type: 'text', text: 'Error: Engagement not found' }],
            isError: true
          }
        }

        const checklist = (engagement.checklist as ChecklistItem[] | null) ?? []

        if (checklist.length === 0) {
          return {
            content: [{ type: 'text', text: 'No checklist items to calculate completion for' }]
          }
        }

        // Weight by priority: high=50%, medium=35%, low=15%
        const weights = { high: 0.5, medium: 0.35, low: 0.15 }

        let totalWeight = 0
        let completedWeight = 0

        for (const item of checklist) {
          const weight = weights[item.priority] ?? 0.35
          totalWeight += weight

          if (item.status === 'complete') {
            completedWeight += weight
          } else if (item.status === 'received') {
            completedWeight += weight * 0.5 // Received = 50% credit
          }
        }

        const completionPercentage = totalWeight > 0
          ? Math.round((completedWeight / totalWeight) * 100)
          : 0

        // Build item statuses for reconciliation record
        const itemStatuses = checklist.map(item => ({
          itemId: item.id,
          status: item.status,
          documentIds: item.documentIds
        }))

        // Update reconciliation
        const reconciliation: Reconciliation = {
          completionPercentage,
          itemStatuses,
          issues: [],
          ranAt: new Date().toISOString()
        }

        await prisma.engagement.update({
          where: { id: args.engagementId },
          data: { reconciliation }
        })

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              completionPercentage,
              totalItems: checklist.length,
              completeItems: checklist.filter(i => i.status === 'complete').length,
              receivedItems: checklist.filter(i => i.status === 'received').length,
              pendingItems: checklist.filter(i => i.status === 'pending').length
            }, null, 2)
          }]
        }
      }
    ),

    tool(
      'check_ready',
      'Determine if the engagement is ready to move to READY status',
      {
        engagementId: z.string().describe('The engagement ID')
      },
      async (args) => {
        const engagement = await prisma.engagement.findUnique({
          where: { id: args.engagementId }
        })

        if (!engagement) {
          return {
            content: [{ type: 'text', text: 'Error: Engagement not found' }],
            isError: true
          }
        }

        const checklist = (engagement.checklist as ChecklistItem[] | null) ?? []
        const documents = (engagement.documents as Document[] | null) ?? []
        const reconciliation = engagement.reconciliation as Reconciliation | null

        // Check if all high-priority items are complete
        const highPriorityItems = checklist.filter(i => i.priority === 'high')
        const highPriorityComplete = highPriorityItems.every(i => i.status === 'complete')

        // Check if any documents have unresolved issues
        // A document is "resolved" if it has no issues OR it has been approved by accountant
        const documentsWithUnresolvedIssues = documents.filter(d =>
          d.issues.length > 0 && d.approved !== true
        )

        // Determine readiness
        const isReady = (reconciliation?.completionPercentage === 100) ||
          (highPriorityComplete && documentsWithUnresolvedIssues.length === 0)

        const reasons: string[] = []
        if (!highPriorityComplete) {
          reasons.push('Not all high-priority items are complete')
        }
        if (documentsWithUnresolvedIssues.length > 0) {
          reasons.push(`${documentsWithUnresolvedIssues.length} document(s) have unresolved issues`)
        }
        if (reconciliation?.completionPercentage !== 100) {
          reasons.push(`Completion is ${reconciliation?.completionPercentage ?? 0}%, not 100%`)
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              isReady,
              completionPercentage: reconciliation?.completionPercentage ?? 0,
              highPriorityComplete,
              documentsWithUnresolvedIssues: documentsWithUnresolvedIssues.length,
              reasons: isReady ? ['All requirements met'] : reasons
            }, null, 2)
          }]
        }
      }
    ),

    tool(
      'update_engagement_status',
      'Update the engagement status',
      {
        engagementId: z.string().describe('The engagement ID'),
        status: z.enum(['PENDING', 'INTAKE_DONE', 'COLLECTING', 'READY']).describe('The new status')
      },
      async (args) => {
        await prisma.engagement.update({
          where: { id: args.engagementId },
          data: { status: args.status }
        })

        return {
          content: [{ type: 'text', text: `Engagement status updated to ${args.status}` }]
        }
      }
    ),

    tool(
      'generate_brief',
      'Generate the accountant prep brief',
      {
        engagementId: z.string().describe('The engagement ID')
      },
      async (args) => {
        const engagement = await prisma.engagement.findUnique({
          where: { id: args.engagementId }
        })

        if (!engagement) {
          return {
            content: [{ type: 'text', text: 'Error: Engagement not found' }],
            isError: true
          }
        }

        const checklist = (engagement.checklist as ChecklistItem[] | null) ?? []
        const documents = (engagement.documents as Document[] | null) ?? []
        const reconciliation = engagement.reconciliation as Reconciliation | null

        try {
          const brief = await generatePrepBrief({
            clientName: engagement.clientName,
            taxYear: engagement.taxYear,
            checklist,
            documents,
            reconciliation: {
              completionPercentage: reconciliation?.completionPercentage ?? 0,
              issues: reconciliation?.issues ?? []
            }
          })

          await prisma.engagement.update({
            where: { id: args.engagementId },
            data: { prepBrief: brief }
          })

          return {
            content: [{
              type: 'text',
              text: `Brief generated successfully (${brief.length} characters)`
            }]
          }
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Error generating brief: ${error instanceof Error ? error.message : 'Unknown error'}` }],
            isError: true
          }
        }
      }
    )
  ]
})

// Agent trigger types
export type ReconciliationTrigger = 'document_assessed' | 'manual_reconciliation' | 'check_completion'


// Run the Reconciliation Agent
export async function runReconciliationAgent(context: {
  trigger: ReconciliationTrigger
  engagementId: string
  documentId?: string
  documentType?: string
}): Promise<{ isReady: boolean; completionPercentage: number }> {
  const engagement = await prisma.engagement.findUnique({
    where: { id: context.engagementId }
  })

  if (!engagement) {
    throw new Error(`Engagement ${context.engagementId} not found`)
  }

  const systemPrompt = `You are a Reconciliation Agent for a tax document collection system. Your role is to match documents to checklist items, track completion, and determine when an engagement is ready for the accountant.

Current trigger: ${context.trigger}
Engagement ID: ${context.engagementId}
${context.documentId ? `Document ID: ${context.documentId}` : ''}
${context.documentType ? `Document Type: ${context.documentType}` : ''}

Your workflow:
1. Get the current checklist and documents
2. If a new document was assessed, match it to the appropriate checklist item(s)
3. Update item statuses based on matched documents
4. Calculate the completion percentage
5. Check if the engagement is ready (100% complete or all high-priority items done)
6. If ready, generate the prep brief and update status to READY

MATCHING RULES - USE expectedDocumentType:
Each checklist item has an "expectedDocumentType" field. Match documents to items where:
- Document's documentType EXACTLY matches the item's expectedDocumentType
- For example: A document with type "W-2" matches items with expectedDocumentType "W-2"
- A document with type "1099-NEC" matches items with expectedDocumentType "1099-NEC"

STATUS UPDATE RULES:
- When a document matches an item: set item status to "received" if doc has issues, "complete" if no issues
- A document is considered "good" if it has no issues OR has been approved by accountant (approved: true)

Be precise - only match documents where the types align exactly.`

  const prompt = context.trigger === 'document_assessed'
    ? `A new document was assessed: ${context.documentType} (ID: ${context.documentId}). Match it to the appropriate checklist items, update statuses, and check if the engagement is ready.`
    : `Perform a reconciliation check for engagement ${context.engagementId}. Review all documents and checklist items, update statuses, and determine if ready.`

  let isReady = false
  let completionPercentage = 0

  try {
    const response = query({
      prompt,
      options: {
        model: 'claude-sonnet-4-5',
        systemPrompt,
        mcpServers: {
          reconciliation: reconciliationServer
        },
        allowedTools: [
          'mcp__reconciliation__get_checklist_and_documents',
          'mcp__reconciliation__match_document_to_item',
          'mcp__reconciliation__update_item_status',
          'mcp__reconciliation__calculate_completion',
          'mcp__reconciliation__check_ready',
          'mcp__reconciliation__update_engagement_status',
          'mcp__reconciliation__generate_brief'
        ]
      }
    })

    // Consume the async generator
    for await (const _ of response) {
      // Agent executes tools autonomously
    }

    // Fetch updated engagement to get reconciliation results
    const updatedEngagement = await prisma.engagement.findUnique({
      where: { id: context.engagementId }
    })

    if (updatedEngagement) {
      const reconciliation = updatedEngagement.reconciliation as Reconciliation | null
      const documents = (updatedEngagement.documents as Document[] | null) ?? []

      if (reconciliation) {
        completionPercentage = reconciliation.completionPercentage
      }

      // Deterministic status update: if 100% complete and no unresolved issues, mark as READY
      const hasUnresolvedIssues = documents.some(d => d.issues.length > 0 && d.approved !== true)

      if (completionPercentage === 100 && !hasUnresolvedIssues && updatedEngagement.status !== 'READY') {
        await prisma.engagement.update({
          where: { id: context.engagementId },
          data: { status: 'READY' }
        })
        isReady = true
        console.log(`[RECONCILIATION] Auto-transitioned ${context.engagementId} to READY (100% complete, no unresolved issues)`)
      } else {
        isReady = updatedEngagement.status === 'READY'
      }
    }

    // Log agent activity
    const existingLog = (engagement.agentLog as object[] | null) ?? []
    const newEntry = {
      timestamp: new Date().toISOString(),
      agent: 'reconciliation',
      trigger: context.trigger,
      outcome: isReady ? 'ready' : `${completionPercentage}% complete`
    }

    await prisma.engagement.update({
      where: { id: context.engagementId },
      data: {
        agentLog: [...existingLog, newEntry] as object[],
        lastActivityAt: new Date()
      }
    })

    console.log(`[RECONCILIATION] Completed ${context.trigger} for ${context.engagementId}. Ready: ${isReady}, Completion: ${completionPercentage}%`)

    return { isReady, completionPercentage }
  } catch (error) {
    console.error(`[RECONCILIATION] Error for ${context.engagementId}:`, error)
    throw error
  }
}
