import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isSupportedFileType, UnsupportedFileTypeError } from '../document-extraction.js'

// Mock the external dependencies
vi.mock('../mistral-ocr.js', () => ({
  extractDocument: vi.fn(async () => ({
    markdown: '# Test Document\nContent here',
    tables: [],
    pages: [{ index: 0, markdown: '# Test Document\nContent here' }],
  })),
}))

vi.mock('openai', () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: 'Extracted text from image' } }],
        })),
      },
    },
  })),
}))

describe('isSupportedFileType', () => {
  describe('supported types', () => {
    it('supports PDF files', () => {
      expect(isSupportedFileType('application/pdf')).toBe(true)
    })

    it('supports JPEG images', () => {
      expect(isSupportedFileType('image/jpeg')).toBe(true)
    })

    it('supports PNG images', () => {
      expect(isSupportedFileType('image/png')).toBe(true)
    })

    it('supports HEIC images', () => {
      expect(isSupportedFileType('image/heic')).toBe(true)
    })

    it('supports HEIF images', () => {
      expect(isSupportedFileType('image/heif')).toBe(true)
    })

    it('supports DOCX files', () => {
      expect(isSupportedFileType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true)
    })

    it('supports XLSX files', () => {
      expect(isSupportedFileType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true)
    })
  })

  describe('unsupported types', () => {
    it('rejects plain text files', () => {
      expect(isSupportedFileType('text/plain')).toBe(false)
    })

    it('rejects CSV files', () => {
      expect(isSupportedFileType('text/csv')).toBe(false)
    })

    it('rejects HTML files', () => {
      expect(isSupportedFileType('text/html')).toBe(false)
    })

    it('rejects old DOC format', () => {
      expect(isSupportedFileType('application/msword')).toBe(false)
    })

    it('rejects old XLS format', () => {
      expect(isSupportedFileType('application/vnd.ms-excel')).toBe(false)
    })

    it('rejects GIF images', () => {
      expect(isSupportedFileType('image/gif')).toBe(false)
    })

    it('rejects unknown types', () => {
      expect(isSupportedFileType('application/octet-stream')).toBe(false)
    })

    it('rejects empty string', () => {
      expect(isSupportedFileType('')).toBe(false)
    })
  })
})

describe('UnsupportedFileTypeError', () => {
  it('has correct name', () => {
    const error = new UnsupportedFileTypeError('Test message')
    expect(error.name).toBe('UnsupportedFileTypeError')
  })

  it('has correct message', () => {
    const error = new UnsupportedFileTypeError('Unsupported file type: text/plain')
    expect(error.message).toBe('Unsupported file type: text/plain')
  })

  it('is instance of Error', () => {
    const error = new UnsupportedFileTypeError('Test')
    expect(error).toBeInstanceOf(Error)
  })
})
