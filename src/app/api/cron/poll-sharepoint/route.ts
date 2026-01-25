import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/prisma'
import { syncFolder, downloadFile } from '@/lib/sharepoint'
import { classifyDocument, reconcile } from '@/lib/openai'
import type { ChecklistItem, Document } from '@/types'

export async function GET(request: NextRequest) {
  // Verify cron secret
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const engagements = await prisma.engagement.findMany({
    where: { status: { in: ['INTAKE_DONE', 'COLLECTING'] } },
  })

  // Process all in background
  waitUntil(Promise.all(engagements.map(pollEngagement)))

  return NextResponse.json({ queued: engagements.length })
}

async function pollEngagement(engagement: {
  id: string
  sharepointDriveId: string | null
  sharepointFolderId: string | null
  deltaLink: string | null
  checklist: unknown
  documents: unknown
}) {
  if (!engagement.sharepointDriveId || !engagement.sharepointFolderId) return

  try {
    const { items, newDeltaLink } = await syncFolder(
      engagement.sharepointDriveId,
      engagement.sharepointFolderId,
      engagement.deltaLink
    )

    const existingDocs = (engagement.documents as Document[]) || []
    const existingIds = new Set(existingDocs.map(d => d.sharepointItemId))

    // Process new files
    const newFiles = items.filter(item => item.file && !item.deleted && item.id && !existingIds.has(item.id))

    for (const file of newFiles) {
      if (!file.id || !file.name) continue

      const content = await downloadFile(engagement.sharepointDriveId!, file.id)
      const classification = await classifyDocument(content, file.name)

      const newDoc: Document = {
        id: crypto.randomUUID(),
        fileName: file.name,
        sharepointItemId: file.id,
        documentType: classification.documentType,
        confidence: classification.confidence,
        taxYear: classification.taxYear,
        issues: classification.issues,
        classifiedAt: new Date().toISOString(),
      }

      existingDocs.push(newDoc)
    }

    // Run reconciliation
    const checklist = (engagement.checklist as ChecklistItem[]) || []
    const reconciliation = await reconcile(checklist, existingDocs)

    const newStatus = reconciliation.completionPercentage === 100 ? 'READY' : 'COLLECTING'

    await prisma.engagement.update({
      where: { id: engagement.id },
      data: {
        deltaLink: newDeltaLink,
        documents: existingDocs,
        reconciliation: {
          ...reconciliation,
          ranAt: new Date().toISOString(),
        },
        status: newStatus,
      },
    })

    console.log(`[POLL] ${engagement.id}: ${newFiles.length} new docs, ${reconciliation.completionPercentage}% complete`)
  } catch (error) {
    console.error(`[POLL] Error processing engagement ${engagement.id}:`, error)
  }
}
