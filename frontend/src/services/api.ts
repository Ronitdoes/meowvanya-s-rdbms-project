import type { ApiErrorBody, ListResult, PaginationMeta } from '@/types'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1'

export class ApiError extends Error {
  status: number
  code: string
  fields: Record<string, string>

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields ?? {}
  }
}

type QueryValue = string | number | boolean | null | undefined

export function toQueryString(params?: Record<string, QueryValue>): string {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${name}=`
  const match = document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix))
  return match ? decodeURIComponent(match.slice(prefix.length)) : null
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase()
  const headers = new Headers(options.headers)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')

  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const csrf = readCookie('cc_csrf')
    if (csrf) headers.set('X-CSRF-Token', csrf)
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      method,
      headers,
      credentials: 'include',
    })
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection and try again.')
  }

  if (response.status === 204) {
    return undefined as T
  }

  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json() : null

  if (!response.ok) {
    const body = payload as ApiErrorBody | null
    const error = new ApiError(
      response.status,
      body?.error?.code ?? 'request_failed',
      body?.error?.message ?? 'The request could not be completed.',
      body?.error?.fields,
    )
    if (response.status === 401 && !path.startsWith('/auth/login')) {
      window.dispatchEvent(new CustomEvent('campusconnect:unauthorized'))
    }
    throw error
  }

  return payload as T
}

export async function get<T>(path: string, params?: Record<string, QueryValue>): Promise<T> {
  const payload = await request<{ data: T }>(`${path}${toQueryString(params)}`)
  return payload.data
}

export async function list<T>(path: string, params?: Record<string, QueryValue>): Promise<ListResult<T>> {
  const payload = await request<{ data: T[]; meta?: PaginationMeta }>(`${path}${toQueryString(params)}`)
  return {
    data: payload.data ?? [],
    meta: payload.meta ?? {
      page: 1,
      pageSize: payload.data?.length ?? 0,
      total: payload.data?.length ?? 0,
      totalPages: 1,
    },
  }
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<{ data: T }>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((payload) => payload.data)
}

export function patch<T>(path: string, body?: unknown): Promise<T> {
  return request<{ data: T }>(path, {
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((payload) => payload.data)
}

export function del(path: string): Promise<void> {
  return request<void>(path, { method: 'DELETE' })
}

export const api = { get, list, post, patch, delete: del }

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}
