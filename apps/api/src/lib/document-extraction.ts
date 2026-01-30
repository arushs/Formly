import { extractDocument as mistralOCR, type OCRResult } from './mistral-ocr.js'

// Custom error for unsupported file types
export class UnsupportedFileTypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedFileTypeError'
  }
}

export interface ExtractionResult {
  markdown: string
  tables: Array<{ id: string; content: string; format: string }>
  pages: Array<{ index: number; markdown: string }>
  confidence: number
  method: 'ocr' | 'text'
}

const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
])

export function isSupportedFileType(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimeType)
}

export async function extractDocument(
  presignedUrl: string,
  buffer: Buffer,
  mimeType: string
): Promise<ExtractionResult> {
  if (!isSupportedFileType(mimeType)) {
    throw new UnsupportedFileTypeError(
      `File type ${mimeType} is not supported. ` +
        `Supported types: PDF, JPG, PNG, HEIC, DOCX, XLSX`
    )
  }

  // Route by file type
  if (mimeType === 'application/pdf') {
    return extractPDF(presignedUrl)
  }

  if (mimeType.startsWith('image/')) {
    return extractImage(buffer, mimeType)
  }

  // Office documents - send as base64
  return extractOfficeDocument(buffer, mimeType)
}

async function extractPDF(presignedUrl: string): Promise<ExtractionResult> {
  const result = await mistralOCR({
    documentUrl: presignedUrl,
    tableFormat: 'html',
  })

  return normalizeOCRResult(result)
}

async function extractImage(buffer: Buffer, mimeType: string): Promise<ExtractionResult> {
  let imageBuffer = buffer
  let finalMimeType = mimeType

  // Convert HEIC to JPEG if needed
  // Note: Mistral OCR may support HEIC directly, so we try that first
  // If you need HEIC conversion, install sharp: npm install sharp
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    try {
      // Dynamic import of sharp for optional HEIC conversion
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sharp = (await import('sharp' as any)).default as {
        (input: Buffer): { jpeg(): { toBuffer(): Promise<Buffer> } }
      }
      imageBuffer = await sharp(buffer).jpeg().toBuffer()
      finalMimeType = 'image/jpeg'
    } catch {
      // sharp not available or conversion failed, try sending HEIC directly to Mistral
      console.warn('[EXTRACTION] HEIC conversion not available, trying direct OCR')
    }
  }

  const base64 = imageBuffer.toString('base64')
  const dataUri = `data:${finalMimeType};base64,${base64}`

  const result = await mistralOCR({
    documentUrl: dataUri,
  })

  return normalizeOCRResult(result)
}

async function extractOfficeDocument(buffer: Buffer, mimeType: string): Promise<ExtractionResult> {
  const base64 = buffer.toString('base64')
  const dataUri = `data:${mimeType};base64,${base64}`

  const result = await mistralOCR({
    documentUrl: dataUri,
  })

  return normalizeOCRResult(result)
}

function normalizeOCRResult(result: OCRResult): ExtractionResult {
  return {
    markdown: result.markdown,
    tables: result.tables.map((t) => ({
      id: t.id,
      content: t.content,
      format: t.format,
    })),
    pages: result.pages.map((p) => ({ index: p.index, markdown: p.markdown })),
    confidence: calculateConfidence(result),
    method: 'ocr',
  }
}

function calculateConfidence(result: OCRResult): number {
  // Heuristic: documents with more text and tables = higher confidence
  const totalChars = result.pages.reduce((sum, p) => sum + p.markdown.length, 0)
  const hasReasonableContent = totalChars > 100
  const hasStructure = result.pages.some((p) => (p.tables?.length || 0) > 0)

  if (hasReasonableContent && hasStructure) return 0.95
  if (hasReasonableContent) return 0.85
  return 0.6
}
