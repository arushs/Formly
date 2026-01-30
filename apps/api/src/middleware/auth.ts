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
