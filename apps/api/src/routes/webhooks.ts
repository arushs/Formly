import { Hono } from 'hono'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { generateChecklist } from '../lib/openai.js'
import { dispatch } from '../lib/agents/dispatcher.js'
import { runInBackground } from '../workers/background.js'

const app = new Hono()

// In-memory dedup for demo (resets on deploy)
const processedEvents = new Set<string>()

// POST /api/webhooks/typeform - Typeform webhook
app.post('/typeform', async (c) => {
  const rawBody = await c.req.text()
  const signature = c.req.header('typeform-signature')

  // Verify signature
  if (!verifySignature(rawBody, signature)) {
    return c.json({ error: 'Invalid signature' }, 401)
  }

  const payload = JSON.parse(rawBody)
  const eventId = payload.event_id

  // Simple dedup
  if (processedEvents.has(eventId)) {
    return c.json({ status: 'duplicate' })
  }
  processedEvents.add(eventId)

  const engagementId = payload.form_response?.hidden?.engagement_id
  if (!engagementId) {
    return c.json({ error: 'Missing engagement_id' }, 400)
  }

  // Process in background
  runInBackground(() => processIntake(engagementId, payload.form_response))

  return c.json({ status: 'processing' })
})

async function processIntake(engagementId: string, formResponse: unknown) {
  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId },
  })

  if (!engagement) {
    console.error(`Engagement not found: ${engagementId}`)
    return
  }

  // Generate checklist via LLM
  const checklist = await generateChecklist(formResponse, engagement.taxYear)

  await prisma.engagement.update({
    where: { id: engagementId },
    data: {
      status: 'INTAKE_DONE',
      intakeData: formResponse as object,
      checklist,
    },
  })

  console.log(`[INTAKE] Generated ${checklist.length} checklist items for ${engagementId}`)

  // Trigger Outreach Agent to send SharePoint instructions
  await dispatch({
    type: 'intake_complete',
    engagementId
  })
}

function verifySignature(payload: string, signature: string | null | undefined): boolean {
  if (!signature) return false
  const secret = process.env.TYPEFORM_WEBHOOK_SECRET
  if (!secret) return false

  const hash = crypto.createHmac('sha256', secret).update(payload).digest('base64')
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(`sha256=${hash}`)
    )
  } catch {
    return false
  }
}

export default app
