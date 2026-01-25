import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { generateChecklist } from '@/lib/openai'

// In-memory dedup for demo (resets on deploy)
const processedEvents = new Set<string>()

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('typeform-signature')

  // Verify signature
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const payload = JSON.parse(rawBody)
  const eventId = payload.event_id

  // Simple dedup
  if (processedEvents.has(eventId)) {
    return NextResponse.json({ status: 'duplicate' })
  }
  processedEvents.add(eventId)

  const engagementId = payload.form_response?.hidden?.engagement_id
  if (!engagementId) {
    return NextResponse.json({ error: 'Missing engagement_id' }, { status: 400 })
  }

  // Process in background
  waitUntil(processIntake(engagementId, payload.form_response))

  return NextResponse.json({ status: 'processing' })
}

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
}

function verifySignature(payload: string, signature: string | null): boolean {
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
