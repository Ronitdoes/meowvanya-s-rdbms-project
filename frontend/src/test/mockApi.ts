import { vi } from 'vitest'
import type { Mock } from 'vitest'

/** Matches the API base used by `@/services/api` when `VITE_API_URL` is not set. */
export const API_BASE = '/api/v1'

export type FetchMock = Mock<typeof fetch>

export interface MockResponseOptions {
  status?: number
  headers?: Record<string, string>
}

/** Build a JSON `Response`, defaulting to status 200 and a JSON content type. */
export function jsonResponse(body: unknown, options: MockResponseOptions = {}): Response {
  const headers = new Headers(options.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers,
  })
}

/** Build an empty response, matching the API's 204 handling. */
export function emptyResponse(status = 204): Response {
  return new Response(null, { status })
}

/** Build a standard API error envelope. */
export function apiErrorResponse(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        ...(fields ? { fields } : {}),
      },
    },
    { status },
  )
}

export type QueuedResponse = Response | (() => Response | Promise<Response>)

/**
 * Install a `fetch` mock that returns the queued responses in order.
 * Responses are consumed once; an unexpected extra call throws.
 */
export function installFetchMock(...responses: QueuedResponse[]): FetchMock {
  const queue = [...responses]
  const mock = vi.fn<typeof fetch>(async () => {
    const next = queue.shift()
    if (!next) throw new Error('Unexpected fetch call: no mocked responses left.')
    return typeof next === 'function' ? await next() : next
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

/** Install a `fetch` mock that rejects, simulating a network failure. */
export function installFetchError(error: unknown = new TypeError('Failed to fetch')): FetchMock {
  const mock = vi.fn<typeof fetch>(async () => {
    throw error
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

/** Return the URL and init of the most recent fetch call. */
export function lastFetchRequest(mock: FetchMock): { url: string; init: RequestInit } {
  const call = mock.mock.calls.at(-1)
  if (!call) throw new Error('fetch was not called.')
  const [input, init] = call
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  return { url, init: init ?? {} }
}

/** Read a header from a captured request init. */
export function requestHeader(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name)
}

/** Set a cookie for the current jsdom document. */
export function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/`
}

/** Remove every cookie visible to the current jsdom document. */
export function clearCookies(): void {
  for (const entry of document.cookie.split('; ')) {
    const name = entry.split('=')[0]
    if (name) document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`
  }
}
