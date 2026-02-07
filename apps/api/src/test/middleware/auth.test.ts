import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { requireApiAuth } from '../../middleware/auth.js'

describe('requireApiAuth middleware', () => {
  let app: Hono
  const originalEnv = process.env.API_SECRET

  beforeEach(() => {
    app = new Hono()
    app.use('/api/*', requireApiAuth)
    app.get('/api/test', (c) => c.json({ message: 'success' }))
    app.get('/health', (c) => c.json({ status: 'ok' }))
  })

  afterEach(() => {
    process.env.API_SECRET = originalEnv
  })

  it('returns 500 if API_SECRET is not configured', async () => {
    delete process.env.API_SECRET

    const res = await app.request('/api/test')
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('authentication not set up')
  })

  it('returns 401 if no authorization header provided', async () => {
    process.env.API_SECRET = 'test-secret'

    const res = await app.request('/api/test')
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toContain('Missing authorization header')
  })

  it('returns 401 if wrong API key provided', async () => {
    process.env.API_SECRET = 'test-secret'

    const res = await app.request('/api/test', {
      headers: { Authorization: 'Bearer wrong-key' }
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toContain('Invalid API key')
  })

  it('allows request with valid Bearer token', async () => {
    process.env.API_SECRET = 'test-secret'

    const res = await app.request('/api/test', {
      headers: { Authorization: 'Bearer test-secret' }
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('success')
  })

  it('allows request with raw token (no Bearer prefix)', async () => {
    process.env.API_SECRET = 'test-secret'

    const res = await app.request('/api/test', {
      headers: { Authorization: 'test-secret' }
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('success')
  })

  it('does not affect non-protected routes', async () => {
    process.env.API_SECRET = 'test-secret'

    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })
})
