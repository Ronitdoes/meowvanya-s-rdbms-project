import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from './api'
import {
  API_BASE,
  apiErrorResponse,
  clearCookies,
  emptyResponse,
  installFetchError,
  installFetchMock,
  jsonResponse,
  lastFetchRequest,
  requestHeader,
  setCookie,
} from '@/test/mockApi'

interface Club {
  clubId: number
  name: string
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearCookies()
})

describe('api.get', () => {
  it('unwraps the data envelope and sends a credentialed GET', async () => {
    const mock = installFetchMock(jsonResponse({ data: { clubId: 1, name: 'Chess Club' } }))

    const club = await api.get<Club>('/clubs/1')

    expect(club).toEqual({ clubId: 1, name: 'Chess Club' })
    const { url, init } = lastFetchRequest(mock)
    expect(url).toBe(`${API_BASE}/clubs/1`)
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('include')
    expect(requestHeader(init, 'content-type')).toBeNull()
  })

  it('serializes query params and skips empty values', async () => {
    const mock = installFetchMock(jsonResponse({ data: [] }))

    await api.get('/events', { page: 2, search: 'hack', empty: '', missing: undefined })

    expect(lastFetchRequest(mock).url).toBe(`${API_BASE}/events?page=2&search=hack`)
  })
})

describe('api.list', () => {
  it('unwraps data and pagination meta', async () => {
    const meta = { page: 2, pageSize: 10, total: 24, totalPages: 3 }
    installFetchMock(jsonResponse({ data: [{ clubId: 1, name: 'Chess Club' }], meta }))

    const result = await api.list<Club>('/clubs', { page: 2, pageSize: 10 })

    expect(result.data).toEqual([{ clubId: 1, name: 'Chess Club' }])
    expect(result.meta).toEqual(meta)
  })

  it('synthesizes meta when the response omits it', async () => {
    installFetchMock(jsonResponse({ data: [{ clubId: 1, name: 'Chess Club' }, { clubId: 2, name: 'Robotics' }] }))

    const result = await api.list<Club>('/clubs')

    expect(result.meta).toEqual({ page: 1, pageSize: 2, total: 2, totalPages: 1 })
  })

  it('returns an empty list when the envelope has no data', async () => {
    installFetchMock(jsonResponse({}))

    const result = await api.list<Club>('/clubs')

    expect(result.data).toEqual([])
    expect(result.meta.total).toBe(0)
  })
})

describe('api.post', () => {
  it('sends a JSON body and the CSRF cookie as a header', async () => {
    setCookie('cc_csrf', 'csrf-token-123')
    const mock = installFetchMock(jsonResponse({ data: { membershipId: 9, status: 'pending' } }))

    const membership = await api.post<{ membershipId: number; status: string }>('/clubs/4/join', { note: 'hello' })

    expect(membership).toEqual({ membershipId: 9, status: 'pending' })
    const { url, init } = lastFetchRequest(mock)
    expect(url).toBe(`${API_BASE}/clubs/4/join`)
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ note: 'hello' }))
    expect(requestHeader(init, 'content-type')).toBe('application/json')
    expect(requestHeader(init, 'x-csrf-token')).toBe('csrf-token-123')
    expect(init.credentials).toBe('include')
  })

  it('omits the CSRF header when the cookie is absent', async () => {
    const mock = installFetchMock(jsonResponse({ data: { ok: true } }))

    await api.post('/auth/login', { email: 'student01@campusconnect.test', password: 'Password123!' })

    expect(requestHeader(lastFetchRequest(mock).init, 'x-csrf-token')).toBeNull()
  })
})

describe('api error handling', () => {
  it('maps an error envelope to ApiError fields and status', async () => {
    installFetchMock(
      apiErrorResponse(409, 'already_registered', 'You are already registered for this event.', {
        eventId: 'You already have a confirmed seat.',
      }),
    )

    let caught: unknown
    try {
      await api.post('/events/7/register')
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ApiError)
    const apiError = caught as ApiError
    expect(apiError.status).toBe(409)
    expect(apiError.code).toBe('already_registered')
    expect(apiError.message).toBe('You are already registered for this event.')
    expect(apiError.fields).toEqual({ eventId: 'You already have a confirmed seat.' })
  })

  it('falls back to default code and message for non-JSON errors', async () => {
    installFetchMock(new Response('Internal boom', { status: 500 }))

    let caught: unknown
    try {
      await api.get('/clubs')
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ApiError)
    const apiError = caught as ApiError
    expect(apiError.status).toBe(500)
    expect(apiError.code).toBe('request_failed')
    expect(apiError.message).toBe('The request could not be completed.')
    expect(apiError.fields).toEqual({})
  })

  it('returns undefined for a 204 response', async () => {
    installFetchMock(emptyResponse())

    await expect(api.delete('/registrations/5')).resolves.toBeUndefined()
  })

  it('maps a rejected fetch to a network_error ApiError', async () => {
    installFetchError(new TypeError('Failed to fetch'))

    let caught: unknown
    try {
      await api.get('/me/dashboard')
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ApiError)
    const apiError = caught as ApiError
    expect(apiError.status).toBe(0)
    expect(apiError.code).toBe('network_error')
    expect(apiError.message).toContain('Could not reach the server')
  })

  it('dispatches an unauthorized event for a 401 outside login', async () => {
    installFetchMock(apiErrorResponse(401, 'unauthorized', 'Please sign in again.'))
    const listener = vi.fn()
    window.addEventListener('campusconnect:unauthorized', listener)

    await expect(api.get('/me/dashboard')).rejects.toBeInstanceOf(ApiError)
    expect(listener).toHaveBeenCalledTimes(1)

    window.removeEventListener('campusconnect:unauthorized', listener)
  })
})
