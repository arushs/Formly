import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

import engagements from './routes/engagements.js'
import webhooks from './routes/webhooks.js'
import cron from './routes/cron.js'
import { initScheduler } from './scheduler.js'

const app = new Hono()

// Middleware
app.use('*', logger())
app.use('*', cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// Mount routes
app.route('/api/engagements', engagements)
app.route('/api/webhooks', webhooks)
app.route('/api/cron', cron)

// Start server
const port = parseInt(process.env.PORT || '3001', 10)

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
