import { beforeAll, afterAll, afterEach, vi } from 'vitest'

// Mock environment variables for testing
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.OPENAI_API_KEY = 'test-openai-key'
process.env.MISTRAL_API_KEY = 'test-mistral-key'
process.env.RESEND_API_KEY = 'test-resend-key'
process.env.EMAIL_FROM = 'test@example.com'
process.env.ACCOUNTANT_EMAIL = 'accountant@example.com'
process.env.TYPEFORM_FORM_ID = 'test-form-id'
process.env.TYPEFORM_WEBHOOK_SECRET = 'test-webhook-secret'
process.env.CRON_SECRET = 'test-cron-secret'
process.env.DROPBOX_ACCESS_TOKEN = 'test-dropbox-token'
process.env.DROPBOX_APP_KEY = 'test-dropbox-app-key'
process.env.DROPBOX_APP_SECRET = 'test-dropbox-app-secret'

// Reset all mocks after each test
afterEach(() => {
  vi.clearAllMocks()
})

// Cleanup after all tests
afterAll(() => {
  vi.restoreAllMocks()
})
