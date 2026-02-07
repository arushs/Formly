import { Hono } from 'hono'
import { prisma } from '../lib/prisma.js'

const app = new Hono()

// Test patterns for identifying test data
const TEST_PATTERNS = {
  emails: [
    /test@/i,
    /demo@/i,
    /example\.com$/i,
    /fake@/i,
    /sample@/i,
    /testing@/i,
    /placeholder/i,
    /asdf/i,
    /qwerty/i,
    /abc123/i,
    /@test\./i,
    /noreply/i,
    /nobody/i,
  ],
  names: [
    /^test\s*/i,
    /^demo\s*/i,
    /^sample\s*/i,
    /^fake\s*/i,
    /^placeholder/i,
    /^asdf/i,
    /^xxx/i,
    /^aaa/i,
    /john\s*doe/i,
    /jane\s*doe/i,
    /test\s*user/i,
    /test\s*client/i,
    /demo\s*client/i,
  ],
}

interface IdentifyResult {
  isTest: boolean
  reasons: string[]
}

function isTestEngagement(clientName: string, clientEmail: string): IdentifyResult {
  const reasons: string[] = []

  // Check email patterns
  for (const pattern of TEST_PATTERNS.emails) {
    if (pattern.test(clientEmail)) {
      reasons.push(`Email matches: ${pattern.source}`)
      break // One reason per category is enough
    }
  }

  // Check name patterns
  for (const pattern of TEST_PATTERNS.names) {
    if (pattern.test(clientName)) {
      reasons.push(`Name matches: ${pattern.source}`)
      break
    }
  }

  // Check for obviously fake/short names
  if (clientName.trim().length < 3) {
    reasons.push('Name too short')
  }

  // Check for repeated characters
  if (/(.)\1{3,}/.test(clientName)) {
    reasons.push('Repeated characters')
  }

  return {
    isTest: reasons.length > 0,
    reasons,
  }
}

// Middleware to verify admin secret
app.use('*', async (c, next) => {
  const adminSecret = process.env.ADMIN_SECRET || process.env.CRON_SECRET
  if (!adminSecret) {
    return c.json({ error: 'Admin routes not configured' }, 503)
  }

  const authHeader = c.req.header('Authorization')
  const providedSecret = authHeader?.replace('Bearer ', '')

  if (providedSecret !== adminSecret) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
})

// GET /api/admin/test-data - Preview test data without deleting
app.get('/test-data', async (c) => {
  const engagements = await prisma.engagement.findMany({
    select: {
      id: true,
      clientName: true,
      clientEmail: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const testEngagements: Array<{
    id: string
    clientName: string
    clientEmail: string
    status: string
    createdAt: Date
    reasons: string[]
  }> = []

  const realEngagements: typeof engagements = []

  for (const engagement of engagements) {
    const result = isTestEngagement(engagement.clientName, engagement.clientEmail)
    if (result.isTest) {
      testEngagements.push({
        ...engagement,
        reasons: result.reasons,
      })
    } else {
      realEngagements.push(engagement)
    }
  }

  return c.json({
    total: engagements.length,
    testCount: testEngagements.length,
    realCount: realEngagements.length,
    testEngagements,
    realEngagements,
  })
})

// DELETE /api/admin/test-data - Delete all identified test data
app.delete('/test-data', async (c) => {
  const engagements = await prisma.engagement.findMany({
    select: {
      id: true,
      clientName: true,
      clientEmail: true,
    },
  })

  const idsToDelete: string[] = []
  const deleted: Array<{ id: string; clientName: string; clientEmail: string }> = []

  for (const engagement of engagements) {
    const result = isTestEngagement(engagement.clientName, engagement.clientEmail)
    if (result.isTest) {
      idsToDelete.push(engagement.id)
      deleted.push({
        id: engagement.id,
        clientName: engagement.clientName,
        clientEmail: engagement.clientEmail,
      })
    }
  }

  if (idsToDelete.length === 0) {
    return c.json({
      message: 'No test engagements found',
      deletedCount: 0,
      deleted: [],
    })
  }

  await prisma.engagement.deleteMany({
    where: {
      id: { in: idsToDelete },
    },
  })

  return c.json({
    message: `Deleted ${idsToDelete.length} test engagements`,
    deletedCount: idsToDelete.length,
    deleted,
  })
})

// DELETE /api/admin/engagements/:id - Delete specific engagement (manual override)
app.delete('/engagements/:id', async (c) => {
  const id = c.req.param('id')

  const engagement = await prisma.engagement.findUnique({
    where: { id },
    select: { id: true, clientName: true, clientEmail: true },
  })

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404)
  }

  await prisma.engagement.delete({
    where: { id },
  })

  return c.json({
    message: 'Engagement deleted',
    deleted: engagement,
  })
})

export default app
