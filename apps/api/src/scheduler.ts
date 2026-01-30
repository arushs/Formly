import cron from 'node-cron'

/**
 * Initialize scheduled tasks for the API server.
 * Uses node-cron for in-process scheduling (Railway containers persist).
 */
export function initScheduler() {
  const cronSecret = process.env.CRON_SECRET
  const apiUrl = process.env.API_URL || 'http://localhost:3001'

  if (!cronSecret) {
    console.warn('[SCHEDULER] CRON_SECRET not set, scheduled tasks will fail auth')
  }

  // Poll storage for new documents every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    console.log('[SCHEDULER] Running poll-storage job')
    try {
      const response = await fetch(`${apiUrl}/api/cron/poll-storage`, {
        headers: { Authorization: `Bearer ${cronSecret}` }
      })
      const result = await response.json()
      console.log('[SCHEDULER] poll-storage result:', result)
    } catch (error) {
      console.error('[SCHEDULER] poll-storage error:', error)
    }
  })

  // Check for stale engagements daily at 9 AM UTC
  cron.schedule('0 9 * * *', async () => {
    console.log('[SCHEDULER] Running check-reminders job')
    try {
      const response = await fetch(`${apiUrl}/api/cron/check-reminders`, {
        headers: { Authorization: `Bearer ${cronSecret}` }
      })
      const result = await response.json()
      console.log('[SCHEDULER] check-reminders result:', result)
    } catch (error) {
      console.error('[SCHEDULER] check-reminders error:', error)
    }
  })

  console.log('[SCHEDULER] Cron jobs initialized:')
  console.log('  - poll-storage: every 5 minutes')
  console.log('  - check-reminders: daily at 9 AM UTC')
}
