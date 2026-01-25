import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generatePrepBrief } from '@/lib/openai'
import type { ChecklistItem, Document, Reconciliation } from '@/types'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const engagement = await prisma.engagement.findUnique({ where: { id } })

  if (!engagement) {
    return NextResponse.json({ error: 'Engagement not found' }, { status: 404 })
  }

  if (engagement.status !== 'READY') {
    return NextResponse.json(
      { error: 'Engagement must be in READY status to generate brief' },
      { status: 400 }
    )
  }

  const checklist = (engagement.checklist as ChecklistItem[]) || []
  const documents = (engagement.documents as Document[]) || []
  const reconciliation = (engagement.reconciliation as Reconciliation) || {
    completionPercentage: 0,
    issues: [],
  }

  const brief = await generatePrepBrief({
    clientName: engagement.clientName,
    taxYear: engagement.taxYear,
    checklist,
    documents,
    reconciliation: {
      completionPercentage: reconciliation.completionPercentage,
      issues: reconciliation.issues,
    },
  })

  await prisma.engagement.update({
    where: { id },
    data: { prepBrief: brief },
  })

  return NextResponse.json({ success: true, brief })
}
