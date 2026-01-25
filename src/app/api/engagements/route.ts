import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { resolveSharePointUrl } from '@/lib/sharepoint'

const CreateEngagementSchema = z.object({
  clientName: z.string().min(1),
  clientEmail: z.string().email(),
  taxYear: z.number().int().min(2020).max(2030),
  sharepointFolderUrl: z.string().url(),
  typeformFormId: z.string().min(1),
})

export async function GET() {
  const engagements = await prisma.engagement.findMany({
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(engagements)
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  const parsed = CreateEngagementSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  // Try to resolve SharePoint URL to driveId and folderId
  let sharepointDriveId: string | null = null
  let sharepointFolderId: string | null = null

  try {
    const resolved = await resolveSharePointUrl(parsed.data.sharepointFolderUrl)
    if (resolved) {
      sharepointDriveId = resolved.driveId
      sharepointFolderId = resolved.folderId
    }
  } catch (error) {
    console.warn('Could not resolve SharePoint URL:', error)
    // Continue without resolved IDs - they can be set later
  }

  const engagement = await prisma.engagement.create({
    data: {
      ...parsed.data,
      sharepointDriveId,
      sharepointFolderId,
    },
  })

  return NextResponse.json(engagement, { status: 201 })
}
