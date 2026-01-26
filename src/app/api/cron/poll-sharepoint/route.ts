import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/prisma'
import { syncFolder } from '@/lib/sharepoint'
import { dispatch } from '@/lib/agents/dispatcher'
import type { Document } from '@/types'

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

    if (newFiles.length === 0) {
      // Just update delta link if no new files
      await prisma.engagement.update({
        where: { id: engagement.id },
        data: { deltaLink: newDeltaLink }
      })
      return
    }

    // Add placeholder documents for new files
    for (const file of newFiles) {
      if (!file.id || !file.name) continue

      const newDoc: Document = {
        id: crypto.randomUUID(),
        fileName: file.name,
        sharepointItemId: file.id,
        documentType: 'PENDING',
        confidence: 0,
        taxYear: null,
        issues: [],
        classifiedAt: null,
      }

      existingDocs.push(newDoc)
    }

    // Update documents list and delta link
    await prisma.engagement.update({
      where: { id: engagement.id },
      data: {
        deltaLink: newDeltaLink,
        documents: existingDocs,
        status: 'COLLECTING'
      }
    })

    // Dispatch document_uploaded events for each new file
    // Assessment Agent will classify and chain to Reconciliation Agent
    for (const file of newFiles) {
      if (!file.id || !file.name) continue

      const doc = existingDocs.find(d => d.sharepointItemId === file.id)
      if (!doc) continue

      await dispatch({
        type: 'document_uploaded',
        engagementId: engagement.id,
        documentId: doc.id,
        sharepointItemId: file.id,
        fileName: file.name
      })
    }

    console.log(`[POLL] ${engagement.id}: Dispatched ${newFiles.length} documents to Assessment Agent`)
  } catch (error) {
    console.error(`[POLL] Error processing engagement ${engagement.id}:`, error)
  }
}
