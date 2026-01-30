/**
 * Background task runner for Railway (replaces Vercel's waitUntil)
 *
 * Since Railway containers persist (unlike serverless), we can use
 * fire-and-forget pattern for background work.
 */

/**
 * Run a function in the background without blocking the response.
 * Errors are logged but not propagated.
 */
export function runInBackground(fn: () => Promise<void>): void {
  fn().catch(err => {
    console.error('[BACKGROUND] Task failed:', err)
  })
}

/**
 * Run multiple background tasks in parallel
 */
export function runAllInBackground(fns: Array<() => Promise<void>>): void {
  Promise.all(fns.map(fn => fn().catch(err => {
    console.error('[BACKGROUND] Task failed:', err)
  })))
}
