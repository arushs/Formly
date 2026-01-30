import { runOutreachAgent, type OutreachTrigger } from './outreach.js'
import { runAssessmentAgent, type AssessmentTrigger } from './assessment.js'
import { runReconciliationAgent, type ReconciliationTrigger } from './reconciliation.js'

// All possible event types
export type AgentEvent =
  | { type: 'engagement_created'; engagementId: string }
  | { type: 'intake_complete'; engagementId: string }
  | { type: 'document_uploaded'; engagementId: string; documentId: string; sharepointItemId: string; fileName: string }
  | { type: 'document_assessed'; engagementId: string; documentId: string; documentType: string; hasIssues: boolean }
  | { type: 'stale_engagement'; engagementId: string }
  | { type: 'check_completion'; engagementId: string }

// Dispatch an event to the appropriate agent(s)
export async function dispatch(event: AgentEvent): Promise<void> {
  console.log(`[DISPATCHER] Received event: ${event.type} for engagement ${event.engagementId}`)

  switch (event.type) {
    case 'engagement_created':
      // Outreach Agent sends welcome email
      await runOutreachAgent({
        trigger: 'engagement_created',
        engagementId: event.engagementId
      })
      break

    case 'intake_complete':
      // Outreach Agent sends SharePoint instructions
      await runOutreachAgent({
        trigger: 'intake_complete',
        engagementId: event.engagementId
      })
      break

    case 'document_uploaded':
      // Assessment Agent processes the document
      const assessmentResult = await runAssessmentAgent({
        trigger: 'document_uploaded',
        engagementId: event.engagementId,
        documentId: event.documentId,
        sharepointItemId: event.sharepointItemId,
        fileName: event.fileName
      })

      // Chain to reconciliation after assessment
      await dispatch({
        type: 'document_assessed',
        engagementId: event.engagementId,
        documentId: event.documentId,
        documentType: assessmentResult.documentType,
        hasIssues: assessmentResult.hasIssues
      })
      break

    case 'document_assessed':
      if (event.hasIssues) {
        // Outreach Agent notifies client about issues
        await runOutreachAgent({
          trigger: 'document_issues',
          engagementId: event.engagementId,
          additionalContext: {
            documentId: event.documentId,
            documentType: event.documentType
          }
        })
      } else {
        // Reconciliation Agent matches and checks completion
        const reconcileResult = await runReconciliationAgent({
          trigger: 'document_assessed',
          engagementId: event.engagementId,
          documentId: event.documentId,
          documentType: event.documentType
        })

        if (reconcileResult.isReady) {
          // Outreach Agent notifies client and accountant
          await runOutreachAgent({
            trigger: 'engagement_complete',
            engagementId: event.engagementId
          })
        }
      }
      break

    case 'stale_engagement':
      // Outreach Agent sends reminder
      await runOutreachAgent({
        trigger: 'stale_engagement',
        engagementId: event.engagementId
      })
      break

    case 'check_completion':
      // Reconciliation Agent checks if ready
      const checkResult = await runReconciliationAgent({
        trigger: 'check_completion',
        engagementId: event.engagementId
      })

      if (checkResult.isReady) {
        await runOutreachAgent({
          trigger: 'engagement_complete',
          engagementId: event.engagementId
        })
      }
      break

    default:
      console.warn(`[DISPATCHER] Unknown event type: ${(event as { type: string }).type}`)
  }
}

// Export individual agent runners for direct use
export { runOutreachAgent, runAssessmentAgent, runReconciliationAgent }
export type { OutreachTrigger, AssessmentTrigger, ReconciliationTrigger }
