#!/usr/bin/env npx tsx

/**
 * Cleanup Test Data Script
 * 
 * Identifies and removes test/demo engagements from the database.
 * Run this before launch to ensure only real data remains.
 * 
 * Usage:
 *   # Dry run (preview what would be deleted)
 *   npx tsx scripts/cleanup-test-data.ts
 * 
 *   # Actually delete
 *   npx tsx scripts/cleanup-test-data.ts --confirm
 * 
 *   # Via Docker
 *   docker compose exec api npx tsx scripts/cleanup-test-data.ts --confirm
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Patterns that indicate test/demo data
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

interface EngagementData {
  id: string
  clientName: string
  clientEmail: string
  status: string
  createdAt: Date
}

function isTestEngagement(engagement: EngagementData): { isTest: boolean; reasons: string[] } {
  const reasons: string[] = []

  // Check email patterns
  for (const pattern of TEST_PATTERNS.emails) {
    if (pattern.test(engagement.clientEmail)) {
      reasons.push(`Email matches pattern: ${pattern}`)
    }
  }

  // Check name patterns
  for (const pattern of TEST_PATTERNS.names) {
    if (pattern.test(engagement.clientName)) {
      reasons.push(`Name matches pattern: ${pattern}`)
    }
  }

  // Check for obviously fake/short names (less than 3 chars)
  if (engagement.clientName.trim().length < 3) {
    reasons.push('Name is too short (< 3 chars)')
  }

  // Check for repeated characters (e.g., "aaaa", "xxxx")
  if (/(.)\1{3,}/.test(engagement.clientName)) {
    reasons.push('Name has repeated characters')
  }

  return {
    isTest: reasons.length > 0,
    reasons,
  }
}

async function main() {
  const dryRun = !process.argv.includes('--confirm')

  console.log('='.repeat(60))
  console.log('Formly Test Data Cleanup')
  console.log('='.repeat(60))
  console.log(`Mode: ${dryRun ? 'DRY RUN (preview only)' : '⚠️  LIVE DELETE'}`)
  console.log()

  // Fetch all engagements
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

  console.log(`Total engagements found: ${engagements.length}`)
  console.log()

  const testEngagements: { engagement: EngagementData; reasons: string[] }[] = []
  const realEngagements: EngagementData[] = []

  for (const engagement of engagements) {
    const result = isTestEngagement(engagement)
    if (result.isTest) {
      testEngagements.push({ engagement, reasons: result.reasons })
    } else {
      realEngagements.push(engagement)
    }
  }

  // Display test engagements
  if (testEngagements.length > 0) {
    console.log('🧪 TEST ENGAGEMENTS (will be deleted):')
    console.log('-'.repeat(60))
    for (const { engagement, reasons } of testEngagements) {
      console.log(`  ID: ${engagement.id}`)
      console.log(`  Name: ${engagement.clientName}`)
      console.log(`  Email: ${engagement.clientEmail}`)
      console.log(`  Status: ${engagement.status}`)
      console.log(`  Created: ${engagement.createdAt.toISOString()}`)
      console.log(`  Reasons: ${reasons.join(', ')}`)
      console.log()
    }
  } else {
    console.log('✅ No test engagements found!')
    console.log()
  }

  // Display real engagements (for verification)
  if (realEngagements.length > 0) {
    console.log('✅ REAL ENGAGEMENTS (will be KEPT):')
    console.log('-'.repeat(60))
    for (const engagement of realEngagements) {
      console.log(`  ID: ${engagement.id}`)
      console.log(`  Name: ${engagement.clientName}`)
      console.log(`  Email: ${engagement.clientEmail}`)
      console.log(`  Status: ${engagement.status}`)
      console.log()
    }
  }

  // Summary
  console.log('='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`Test engagements to delete: ${testEngagements.length}`)
  console.log(`Real engagements to keep: ${realEngagements.length}`)
  console.log()

  // Delete if confirmed
  if (!dryRun && testEngagements.length > 0) {
    console.log('🗑️  Deleting test engagements...')
    
    const idsToDelete = testEngagements.map(t => t.engagement.id)
    
    const result = await prisma.engagement.deleteMany({
      where: {
        id: { in: idsToDelete },
      },
    })

    console.log(`✅ Deleted ${result.count} test engagements`)
  } else if (dryRun && testEngagements.length > 0) {
    console.log('ℹ️  Run with --confirm to actually delete these engagements')
    console.log('   npx tsx scripts/cleanup-test-data.ts --confirm')
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('Error:', e)
  prisma.$disconnect()
  process.exit(1)
})
