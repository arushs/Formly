import { vi } from 'vitest'

/**
 * Mock Mistral OCR response
 */
export interface MockOcrResult {
  markdown: string
  tables: Array<{ rows: string[][] }>
  pages: Array<{ pageNumber: number }>
}

/**
 * Mock Mistral client
 */
export const mockMistral = {
  ocr: {
    process: vi.fn(),
  },
}

/**
 * Helper to mock successful OCR extraction
 */
export function mockOcrSuccess(result: Partial<MockOcrResult> = {}): void {
  const defaultResult: MockOcrResult = {
    markdown: 'Extracted document text',
    tables: [],
    pages: [{ pageNumber: 1 }],
    ...result,
  }
  mockMistral.ocr.process.mockResolvedValue(defaultResult)
}

/**
 * Helper to mock OCR failure
 */
export function mockOcrFailure(message: string): void {
  mockMistral.ocr.process.mockRejectedValue(new Error(message))
}

/**
 * Factory for vi.mock
 */
export function createMistralMock() {
  return {
    Mistral: vi.fn(() => mockMistral),
  }
}

/**
 * Mock for extractDocumentWithFallback function
 */
export const mockExtractDocumentWithFallback = vi.fn()

export function mockExtractSuccess(markdown: string, tables: unknown[] = [], pages: unknown[] = []): void {
  mockExtractDocumentWithFallback.mockResolvedValue({
    markdown,
    tables,
    pages,
  })
}

export function mockExtractFailure(message: string): void {
  mockExtractDocumentWithFallback.mockRejectedValue(new Error(message))
}
