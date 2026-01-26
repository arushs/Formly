import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { classifyDocument as classifyWithOpenAI } from '@/lib/openai'
import { extractDocumentWithFallback } from '@/lib/mistral-ocr'
import { downloadFile } from '@/lib/sharepoint'
import type { Document } from '@/types'

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
        sharepointItemId: z.string().describe('The SharePoint item ID'),
        fileName: z.string().describe('The file name')
      },
      async (args) => {
        const engagement = await prisma.engagement.findUnique({
          where: { id: args.engagementId }
        })

        if (!engagement || !engagement.sharepointDriveId) {
          return {
            content: [{ type: 'text', text: 'Error: Engagement not found or SharePoint not configured' }],
            isError: true
          }
        }

        try {
          // Download file content as fallback
          const fallbackContent = await downloadFile(engagement.sharepointDriveId, args.sharepointItemId)

          // Build the download URL for OCR
          const downloadUrl = `https://graph.microsoft.com/v1.0/drives/${engagement.sharepointDriveId}/items/${args.sharepointItemId}/content`

          // Try OCR extraction with fallback
          const ocrResult = await extractDocumentWithFallback(downloadUrl, fallbackContent)

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                documentId: args.documentId,
                fileName: args.fileName,
                extractedText: ocrResult.markdown.slice(0, 10000), // Limit for context
                tableCount: ocrResult.tables.length,
                pageCount: ocrResult.pages.length
              }, null, 2)
            }]
          }
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Error extracting document: ${error instanceof Error ? error.message : 'Unknown error'}` }],
            isError: true
          }
        }
      }
    ),

    tool(
      'classify_document',
      'Identify the document type (W-2, 1099, etc.)',
      {
        content: z.string().describe('The extracted text content'),
        fileName: z.string().describe('The file name')
      },
      async (args) => {
        try {
          const classification = await classifyWithOpenAI(args.content, args.fileName)

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
          return {
            content: [{ type: 'text', text: `Error classifying document: ${error instanceof Error ? error.message : 'Unknown error'}` }],
            isError: true
          }
        }
      }
    ),

    tool(
      'validate_document',
      'Check document for issues like wrong year, missing fields, etc.',
      {
        documentType: z.string().describe('The document type'),
        content: z.string().describe('The extracted text content'),
        expectedTaxYear: z.number().describe('The expected tax year'),
        detectedTaxYear: z.number().nullable().describe('The detected tax year from classification')
      },
      async (args) => {
        const issues: string[] = []

        // Check tax year
        if (args.detectedTaxYear && args.detectedTaxYear !== args.expectedTaxYear) {
          issues.push(`Wrong tax year: document is from ${args.detectedTaxYear}, expected ${args.expectedTaxYear}`)
        }

        // Check for common issues based on document type
        const contentLower = args.content.toLowerCase()

        if (args.documentType === 'W-2') {
          if (!contentLower.includes('wages') && !contentLower.includes('compensation')) {
            issues.push('W-2 appears to be missing wage information')
          }
          if (!contentLower.includes('social security') && !contentLower.includes('ssn') && !contentLower.includes('xxx-xx')) {
            issues.push('W-2 appears to be missing SSN')
          }
        }

        if (args.documentType.includes('1099')) {
          if (!contentLower.includes('payer') && !contentLower.includes('recipient')) {
            issues.push('1099 appears to be missing payer/recipient information')
          }
        }

        // Check if document is too short (might be incomplete)
        if (args.content.length < 200) {
          issues.push('Document appears to be incomplete or partially scanned')
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              isValid: issues.length === 0,
              issues
            }, null, 2)
          }]
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

        // Update the document
        documents[docIndex] = {
          ...documents[docIndex],
          documentType: args.documentType,
          confidence: args.confidence,
          taxYear: args.taxYear,
          issues: args.issues,
          classifiedAt: new Date().toISOString()
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
  sharepointItemId: string
  fileName: string
}): Promise<{ hasIssues: boolean; documentType: string }> {
  const engagement = await prisma.engagement.findUnique({
    where: { id: context.engagementId }
  })

  if (!engagement) {
    throw new Error(`Engagement ${context.engagementId} not found`)
  }

  const systemPrompt = `You are a Document Assessment Agent for a tax document collection system. Your role is to analyze uploaded documents, classify them, validate their content, and flag any issues.

Current trigger: ${context.trigger}
Engagement ID: ${context.engagementId}
Document ID: ${context.documentId}
File Name: ${context.fileName}
Expected Tax Year: ${engagement.taxYear}

Your workflow:
1. Extract the document content using OCR
2. Classify the document type (W-2, 1099-NEC, 1099-MISC, K-1, RECEIPT, STATEMENT, OTHER)
3. Validate the document (check tax year, completeness)
4. Extract key fields if applicable
5. Update the document record with your findings
6. Flag any issues found

Be thorough but efficient. If confidence is below 0.85, flag for manual review.`

  const prompt = `Process document "${context.fileName}" (ID: ${context.documentId}, SharePoint Item: ${context.sharepointItemId}). Extract, classify, validate, and update the document record.`

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
          'mcp__assessment__validate_document',
          'mcp__assessment__extract_fields',
          'mcp__assessment__cross_validate',
          'mcp__assessment__flag_issue',
          'mcp__assessment__update_document'
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
    throw error
  }
}
