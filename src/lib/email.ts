import { Resend } from 'resend'
import type { ChecklistItem } from '@/types'

const resend = new Resend(process.env.RESEND_API_KEY)

interface Engagement {
  id: string
  clientName: string
  clientEmail: string
  taxYear: number
  typeformFormId: string
  sharepointFolderUrl: string
  checklist?: ChecklistItem[] | null
}

interface DocumentIssue {
  fileName: string
  problem: string
}

export const emailTemplates = {
  welcome: (engagement: Engagement) => ({
    subject: `Tax Document Collection - ${engagement.taxYear}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1f2937;">Hello ${engagement.clientName},</h1>
        <p>We're ready to collect your tax documents for ${engagement.taxYear}.</p>
        <p><strong>Step 1:</strong> Complete this intake form to help us understand what documents we'll need:</p>
        <p style="margin: 24px 0;">
          <a href="https://form.typeform.com/to/${engagement.typeformFormId}?engagement_id=${engagement.id}"
             style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            Complete Intake Form
          </a>
        </p>
        <p>After you complete the form, we'll send instructions for uploading your documents.</p>
        <p style="color: #6b7280; font-size: 14px; margin-top: 32px;">
          If you have any questions, please reply to this email.
        </p>
      </div>
    `
  }),

  sharepoint_instructions: (engagement: Engagement) => ({
    subject: `Upload Your Documents - ${engagement.taxYear} Taxes`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1f2937;">Time to Upload Your Documents</h1>
        <p>Thanks for completing the intake form! Based on your responses, we need the following documents:</p>
        <ul style="background-color: #f3f4f6; padding: 16px 32px; border-radius: 8px;">
          ${(engagement.checklist ?? []).map(item => `<li style="margin: 8px 0;">${item.title}</li>`).join('')}
        </ul>
        <p><strong>Upload your documents here:</strong></p>
        <p style="margin: 24px 0;">
          <a href="${engagement.sharepointFolderUrl}"
             style="background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            Open SharePoint Folder
          </a>
        </p>
        <p style="color: #6b7280; font-size: 14px;">
          Simply drag and drop your files into the folder. We'll process them automatically.
        </p>
      </div>
    `
  }),

  reminder: (engagement: Engagement, missingItems: { id: string; title: string }[]) => ({
    subject: `Reminder: Documents Still Needed - ${engagement.taxYear}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1f2937;">We're Still Missing Some Documents</h1>
        <p>Hi ${engagement.clientName},</p>
        <p>We haven't received the following items for your ${engagement.taxYear} tax return:</p>
        <ul style="background-color: #fef3c7; padding: 16px 32px; border-radius: 8px; border-left: 4px solid #f59e0b;">
          ${missingItems.map(item => `<li style="margin: 8px 0;">${item.title}</li>`).join('')}
        </ul>
        <p style="margin: 24px 0;">
          <a href="${engagement.sharepointFolderUrl}"
             style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            Upload Now
          </a>
        </p>
        <p style="color: #6b7280; font-size: 14px;">
          Need help finding these documents? Reply to this email and we'll assist you.
        </p>
      </div>
    `
  }),

  document_issue: (engagement: Engagement, issues: DocumentIssue[]) => ({
    subject: `Action Needed: Document Issues - ${engagement.taxYear}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #dc2626;">We Found Issues With Some Documents</h1>
        <p>Hi ${engagement.clientName},</p>
        <p>We've reviewed your uploaded documents and found the following issues:</p>
        <div style="background-color: #fef2f2; padding: 16px; border-radius: 8px; border-left: 4px solid #dc2626;">
          ${issues.map(issue => `
            <div style="margin: 12px 0;">
              <strong>${issue.fileName}:</strong> ${issue.problem}
            </div>
          `).join('')}
        </div>
        <p>Please upload corrected versions to continue processing your tax return.</p>
        <p style="margin: 24px 0;">
          <a href="${engagement.sharepointFolderUrl}"
             style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            Upload Corrected Documents
          </a>
        </p>
      </div>
    `
  }),

  complete: (engagement: Engagement) => ({
    subject: `Documents Received - ${engagement.taxYear} Taxes`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #059669;">All Documents Received!</h1>
        <p>Hi ${engagement.clientName},</p>
        <p>Great news! We have everything we need for your ${engagement.taxYear} tax return.</p>
        <div style="background-color: #d1fae5; padding: 16px; border-radius: 8px; border-left: 4px solid #059669;">
          <p style="margin: 0;"><strong>What happens next:</strong></p>
          <p style="margin: 8px 0 0 0;">Your accountant will review the documents and be in touch soon to discuss your return.</p>
        </div>
        <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
          Thank you for your prompt attention to this matter.
        </p>
      </div>
    `
  }),

  accountant_notification: (engagement: Engagement) => ({
    subject: `[Ready for Review] ${engagement.clientName} - ${engagement.taxYear}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1f2937;">Engagement Ready for Review</h1>
        <p><strong>Client:</strong> ${engagement.clientName}</p>
        <p><strong>Tax Year:</strong> ${engagement.taxYear}</p>
        <p><strong>Email:</strong> ${engagement.clientEmail}</p>
        <p>All required documents have been collected and a prep brief has been generated.</p>
        <p style="margin: 24px 0;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/engagements/${engagement.id}"
             style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            View Engagement
          </a>
        </p>
      </div>
    `
  })
}

export type EmailTemplate = ReturnType<typeof emailTemplates[keyof typeof emailTemplates]>

export async function sendEmail(
  to: string,
  template: EmailTemplate,
  options?: { retries?: number }
): Promise<{ id: string }> {
  const maxRetries = options?.retries ?? 3
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to,
      subject: template.subject,
      html: template.html
    })

    if (!error && data) {
      return { id: data.id }
    }

    lastError = new Error(error?.message ?? 'Unknown email error')

    // Don't retry validation errors
    if (error?.name === 'validation_error') {
      throw lastError
    }

    // Wait before retrying (exponential backoff)
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
    }
  }

  throw lastError ?? new Error('Failed to send email after retries')
}
