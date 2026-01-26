import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to define mocks that can be referenced in vi.mock
const mocks = vi.hoisted(() => ({
  runOutreachAgent: vi.fn().mockResolvedValue(undefined),
  runAssessmentAgent: vi.fn().mockResolvedValue({ hasIssues: false, documentType: 'W-2' }),
  runReconciliationAgent: vi.fn().mockResolvedValue({ isReady: false }),
}))

vi.mock('@/lib/agents/outreach', () => ({
  runOutreachAgent: mocks.runOutreachAgent,
}))

vi.mock('@/lib/agents/assessment', () => ({
  runAssessmentAgent: mocks.runAssessmentAgent,
}))

vi.mock('@/lib/agents/reconciliation', () => ({
  runReconciliationAgent: mocks.runReconciliationAgent,
}))

// Re-export for easier access in tests
const mockRunOutreachAgent = mocks.runOutreachAgent
const mockRunAssessmentAgent = mocks.runAssessmentAgent
const mockRunReconciliationAgent = mocks.runReconciliationAgent

import { dispatch, type AgentEvent } from '@/lib/agents/dispatcher'

describe('Dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('engagement_created event', () => {
    it('should route to Outreach Agent', async () => {
      await dispatch({
        type: 'engagement_created',
        engagementId: 'eng-1',
      })

      expect(mockRunOutreachAgent).toHaveBeenCalledWith({
        trigger: 'engagement_created',
        engagementId: 'eng-1',
      })
      expect(mockRunAssessmentAgent).not.toHaveBeenCalled()
      expect(mockRunReconciliationAgent).not.toHaveBeenCalled()
    })
  })

  describe('intake_complete event', () => {
    it('should route to Outreach Agent', async () => {
      await dispatch({
        type: 'intake_complete',
        engagementId: 'eng-1',
      })

      expect(mockRunOutreachAgent).toHaveBeenCalledWith({
        trigger: 'intake_complete',
        engagementId: 'eng-1',
      })
    })
  })

  describe('document_uploaded event', () => {
    it('should route to Assessment Agent', async () => {
      mockRunAssessmentAgent.mockResolvedValueOnce({ hasIssues: false, documentType: 'W-2' })
      mockRunReconciliationAgent.mockResolvedValueOnce({ isReady: false })

      await dispatch({
        type: 'document_uploaded',
        engagementId: 'eng-1',
        documentId: 'doc-1',
        sharepointItemId: 'sp-1',
        fileName: 'w2.pdf',
      })

      expect(mockRunAssessmentAgent).toHaveBeenCalledWith({
        trigger: 'document_uploaded',
        engagementId: 'eng-1',
        documentId: 'doc-1',
        sharepointItemId: 'sp-1',
        fileName: 'w2.pdf',
      })
    })

    it('should chain to document_assessed event after assessment', async () => {
      mockRunAssessmentAgent.mockResolvedValueOnce({ hasIssues: false, documentType: 'W-2' })
      mockRunReconciliationAgent.mockResolvedValueOnce({ isReady: false })

      await dispatch({
        type: 'document_uploaded',
        engagementId: 'eng-1',
        documentId: 'doc-1',
        sharepointItemId: 'sp-1',
        fileName: 'w2.pdf',
      })

      // Reconciliation agent should be called from document_assessed chaining
      expect(mockRunReconciliationAgent).toHaveBeenCalledWith({
        trigger: 'document_assessed',
        engagementId: 'eng-1',
        documentId: 'doc-1',
        documentType: 'W-2',
      })
    })
  })

  describe('document_assessed event', () => {
    it('should route to Outreach Agent when document has issues', async () => {
      await dispatch({
        type: 'document_assessed',
        engagementId: 'eng-1',
        documentId: 'doc-1',
        documentType: 'W-2',
        hasIssues: true,
      })

      expect(mockRunOutreachAgent).toHaveBeenCalledWith({
        trigger: 'document_issues',
        engagementId: 'eng-1',
        additionalContext: {
          documentId: 'doc-1',
          documentType: 'W-2',
        },
      })
      expect(mockRunReconciliationAgent).not.toHaveBeenCalled()
    })

    it('should route to Reconciliation Agent when document has no issues', async () => {
      mockRunReconciliationAgent.mockResolvedValueOnce({ isReady: false })

      await dispatch({
        type: 'document_assessed',
        engagementId: 'eng-1',
        documentId: 'doc-1',
        documentType: 'W-2',
        hasIssues: false,
      })

      expect(mockRunReconciliationAgent).toHaveBeenCalledWith({
        trigger: 'document_assessed',
        engagementId: 'eng-1',
        documentId: 'doc-1',
        documentType: 'W-2',
      })
      expect(mockRunOutreachAgent).not.toHaveBeenCalled()
    })

    it('should trigger Outreach Agent when engagement is ready', async () => {
      mockRunReconciliationAgent.mockResolvedValueOnce({ isReady: true })

      await dispatch({
        type: 'document_assessed',
        engagementId: 'eng-1',
        documentId: 'doc-1',
        documentType: 'W-2',
        hasIssues: false,
      })

      expect(mockRunReconciliationAgent).toHaveBeenCalled()
      expect(mockRunOutreachAgent).toHaveBeenCalledWith({
        trigger: 'engagement_complete',
        engagementId: 'eng-1',
      })
    })
  })

  describe('stale_engagement event', () => {
    it('should route to Outreach Agent', async () => {
      await dispatch({
        type: 'stale_engagement',
        engagementId: 'eng-1',
      })

      expect(mockRunOutreachAgent).toHaveBeenCalledWith({
        trigger: 'stale_engagement',
        engagementId: 'eng-1',
      })
    })
  })

  describe('check_completion event', () => {
    it('should route to Reconciliation Agent', async () => {
      mockRunReconciliationAgent.mockResolvedValueOnce({ isReady: false })

      await dispatch({
        type: 'check_completion',
        engagementId: 'eng-1',
      })

      expect(mockRunReconciliationAgent).toHaveBeenCalledWith({
        trigger: 'check_completion',
        engagementId: 'eng-1',
      })
    })

    it('should trigger Outreach Agent when engagement becomes ready', async () => {
      mockRunReconciliationAgent.mockResolvedValueOnce({ isReady: true })

      await dispatch({
        type: 'check_completion',
        engagementId: 'eng-1',
      })

      expect(mockRunOutreachAgent).toHaveBeenCalledWith({
        trigger: 'engagement_complete',
        engagementId: 'eng-1',
      })
    })
  })

  describe('unknown event type', () => {
    it('should log warning and not crash', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // @ts-expect-error - Testing unknown event type
      await dispatch({ type: 'unknown_event', engagementId: 'eng-1' })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown event type')
      )
      expect(mockRunOutreachAgent).not.toHaveBeenCalled()
      expect(mockRunAssessmentAgent).not.toHaveBeenCalled()
      expect(mockRunReconciliationAgent).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('event chaining', () => {
    it('should complete full document flow: upload -> assess -> reconcile', async () => {
      mockRunAssessmentAgent.mockResolvedValueOnce({ hasIssues: false, documentType: '1099-NEC' })
      mockRunReconciliationAgent.mockResolvedValueOnce({ isReady: false })

      await dispatch({
        type: 'document_uploaded',
        engagementId: 'eng-1',
        documentId: 'doc-1',
        sharepointItemId: 'sp-1',
        fileName: '1099.pdf',
      })

      // Assessment should be called first
      expect(mockRunAssessmentAgent).toHaveBeenCalledTimes(1)

      // Then reconciliation
      expect(mockRunReconciliationAgent).toHaveBeenCalledTimes(1)
      expect(mockRunReconciliationAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          documentType: '1099-NEC',
        })
      )
    })

    it('should complete flow to engagement_complete when 100% ready', async () => {
      mockRunAssessmentAgent.mockResolvedValueOnce({ hasIssues: false, documentType: 'W-2' })
      mockRunReconciliationAgent.mockResolvedValueOnce({ isReady: true })

      await dispatch({
        type: 'document_uploaded',
        engagementId: 'eng-1',
        documentId: 'doc-final',
        sharepointItemId: 'sp-1',
        fileName: 'last-doc.pdf',
      })

      // All three agents should be called
      expect(mockRunAssessmentAgent).toHaveBeenCalledTimes(1)
      expect(mockRunReconciliationAgent).toHaveBeenCalledTimes(1)
      expect(mockRunOutreachAgent).toHaveBeenCalledWith({
        trigger: 'engagement_complete',
        engagementId: 'eng-1',
      })
    })
  })
})
