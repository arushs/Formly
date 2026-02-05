import { describe, it, expect, vi, beforeEach } from 'vitest'
import { emailTemplates, sendEmail } from '../email.js'

// Mock Resend
const mockSend = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: {
      send: mockSend,
    },
  })),
}))

describe('emailTemplates', () => {
  const mockEngagement = {
    id: 'eng_001',
    clientName: 'Test Client',
    clientEmail: 'client@example.com',
    taxYear: 2025,
    typeformFormId: 'form_123',
    storageFolderUrl: 'https://www.dropbox.com/sh/test',
    checklist: [
      { id: 'item_001', title: 'W-2 from Employer' },
      { id: 'item_002', title: '1099-INT from Bank' },
    ],
  }

  describe('welcome template', () => {
    it('generates correct subject', () => {
      const template = emailTemplates.welcome(mockEngagement)
      expect(template.subject).toBe('Tax Document Collection - 2025')
    })

    it('includes client name in body', () => {
      const template = emailTemplates.welcome(mockEngagement)
      expect(template.html).toContain('Hello Test Client')
    })

    it('includes Typeform link with engagement ID', () => {
      const template = emailTemplates.welcome(mockEngagement)
      expect(template.html).toContain('https://form.typeform.com/to/form_123?engagement_id=eng_001')
    })

    it('includes tax year', () => {
      const template = emailTemplates.welcome(mockEngagement)
      expect(template.html).toContain('2025')
    })
  })

  describe('sharepoint_instructions template', () => {
    it('generates correct subject', () => {
      const template = emailTemplates.sharepoint_instructions(mockEngagement)
      expect(template.subject).toBe('Upload Your Documents - 2025 Taxes')
    })

    it('includes checklist items', () => {
      const template = emailTemplates.sharepoint_instructions(mockEngagement)
      expect(template.html).toContain('W-2 from Employer')
      expect(template.html).toContain('1099-INT from Bank')
    })

    it('includes storage folder URL', () => {
      const template = emailTemplates.sharepoint_instructions(mockEngagement)
      expect(template.html).toContain('https://www.dropbox.com/sh/test')
    })

    it('handles null checklist', () => {
      const engagementNoChecklist = { ...mockEngagement, checklist: null }
      const template = emailTemplates.sharepoint_instructions(engagementNoChecklist)
      expect(template.html).not.toContain('undefined')
    })
  })

  describe('reminder template', () => {
    const missingItems = [
      { id: 'item_001', title: 'W-2 from Employer' },
    ]

    it('generates correct subject', () => {
      const template = emailTemplates.reminder(mockEngagement, missingItems)
      expect(template.subject).toBe('Reminder: Documents Still Needed - 2025')
    })

    it('includes missing items', () => {
      const template = emailTemplates.reminder(mockEngagement, missingItems)
      expect(template.html).toContain('W-2 from Employer')
    })

    it('includes client name', () => {
      const template = emailTemplates.reminder(mockEngagement, missingItems)
      expect(template.html).toContain('Hi Test Client')
    })
  })

  describe('document_issue template', () => {
    const issues = [
      { fileName: 'w2.pdf', problem: 'Wrong tax year (2024 instead of 2025)' },
    ]

    it('generates correct subject', () => {
      const template = emailTemplates.document_issue(mockEngagement, issues)
      expect(template.subject).toBe('Action Needed: Document Issues - 2025')
    })

    it('includes document issues', () => {
      const template = emailTemplates.document_issue(mockEngagement, issues)
      expect(template.html).toContain('w2.pdf')
      expect(template.html).toContain('Wrong tax year')
    })
  })

  describe('complete template', () => {
    it('generates correct subject', () => {
      const template = emailTemplates.complete(mockEngagement)
      expect(template.subject).toBe('Documents Received - 2025 Taxes')
    })

    it('includes success message', () => {
      const template = emailTemplates.complete(mockEngagement)
      expect(template.html).toContain('All Documents Received')
    })

    it('includes client name', () => {
      const template = emailTemplates.complete(mockEngagement)
      expect(template.html).toContain('Hi Test Client')
    })
  })

  describe('accountant_notification template', () => {
    it('generates correct subject', () => {
      const template = emailTemplates.accountant_notification(mockEngagement)
      expect(template.subject).toBe('[Ready for Review] Test Client - 2025')
    })

    it('includes engagement details', () => {
      const template = emailTemplates.accountant_notification(mockEngagement)
      expect(template.html).toContain('Test Client')
      expect(template.html).toContain('2025')
      expect(template.html).toContain('client@example.com')
    })
  })
})

describe('sendEmail', () => {
  beforeEach(() => {
    mockSend.mockClear()
    process.env.RESEND_API_KEY = 'test-key'
    process.env.EMAIL_FROM = 'noreply@test.com'
  })

  it('sends email successfully', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'email_123' }, error: null })

    const result = await sendEmail('test@example.com', {
      subject: 'Test Subject',
      html: '<p>Test body</p>',
    })

    expect(result).toEqual({ id: 'email_123' })
    expect(mockSend).toHaveBeenCalledWith({
      from: 'noreply@test.com',
      to: 'test@example.com',
      subject: 'Test Subject',
      html: '<p>Test body</p>',
    })
  })

  it('throws on validation error without retry', async () => {
    mockSend.mockResolvedValueOnce({
      data: null,
      error: { name: 'validation_error', message: 'Invalid email address' },
    })

    await expect(
      sendEmail('invalid', { subject: 'Test', html: '<p>Test</p>' })
    ).rejects.toThrow('Invalid email address')

    // Should not retry on validation errors
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('retries on transient errors', async () => {
    mockSend
      .mockResolvedValueOnce({
        data: null,
        error: { name: 'server_error', message: 'Server error' },
      })
      .mockResolvedValueOnce({ data: { id: 'email_456' }, error: null })

    const result = await sendEmail('test@example.com', {
      subject: 'Test',
      html: '<p>Test</p>',
    }, { retries: 3 })

    expect(result).toEqual({ id: 'email_456' })
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it('throws when EMAIL_FROM is not set', async () => {
    delete process.env.EMAIL_FROM

    await expect(
      sendEmail('test@example.com', { subject: 'Test', html: '<p>Test</p>' })
    ).rejects.toThrow('EMAIL_FROM is not set')
  })
})
