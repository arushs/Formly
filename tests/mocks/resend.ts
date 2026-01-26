import { vi } from 'vitest'

/**
 * Mock Resend client
 */
export const mockResend = {
  emails: {
    send: vi.fn().mockResolvedValue({ id: 'email-123' }),
  },
}

/**
 * Helper to mock successful email send
 */
export function mockEmailSendSuccess(emailId = 'email-123'): void {
  mockResend.emails.send.mockResolvedValue({ id: emailId })
}

/**
 * Helper to mock email send failure
 */
export function mockEmailSendFailure(message: string): void {
  mockResend.emails.send.mockRejectedValue(new Error(message))
}

/**
 * Factory for vi.mock
 */
export function createResendMock() {
  return {
    Resend: vi.fn(() => mockResend),
  }
}
