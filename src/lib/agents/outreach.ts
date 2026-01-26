import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { sendEmail, emailTemplates } from '@/lib/email'
import type { ChecklistItem, Reconciliation } from '@/types'

// Define the Outreach Agent's MCP server with tools
export const outreachServer = createSdkMcpServer({
  name: 'outreach',
  version: '1.0.0',
  tools: [
    tool(
      'send_email',
      'Send an email to the client using a template',
      {
        engagementId: z.string().describe('The engagement ID'),
        templateType: z.enum([
          'welcome',
          'sharepoint_instructions',
          'reminder',
          'document_issue',
          'complete',
          'accountant_notification'
        ]).describe('The email template to use'),
        customData: z.object({
          missingItems: z.array(z.object({
            id: z.string(),
            title: z.string()
          })).optional(),
          issues: z.array(z.object({
            fileName: z.string(),
            problem: z.string()
          })).optional()
        }).optional().describe('Additional data for templates that need it')
      },
      async (args) => {
        const engagement = await prisma.engagement.findUnique({
          where: { id: args.engagementId }
        })

        if (!engagement) {
          return {
            content: [{ type: 'text', text: `Error: Engagement ${args.engagementId} not found` }],
            isError: true
          }
        }

        const engagementData = {
          id: engagement.id,
          clientName: engagement.clientName,
          clientEmail: engagement.clientEmail,
          taxYear: engagement.taxYear,
          typeformFormId: engagement.typeformFormId,
          sharepointFolderUrl: engagement.sharepointFolderUrl,
          checklist: engagement.checklist as ChecklistItem[] | null
        }

        let template
        switch (args.templateType) {
          case 'welcome':
            template = emailTemplates.welcome(engagementData)
            break
          case 'sharepoint_instructions':
            template = emailTemplates.sharepoint_instructions(engagementData)
            break
          case 'reminder':
            template = emailTemplates.reminder(engagementData, args.customData?.missingItems ?? [])
            break
          case 'document_issue':
            template = emailTemplates.document_issue(engagementData, args.customData?.issues ?? [])
            break
          case 'complete':
            template = emailTemplates.complete(engagementData)
            break
          case 'accountant_notification':
            template = emailTemplates.accountant_notification(engagementData)
            break
        }

        try {
          const recipient = args.templateType === 'accountant_notification'
            ? process.env.ACCOUNTANT_EMAIL ?? engagement.clientEmail
            : engagement.clientEmail

          const result = await sendEmail(recipient, template)

          // Update lastActivityAt
          await prisma.engagement.update({
            where: { id: args.engagementId },
            data: { lastActivityAt: new Date() }
          })

          return {
            content: [{ type: 'text', text: `Email sent successfully. ID: ${result.id}` }]
          }
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Error sending email: ${error instanceof Error ? error.message : 'Unknown error'}` }],
            isError: true
          }
        }
      }
    ),

    tool(
      'get_engagement_status',
      'Get the current status and progress of an engagement',
      {
        engagementId: z.string().describe('The engagement ID')
      },
      async (args) => {
        const engagement = await prisma.engagement.findUnique({
          where: { id: args.engagementId }
        })

        if (!engagement) {
          return {
            content: [{ type: 'text', text: `Error: Engagement ${args.engagementId} not found` }],
            isError: true
          }
        }

        const reconciliation = engagement.reconciliation as Reconciliation | null
        const checklist = engagement.checklist as ChecklistItem[] | null

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: engagement.id,
              clientName: engagement.clientName,
              clientEmail: engagement.clientEmail,
              taxYear: engagement.taxYear,
              status: engagement.status,
              completionPercentage: reconciliation?.completionPercentage ?? 0,
              checklistItemCount: checklist?.length ?? 0,
              reminderCount: engagement.reminderCount,
              lastActivityAt: engagement.lastActivityAt?.toISOString() ?? null
            }, null, 2)
          }]
        }
      }
    ),

    tool(
      'get_missing_documents',
      'List documents that are still needed from the client',
      {
        engagementId: z.string().describe('The engagement ID')
      },
      async (args) => {
        const engagement = await prisma.engagement.findUnique({
          where: { id: args.engagementId }
        })

        if (!engagement) {
          return {
            content: [{ type: 'text', text: `Error: Engagement ${args.engagementId} not found` }],
            isError: true
          }
        }

        const checklist = engagement.checklist as ChecklistItem[] | null
        const reconciliation = engagement.reconciliation as Reconciliation | null

        if (!checklist || checklist.length === 0) {
          return {
            content: [{ type: 'text', text: 'No checklist items found. The intake form may not have been completed yet.' }]
          }
        }

        // Get status from reconciliation if available, otherwise use checklist status
        const statusMap = new Map<string, string>()
        if (reconciliation?.itemStatuses) {
          for (const status of reconciliation.itemStatuses) {
            statusMap.set(status.itemId, status.status)
          }
        }

        const missingItems = checklist.filter(item => {
          const status = statusMap.get(item.id) ?? item.status
          return status !== 'complete'
        })

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              totalItems: checklist.length,
              missingCount: missingItems.length,
              missingItems: missingItems.map(item => ({
                id: item.id,
                title: item.title,
                priority: item.priority,
                why: item.why
              }))
            }, null, 2)
          }]
        }
      }
    ),

    tool(
      'schedule_reminder',
      'Update the engagement to trigger a reminder in the future',
      {
        engagementId: z.string().describe('The engagement ID'),
        delayDays: z.number().min(1).max(14).default(3).describe('Days until reminder should be sent')
      },
      async (args) => {
        const engagement = await prisma.engagement.findUnique({
          where: { id: args.engagementId }
        })

        if (!engagement) {
          return {
            content: [{ type: 'text', text: `Error: Engagement ${args.engagementId} not found` }],
            isError: true
          }
        }

        // Set lastActivityAt to now so the reminder cron will pick it up after delayDays
        await prisma.engagement.update({
          where: { id: args.engagementId },
          data: {
            lastActivityAt: new Date(),
            reminderCount: { increment: 1 },
            lastReminderAt: new Date()
          }
        })

        return {
          content: [{
            type: 'text',
            text: `Reminder scheduled. Will be sent after ${args.delayDays} days of inactivity. Reminder count: ${engagement.reminderCount + 1}`
          }]
        }
      }
    )
  ]
})

// Agent trigger types
export type OutreachTrigger =
  | 'engagement_created'
  | 'intake_complete'
  | 'stale_engagement'
  | 'document_issues'
  | 'engagement_complete'


// Run the Outreach Agent
export async function runOutreachAgent(context: {
  trigger: OutreachTrigger
  engagementId: string
  additionalContext?: Record<string, unknown>
}): Promise<void> {
  const systemPrompt = `You are an Outreach Agent for a tax document collection system. Your role is to communicate with clients via email to help them complete their tax document submission.

Current trigger: ${context.trigger}
Engagement ID: ${context.engagementId}
${context.additionalContext ? `Additional context: ${JSON.stringify(context.additionalContext)}` : ''}

Based on the trigger, decide what actions to take:

- engagement_created: Send a welcome email with the Typeform intake link
- intake_complete: Send SharePoint upload instructions with the checklist
- stale_engagement: Check missing documents and send a reminder (max 5 reminders)
- document_issues: Send email about document problems that need correction
- engagement_complete: Send completion confirmation to client and notify accountant

Always check the engagement status first, then take appropriate action. Be professional and helpful in all communications.`

  const prompt = `Handle the "${context.trigger}" event for engagement ${context.engagementId}. First check the engagement status, then decide what email(s) to send.`

  try {
    const response = query({
      prompt,
      options: {
        model: 'claude-sonnet-4-5',
        systemPrompt,
        mcpServers: {
          outreach: outreachServer
        },
        allowedTools: [
          'mcp__outreach__send_email',
          'mcp__outreach__get_engagement_status',
          'mcp__outreach__get_missing_documents',
          'mcp__outreach__schedule_reminder'
        ]
      }
    })

    // Consume the async generator
    for await (const _ of response) {
      // Agent executes tools autonomously
    }

    // Log agent activity
    const engagement = await prisma.engagement.findUnique({
      where: { id: context.engagementId }
    })

    if (engagement) {
      const existingLog = (engagement.agentLog as object[] | null) ?? []
      const newEntry = {
        timestamp: new Date().toISOString(),
        agent: 'outreach',
        trigger: context.trigger,
        outcome: 'success'
      }

      await prisma.engagement.update({
        where: { id: context.engagementId },
        data: {
          agentLog: [...existingLog, newEntry] as object[]
        }
      })
    }

    console.log(`[OUTREACH] Completed ${context.trigger} for ${context.engagementId}`)
  } catch (error) {
    console.error(`[OUTREACH] Error handling ${context.trigger} for ${context.engagementId}:`, error)
    throw error
  }
}
