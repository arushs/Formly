import { Mistral } from '@mistralai/mistralai'

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY })

// Retry configuration
interface RetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxRetries = 3, initialDelayMs = 1000, maxDelayMs = 10000 } = options

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const statusCode = (error as { status?: number; statusCode?: number }).status ||
        (error as { status?: number; statusCode?: number }).statusCode

      // Don't retry client errors (except rate limits)
      if (statusCode && statusCode < 500 && statusCode !== 429) {
        throw error
      }

      if (attempt < maxRetries) {
        const delay = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
        const jitter = Math.random() * 500
        console.log(`[OCR] Attempt ${attempt} failed, retrying in ${Math.round(delay + jitter)}ms...`)
        await sleep(delay + jitter)
      }
    }
  }

  throw lastError
}

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

export interface OCROptions {
  documentUrl: string
  tableFormat?: 'markdown' | 'html'
}

export async function extractDocument(options: OCROptions): Promise<OCRResult> {
  const { documentUrl, tableFormat = 'html' } = typeof options === 'string'
    ? { documentUrl: options }
    : options

  // Check if API key is configured
  if (!process.env.MISTRAL_API_KEY) {
    console.error('[OCR] MISTRAL_API_KEY is not set!')
    throw new Error('MISTRAL_API_KEY environment variable is not configured')
  }

  console.log(`[OCR] Starting extraction (${documentUrl.slice(0, 50)}...)`)

  return withRetry(async () => {
    const response = await mistral.ocr.process({
      model: 'mistral-ocr-latest',
      document: {
        type: 'document_url',
        documentUrl,
      },
      includeImageBase64: false,
      tableFormat,
    })

    const pages = (response.pages ?? []).map((page, index) => ({
      index,
      markdown: page.markdown ?? '',
      tables: (page.tables ?? []).map((t) => ({
        id: t.id,
        content: t.content,
        format: t.format as 'markdown' | 'html',
      })),
    }))

    return {
      markdown: pages.map((p) => p.markdown).join('\n\n'),
      pages,
      tables: pages.flatMap((p) => p.tables),
    }
  })
}

export async function extractDocumentWithFallback(
  documentUrl: string,
  fallbackContent: string
): Promise<OCRResult> {
  try {
    return await extractDocument({ documentUrl })
  } catch {
    // Fallback to basic content if OCR fails
    console.warn('[OCR] Falling back to basic text extraction')
    return {
      markdown: fallbackContent,
      pages: [{ index: 0, markdown: fallbackContent, tables: [] }],
      tables: [],
    }
  }
}
