import type { Context, Next } from 'hono'

/**
 * Middleware to verify CRON_SECRET for protected cron endpoints
 */
export async function verifyCronSecret(c: Context, next: Next) {
  const auth = c.req.header('authorization')

  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
}

/**
 * Middleware to verify API_SECRET for protected API endpoints
 * Expects: Authorization: Bearer <API_SECRET>
 * 
 * Set API_SECRET env var to enable authentication.
 * If API_SECRET is not set, all requests are rejected (fail-secure).
 */
export async function requireApiAuth(c: Context, next: Next) {
  const apiSecret = process.env.API_SECRET

  // Fail-secure: if no API_SECRET configured, reject all requests
  if (!apiSecret) {
    console.error('[AUTH] API_SECRET not configured - rejecting request')
    return c.json({ error: 'Server misconfigured: authentication not set up' }, 500)
  }

  const authHeader = c.req.header('authorization')

  if (!authHeader) {
    return c.json({ error: 'Unauthorized: Missing authorization header' }, 401)
  }

  // Support "Bearer <token>" format
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader

  if (token !== apiSecret) {
    return c.json({ error: 'Unauthorized: Invalid API key' }, 401)
  }

  await next()
}
