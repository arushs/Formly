import { vi } from 'vitest'

/**
 * Mock OpenAI client with chainable structure
 */
export const mockOpenAI = {
  chat: {
    completions: {
      parse: vi.fn(),
      create: vi.fn(),
    },
  },
}

/**
 * Mock OpenAI class constructor
 */
export class MockOpenAI {
  chat = mockOpenAI.chat
}

/**
 * Helper to set up a mock response for structured outputs (parse)
 */
export function mockStructuredOutput<T>(data: T): void {
  mockOpenAI.chat.completions.parse.mockResolvedValue({
    choices: [{ message: { parsed: data, content: JSON.stringify(data) } }],
  })
}

/**
 * Helper to set up a mock response for regular completions (create)
 */
export function mockChatCompletion(content: string): void {
  mockOpenAI.chat.completions.create.mockResolvedValue({
    choices: [{ message: { content } }],
  })
}

/**
 * Helper to mock an API error
 */
export function mockOpenAIError(message: string, status = 500): void {
  const error = new Error(message) as Error & { status?: number }
  error.status = status
  mockOpenAI.chat.completions.parse.mockRejectedValue(error)
  mockOpenAI.chat.completions.create.mockRejectedValue(error)
}

/**
 * Factory for vi.mock
 */
export function createOpenAIMock() {
  return {
    default: vi.fn(() => mockOpenAI),
    OpenAI: vi.fn(() => mockOpenAI),
  }
}
