/**
 * Create a mock Request object for testing API routes
 */
export function createMockRequest(
  url: string,
  options: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
  } = {}
): Request {
  const { method = 'GET', body, headers = {} } = options

  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * Parse a Response object and return status + data
 */
export async function parseResponse<T>(response: Response): Promise<{
  status: number
  data: T
}> {
  return {
    status: response.status,
    data: (await response.json()) as T,
  }
}
