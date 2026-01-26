import { vi } from 'vitest'

/**
 * Create a mock async generator that yields the provided messages
 */
export function createMockQueryGenerator<T>(messages: T[]): AsyncGenerator<T, void, unknown> {
  return (async function* () {
    for (const msg of messages) {
      yield msg
    }
  })()
}

/**
 * Mock query function
 */
export const mockQuery = vi.fn()

/**
 * Mock createSdkMcpServer function
 */
export const mockCreateSdkMcpServer = vi.fn()

/**
 * Mock tool function
 */
export const mockTool = vi.fn()

/**
 * Helper to set up query responses
 */
export function mockQueryResponse<T>(messages: T[]): void {
  mockQuery.mockReturnValue(createMockQueryGenerator(messages))
}

/**
 * Pre-built response sequences for common scenarios
 */
export const mockResponses = {
  simpleSuccess: (text: string) => [
    { type: 'system' as const, subtype: 'init' as const, session_id: 'test-session' },
    { type: 'assistant' as const, message: { content: [{ type: 'text', text }] } },
    { type: 'result' as const, result: text },
  ],

  withError: (errorType: string, errorMessage: string) => [
    { type: 'system' as const, subtype: 'init' as const, session_id: 'test-session' },
    { type: 'error' as const, error: { type: errorType, message: errorMessage } },
  ],
}

/**
 * Factory for vi.mock
 */
export function createClaudeAgentSdkMock() {
  return {
    query: mockQuery,
    createSdkMcpServer: mockCreateSdkMcpServer,
    tool: mockTool,
  }
}
