import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

import engagements from './routes/engagements.js'
import documents from './routes/documents.js'
import webhooks from './routes/webhooks.js'
import cron from './routes/cron.js'
import oauth from './routes/oauth.js'
import { requireApiAuth } from './middleware/auth.js'
import { initScheduler } from './scheduler.js'

const app = new Hono()

// Middleware
app.use('*', logger())
app.use('*', cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3010',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Health check (public - no auth required)
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// Protected routes - require API authentication
// app.use('/api/engagements/*', requireApiAuth) // Disabled for demo

// Mount routes
app.route('/api/engagements', engagements)
app.route('/api/engagements', documents) // Document-specific actions
app.route('/api/webhooks', webhooks)
app.route('/api/cron', cron)
app.route('/api/oauth', oauth)

// Start server
const port = parseInt(process.env.PORT || '3009', 10)

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`🚀 Tax Agent API running on http://localhost:${info.port}`)

  // Initialize scheduler after server starts
  if (process.env.ENABLE_SCHEDULER !== 'false') {
    initScheduler()
  }
})
