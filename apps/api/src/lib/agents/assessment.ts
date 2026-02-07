import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { classifyDocument as classifyWithOpenAI, generateFriendlyIssues } from '../openai.js'
import { getStorageClient, type StorageProvider } from '../storage/index.js'
import { extractDocument, isSupportedFileType } from '../document-extraction.js'
import { parseIssue } from '../issues.js'
import type { Document, FriendlyIssue } from '../../types.js'

// Define the Assessment Agent's MCP server with tools
export const assessmentServer = createSdkMcpServer({
  name: 'assessment',
  version: '1.0.0',
  tools: [
    tool(
      'extract_document',
      'Extract text and structure from a document using Mistral OCR',
      {
        engagementId: z.string().describe('The engagement ID'),
        documentId: z.string().describe('The document ID'),
        storageItemId: z.string().describe('The storage item ID'),
        fileName: z.string().describe('The file name')
      },
      async (args) => {
        const engagement = await prisma.engagement.findUnique({
          where: { id: args.engagementId }
        })

        if (!engagement) {
          return {
            content: [{ type: 'text', text: 'Error: Engagement not found' }],
            isError: true
          }
        }

        // Get storage provider and required IDs
        const provider = (engagement.storageProvider || 'dropbox') as StorageProvider
        const folderId = engagement.storageFolderId
        const driveId = engagement.storageDriveId
        const folderUrl = engagement.storageFolderUrl as string | null

        // For Dropbox shared folders, we can access files using the URL even without folderId
        if (provider !== 'dropbox' && !folderId) {
          return {
            content: [{ type: 'text', text: 'Error: Storage folder not configured' }],
            isError: true
          }
        }
        if (provider === 'dropbox' && !folderId && !folderUrl) {
          return {
            content: [{ type: 'text', text: 'Error: Dropbox folder URL or ID not configured' }],
            isError: true
          }
        }

        try {
          // Download file using the appropriate storage client
          const client = getStorageClient(provider)
          const { buffer, mimeType, fileName, size } = await client.downloadFile(
            args.storageItemId,
            { driveId: driveId || undefined, sharedLinkUrl: folderUrl || undefined, fileName: args.fileName }
          )

          console.log(`[ASSESSMENT] Downloaded ${fileName} (${size} bytes, ${mimeType})`)

          // Check if file type is supported
          if (!isSupportedFileType(mimeType)) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Unsupported file type: ${mimeType}. Supported: PDF, JPG, PNG, HEIC, DOCX, XLSX`,
                },
              ],
              isError: true,
            }
          }

          // Extract document using the new pipeline
          // Note: For SharePoint, we need to pass a URL; for now we use buffer-based extraction
          const base64 = buffer.toString('base64')
          const dataUri = `data:${mimeType};base64,${base64}`
          const result = await extractDocument(dataUri, buffer, mimeType)

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    documentId: args.documentId,
                    fileName,
                    fileSize: size,
                    extractedText: result.markdown.slice(0, 10000), // Limit for context
                    tableCount: result.tables.length,
                    pageCount: result.pages.length,
                    confidence: result.confidence,
                  },
                  null,
                  2
                ),
              },
            ],
          }
        } catch (error) {
          // Log the full error for debugging
          console.error(`[ASSESSMENT] extract_document failed for ${args.fileName}:`, error)
          return {
            content: [
              {
                type: 'text',
                text: `Error extracting document: ${error instanceof Error ? error.message : 'Unknown error'}`,
              },
            ],
            isError: true,
          }
        }
      }
    ),

    tool(
      'classify_document',
      'Classify and validate the document - identifies type, checks for issues like wrong year, missing fields, quality problems',
      {
        engagementId: z.string().describe('The engagement ID (to get expected tax year)'),
        content: z.string().describe('The extracted text content'),
        fileName: z.string().describe('The file name')
      },
      async (args) => {
        try {
          // Get expected tax year from engagement
          const engagement = await prisma.engagement.findUnique({
            where: { id: args.engagementId }
          })
          const expectedTaxYear = engagement?.taxYear

          const classification = await classifyWithOpenAI(args.content, args.fileName, expectedTaxYear)

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                documentType: classification.documentType,
                confidence: classification.confidence,
                taxYear: classification.taxYear,
                issues: classification.issues
              }, null, 2)
            }]
          }
        } catch (error) {
          // Log the full error for debugging
          console.error(`[ASSESSMENT] classify_document failed for ${args.fileName}:`, error)
          return {
            content: [{ type: 'text', text: `Error classifying document: ${error instanceof Error ? error.message : 'Unknown error'}` }],
            isError: true
          }
        }
      }
    ),

    tool(
      'extract_fields',
      'Pull specific tax values from the document based on its type',
      {
        documentType: z.string().describe('The document type'),
        content: z.string().describe('The extracted text content')
      },
      async (args) => {
        // Use pattern matching to extract common fields
        const fields: Record<string, string | number | null> = {}

        // Extract amounts (look for dollar signs and numbers)
        const amountMatches = args.content.match(/\$[\d,]+\.?\d*/g)
        if (amountMatches && amountMatches.length > 0) {
          fields.primaryAmount = amountMatches[0]
        }

        // Extract year
        const yearMatch = args.content.match(/20[12]\d/g)
        if (yearMatch) {
          fields.detectedYear = parseInt(yearMatch[0])
        }

        // Extract EIN pattern
        const einMatch = args.content.match(/\d{2}-\d{7}/g)
        if (einMatch) {
          fields.ein = einMatch[0]
        }

        // Document-specific extraction
        if (args.documentType === 'W-2') {
          // Look for box 1 wages
          const wagesMatch = args.content.match(/box\s*1[:\s]+\$?([\d,]+\.?\d*)/i)
          if (wagesMatch) {
            fields.wages = wagesMatch[1]
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              documentType: args.documentType,
              extractedFields: fields,
              fieldCount: Object.keys(fields).length
            }, null, 2)
          }]
        }
      }
    ),

    tool(
      'cross_validate',
      'Compare extracted values across all documents in the engagement',
      {
        engagementId: z.string().describe('The engagement ID')
      },
      async (args) => {
        const engagement = await prisma.engagement.findUnique({
          where: { id: args.engagementId }
        })

        if (!engagement) {
          return {
            content: [{ type: 'text', text: 'Error: Engagement not found' }],
            isError: true
          }
        }

        const documents = (engagement.documents as Document[] | null) ?? []
        const issues: string[] = []

        // Check for duplicate document types
        const typeCount = new Map<string, number>()
        for (const doc of documents) {
          const count = typeCount.get(doc.documentType) ?? 0
          typeCount.set(doc.documentType, count + 1)
        }

        for (const [type, count] of typeCount) {
          if (count > 1 && !['1099-NEC', '1099-MISC', 'RECEIPT'].includes(type)) {
            issues.push(`Multiple ${type} documents found (${count}). Please verify this is intentional.`)
          }
        }

        // Check for tax year consistency
        const taxYears = new Set(documents.map(d => d.taxYear).filter(y => y !== null))
        if (taxYears.size > 1) {
          issues.push(`Documents have different tax years: ${[...taxYears].join(', ')}`)
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              documentCount: documents.length,
              documentTypes: [...typeCount.entries()].map(([type, count]) => ({ type, count })),
              crossValidationIssues: issues,
              isConsistent: issues.length === 0
            }, null, 2)
          }]
        }
      }
    ),

    tool(
      'flag_issue',
      'Mark a document as having problems that need attention',
      {
        engagementId: z.string().describe('The engagement ID'),
        documentId: z.string().describe('The document ID'),
        issueType: z.enum(['wrong_year', 'illegible', 'incomplete', 'duplicate', 'other']).describe('The type of issue'),
        description: z.string().describe('Description of the issue')
      },
      async (args) => {
        const engagement = await prisma.engagement.findUnique({
          where: { id: args.engagementId }
        })

        if (!engagement) {
          return {
            content: [{ type: 'text', text: 'Error: Engagement not found' }],
            isError: true
          }
        }

        const documents = (engagement.documents as Document[] | null) ?? []
        const docIndex = documents.findIndex(d => d.id === args.documentId)

        if (docIndex === -1) {
          return {
            content: [{ type: 'text', text: `Error: Document ${args.documentId} not found` }],
            isError: true
          }
        }

        // Add issue to the document
        const issueText = `[${args.issueType}] ${args.description}`
        if (!documents[docIndex].issues.includes(issueText)) {
          documents[docIndex].issues.push(issueText)
        }

        await prisma.engagement.update({
          where: { id: args.engagementId },
          data: { documents }
        })

        return {
          content: [{
            type: 'text',
            text: `Issue flagged on document ${args.documentId}: ${issueText}`
          }]
        }
      }
    ),

    tool(
      'update_document',
      'Update a document record with classification and validation results',
      {
        engagementId: z.string().describe('The engagement ID'),
        documentId: z.string().describe('The document ID'),
        documentType: z.string().describe('The classified document type'),
        confidence: z.number().describe('Classification confidence'),
        taxYear: z.number().nullable().describe('Detected tax year'),
        issues: z.array(z.string()).describe('Any issues found')
      },
      async (args) => {
        const engagement = await prisma.engagement.findUnique({
          where: { id: args.engagementId }
        })

        if (!engagement) {
          return {
            content: [{ type: 'text', text: 'Error: Engagement not found' }],
            isError: true
          }
        }

        const documents = (engagement.documents as Document[] | null) ?? []
        const docIndex = documents.findIndex(d => d.id === args.documentId)

        if (docIndex === -1) {
          return {
            content: [{ type: 'text', text: `Error: Document ${args.documentId} not found` }],
            isError: true
          }
        }

        // Generate issue details if there are any issues
        let issueDetails: FriendlyIssue[] | null = null
        if (args.issues.length > 0) {
          try {
            const parsedIssues = args.issues.map(issueStr => {
              const parsed = parseIssue(issueStr)
              return {
                severity: parsed.severity,
                type: parsed.type,
                description: parsed.description
              }
            })

            issueDetails = await generateFriendlyIssues(
              documents[docIndex].fileName,
              args.documentType,
              engagement.taxYear,
              parsedIssues
            )
            console.log(`[ASSESSMENT] Generated ${issueDetails.length} issue details for ${args.documentId}`)
          } catch (error) {
            console.error('[ASSESSMENT] Failed to generate issue details:', error)
            // Continue without issue details - they can be generated on-demand
          }
        }

        // Update the document - mark as classified
        documents[docIndex] = {
          ...documents[docIndex],
          documentType: args.documentType,
          confidence: args.confidence,
          taxYear: args.taxYear,
          issues: args.issues,
          issueDetails,
          classifiedAt: new Date().toISOString(),
          processingStatus: 'classified',
          processingStartedAt: null // Clear the timestamp
        }

        await prisma.engagement.update({
          where: { id: args.engagementId },
          data: { documents }
        })

        return {
          content: [{
            type: 'text',
            text: `Document ${args.documentId} updated: ${args.documentType} (${Math.round(args.confidence * 100)}% confidence)`
          }]
        }
      }
    )
  ]
})

// Agent trigger types
export type AssessmentTrigger = 'document_uploaded' | 'reupload_after_issue'


// Run the Assessment Agent
export async function runAssessmentAgent(context: {
  trigger: AssessmentTrigger
  engagementId: string
  documentId: string
  storageItemId: string
  fileName: string
}): Promise<{ hasIssues: boolean; documentType: string }> {
  const engagement = await prisma.engagement.findUnique({
    where: { id: context.engagementId }
  })

  if (!engagement) {
    throw new Error(`Engagement ${context.engagementId} not found`)
  }

  // Mark document as in_progress with timestamp
  const documents = (engagement.documents as Document[] | null) ?? []
  const docIndex = documents.findIndex(d => d.id === context.documentId)
  if (docIndex !== -1) {
    documents[docIndex].processingStatus = 'in_progress'
    documents[docIndex].processingStartedAt = new Date().toISOString()
    await prisma.engagement.update({
      where: { id: context.engagementId },
      data: { documents }
    })
  }

  const systemPrompt = `You are a Document Assessment Agent for a tax document collection system. Your role is to analyze uploaded documents and classify them.

Current trigger: ${context.trigger}
Engagement ID: ${context.engagementId}
Document ID: ${context.documentId}
File Name: ${context.fileName}
Expected Tax Year: ${engagement.taxYear}

Your workflow:
1. Extract the document content using OCR (extract_document)
2. Classify the document (classify_document) - this also validates and detects issues
3. Update the document record with the classification results (update_document)

The classify_document tool handles all validation including:
- Document type detection (W-2, 1099-NEC, 1099-MISC, K-1, RECEIPT, STATEMENT, OTHER)
- Tax year validation against expected year
- Missing field detection
- Quality issues (illegible, incomplete, etc.)

Be efficient - extract, classify, update. Don't use flag_issue separately unless you find additional issues not caught by classification.`

  const prompt = `Process document "${context.fileName}" (ID: ${context.documentId}, Storage Item: ${context.storageItemId}). Extract, classify, and update the document record.`

  let documentType = 'UNKNOWN'
  let hasIssues = false

  try {
    const response = query({
      prompt,
      options: {
        model: 'claude-sonnet-4-5',
        systemPrompt,
        mcpServers: {
          assessment: assessmentServer
        },
        allowedTools: [
          'mcp__assessment__extract_document',
          'mcp__assessment__classify_document',
          'mcp__assessment__update_document',
          'mcp__assessment__flag_issue'
        ]
      }
    })

    // Consume the async generator
    for await (const _ of response) {
      // Agent executes tools autonomously
    }

    // Fetch updated document to get classification results
    const updatedEngagement = await prisma.engagement.findUnique({
      where: { id: context.engagementId }
    })

    if (updatedEngagement) {
      const documents = (updatedEngagement.documents as Document[] | null) ?? []
      const doc = documents.find(d => d.id === context.documentId)
      if (doc) {
        documentType = doc.documentType
        hasIssues = doc.issues.length > 0
      }
    }

    // Log agent activity
    const existingLog = (engagement.agentLog as object[] | null) ?? []
    const newEntry = {
      timestamp: new Date().toISOString(),
      agent: 'assessment',
      trigger: context.trigger,
      documentId: context.documentId,
      outcome: hasIssues ? 'issues_found' : 'success'
    }

    await prisma.engagement.update({
      where: { id: context.engagementId },
      data: {
        agentLog: [...existingLog, newEntry] as object[],
        lastActivityAt: new Date()
      }
    })

    console.log(`[ASSESSMENT] Completed ${context.trigger} for ${context.documentId}. Type: ${documentType}, Issues: ${hasIssues}`)

    return { hasIssues, documentType }
  } catch (error) {
    console.error(`[ASSESSMENT] Error processing document ${context.documentId}:`, error)

    // Mark document as error state so it doesn't get stuck
    try {
      const currentEngagement = await prisma.engagement.findUnique({
        where: { id: context.engagementId }
      })
      if (currentEngagement) {
        const documents = (currentEngagement.documents as Document[] | null) ?? []
        const docIndex = documents.findIndex(d => d.id === context.documentId)
        if (docIndex !== -1) {
          documents[docIndex].processingStatus = 'error'
          documents[docIndex].processingStartedAt = null
          await prisma.engagement.update({
            where: { id: context.engagementId },
            data: { documents }
          })
          console.log(`[ASSESSMENT] Marked document ${context.documentId} as error`)
        }
      }
    } catch (updateError) {
      console.error(`[ASSESSMENT] Failed to update document status to error:`, updateError)
    }

    throw error
  }
}
