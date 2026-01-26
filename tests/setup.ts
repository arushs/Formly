import { vi } from 'vitest'

// Stub environment variables for tests
vi.stubEnv('OPENAI_API_KEY', 'test-openai-key')
vi.stubEnv('AZURE_TENANT_ID', 'test-tenant-id')
vi.stubEnv('AZURE_CLIENT_ID', 'test-client-id')
vi.stubEnv('AZURE_CLIENT_SECRET', 'test-client-secret')
vi.stubEnv('TYPEFORM_WEBHOOK_SECRET', 'test-typeform-secret')
vi.stubEnv('CRON_SECRET', 'test-cron-secret')
vi.stubEnv('RESEND_API_KEY', 'test-resend-key')
vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test')
