import { Mistral } from '@mistralai/mistralai'

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY })

interface OCRTable {
  id: string
  content: string
  format: 'markdown' | 'html'
}

export interface OCRResult {
  markdown: string
  pages: Array<{
    index: number
    markdown: string
    tables: OCRTable[]
  }>
  tables: OCRTable[]
}

export async function extractDocument(documentUrl: string): Promise<OCRResult> {
  try {
    const response = await mistral.ocr.process({
      model: 'mistral-ocr-latest',
      document: {
        type: 'document_url',
        documentUrl
      },
      includeImageBase64: false
    })

    const pages = (response.pages ?? []).map((page, index) => ({
      index,
      markdown: page.markdown ?? '',
      tables: (page.tables ?? []).map(t => ({
        id: t.id,
        content: t.content,
        format: t.format as 'markdown' | 'html'
      }))
    }))

    return {
      markdown: pages.map(p => p.markdown).join('\n\n'),
      pages,
      tables: pages.flatMap(p => p.tables)
    }
  } catch (error) {
    console.error('[OCR] Mistral OCR failed:', error)
    throw error
  }
}

export async function extractDocumentWithFallback(
  documentUrl: string,
  fallbackContent: string
): Promise<OCRResult> {
  try {
    return await extractDocument(documentUrl)
  } catch {
    // Fallback to basic content if OCR fails
    console.warn('[OCR] Falling back to basic text extraction')
    return {
      markdown: fallbackContent,
      pages: [{ index: 0, markdown: fallbackContent, tables: [] }],
      tables: []
    }
  }
}
