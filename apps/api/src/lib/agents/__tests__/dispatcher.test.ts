import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dispatch, type AgentEvent } from '../dispatcher.js'
import { createMockEngagement, createMockChecklistItem, resetIdCounter } from '../../../test/factories.js'

// Mock dependencies
vi.mock('../../prisma.js', () => ({
  prisma: {
    engagement: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../../email.js', () => ({
  sendEmail: vi.fn(async () => ({ id: 'email_123' })),
  emailTemplates: {
    welcome: vi.fn((e) => ({ subject: 'Welcome', html: `<p>Hello ${e.clientName}</p>` })),
    sharepoint_instructions: vi.fn((e) => ({ subject: 'Upload', html: '<p>Upload</p>' })),
    complete: vi.fn((e) => ({ subject: 'Complete', html: '<p>Complete</p>' })),
    accountant_notification: vi.fn((e) => ({ subject: 'Notification', html: '<p>Ready</p>' })),
  },
}))

vi.mock('../assessment.js', () => ({
  runAssessmentAgent: vi.fn(async () => ({
    documentType: 'W-2',
    hasIssues: false,
  })),
}))

vi.mock('../reconciliation.js', () => ({
  runReconciliationAgent: vi.fn(async () => ({
    isReady: false,
    completionPercentage: 50,
  })),
}))

import { prisma } from '../../prisma.js'
import { sendEmail, emailTemplates } from '../../email.js'
import { runAssessmentAgent } from '../assessment.js'
import { runReconciliationAgent } from '../reconciliation.js'

describe('Agent Dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetIdCounter()
    process.env.ACCOUNTANT_EMAIL = 'accountant@example.com'
  })

  describe('engagement_created event', () => {
    it('sends welcome email', async () => {
      const mockEngagement = createMockEngagement({ id: 'eng_123' })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce(mockEngagement as any)

      await dispatch({ type: 'engagement_created', engagementId: 'eng_123' })

      expect(emailTemplates.welcome).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'eng_123',
          clientName: 'Test Client',
        })
      )
      expect(sendEmail).toHaveBeenCalledWith(
        'client@example.com',
        expect.objectContaining({ subject: 'Welcome' })
      )
    })

    it('handles non-existent engagement gracefully', async () => {
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(null)

      // Should not throw
      await dispatch({ type: 'engagement_created', engagementId: 'nonexistent' })

      expect(sendEmail).not.toHaveBeenCalled()
    })
  })

  describe('intake_complete event', () => {
    it('sends upload instructions', async () => {
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        checklist: [createMockChecklistItem()],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce(mockEngagement as any)

      await dispatch({ type: 'intake_complete', engagementId: 'eng_123' })

      expect(emailTemplates.sharepoint_instructions).toHaveBeenCalled()
      expect(sendEmail).toHaveBeenCalledWith(
        'client@example.com',
        expect.objectContaining({ subject: 'Upload' })
      )
    })
  })

  describe('document_uploaded event', () => {
    it('runs assessment agent and chains to document_assessed', async () => {
      const mockEngagement = createMockEngagement({ id: 'eng_123' })

      await dispatch({
        type: 'document_uploaded',
        engagementId: 'eng_123',
        documentId: 'doc_001',
        storageItemId: 'storage_001',
        fileName: 'w2.pdf',
      })

      expect(runAssessmentAgent).toHaveBeenCalledWith({
        trigger: 'document_uploaded',
        engagementId: 'eng_123',
        documentId: 'doc_001',
        storageItemId: 'storage_001',
        fileName: 'w2.pdf',
      })
    })
  })

  describe('document_assessed event', () => {
    it('runs reconciliation for documents without issues', async () => {
      vi.mocked(runReconciliationAgent).mockResolvedValueOnce({
        isReady: false,
        completionPercentage: 50,
      })

      await dispatch({
        type: 'document_assessed',
        engagementId: 'eng_123',
        documentId: 'doc_001',
        documentType: 'W-2',
        hasIssues: false,
      })

      expect(runReconciliationAgent).toHaveBeenCalledWith({
        trigger: 'document_assessed',
        engagementId: 'eng_123',
        documentId: 'doc_001',
        documentType: 'W-2',
      })
    })

    it('skips reconciliation for documents with issues', async () => {
      await dispatch({
        type: 'document_assessed',
        engagementId: 'eng_123',
        documentId: 'doc_001',
        documentType: 'W-2',
        hasIssues: true,
      })

      expect(runReconciliationAgent).not.toHaveBeenCalled()
    })

    it('sends completion emails when ready', async () => {
      const mockEngagement = createMockEngagement({ id: 'eng_123' })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(runReconciliationAgent).mockResolvedValueOnce({
        isReady: true,
        completionPercentage: 100,
      })

      await dispatch({
        type: 'document_assessed',
        engagementId: 'eng_123',
        documentId: 'doc_001',
        documentType: 'W-2',
        hasIssues: false,
      })

      expect(emailTemplates.complete).toHaveBeenCalled()
      expect(emailTemplates.accountant_notification).toHaveBeenCalled()
    })
  })

  describe('stale_engagement event', () => {
    it('logs stale engagement (TODO: send reminder)', async () => {
      const consoleSpy = vi.spyOn(console, 'log')

      await dispatch({
        type: 'stale_engagement',
        engagementId: 'eng_123',
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Stale engagement')
      )
    })
  })

  describe('check_completion event', () => {
    it('runs reconciliation and sends emails if ready', async () => {
      const mockEngagement = createMockEngagement({ id: 'eng_123' })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(runReconciliationAgent).mockResolvedValueOnce({
        isReady: true,
        completionPercentage: 100,
      })

      await dispatch({
        type: 'check_completion',
        engagementId: 'eng_123',
      })

      expect(runReconciliationAgent).toHaveBeenCalledWith({
        trigger: 'check_completion',
        engagementId: 'eng_123',
      })
      expect(sendEmail).toHaveBeenCalled()
    })

    it('does not send emails if not ready', async () => {
      vi.mocked(runReconciliationAgent).mockResolvedValueOnce({
        isReady: false,
        completionPercentage: 75,
      })

      await dispatch({
        type: 'check_completion',
        engagementId: 'eng_123',
      })

      expect(sendEmail).not.toHaveBeenCalled()
    })
  })

  describe('unknown event', () => {
    it('logs warning for unknown event type', async () => {
      const consoleSpy = vi.spyOn(console, 'warn')

      await dispatch({ type: 'unknown_event' as any, engagementId: 'eng_123' })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown event type')
      )
    })
  })
})
