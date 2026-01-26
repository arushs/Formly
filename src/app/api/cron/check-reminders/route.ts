import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/prisma'
import { dispatch } from '@/lib/agents/dispatcher'

// Run daily at 9 AM UTC to send reminders for stale engagements
export async function GET(request: NextRequest) {
  // Verify cron secret
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find engagements that need reminders:
  // - Status is INTAKE_DONE or COLLECTING
  // - No activity in the last 3 days
  // - Haven't exceeded max reminders (5)
  const threeDaysAgo = new Date()
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

  const staleEngagements = await prisma.engagement.findMany({
    where: {
      status: { in: ['INTAKE_DONE', 'COLLECTING'] },
      lastActivityAt: { lt: threeDaysAgo },
      reminderCount: { lt: 5 }
    }
  })

  // Process each stale engagement in background
  for (const engagement of staleEngagements) {
    waitUntil(dispatch({
      type: 'stale_engagement',
      engagementId: engagement.id
    }))
  }

  console.log(`[REMINDERS] Dispatched reminders for ${staleEngagements.length} stale engagements`)

  return NextResponse.json({
    checked: staleEngagements.length,
    engagementIds: staleEngagements.map(e => e.id)
  })
}
