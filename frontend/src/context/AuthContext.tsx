import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '@/services/api'
import type { LoginInput, RegisterInput, SessionUser } from '@/types'

interface AuthContextValue {
  user: SessionUser | null
  loading: boolean
  login: (input: LoginInput) => Promise<SessionUser>
  register: (input: RegisterInput) => Promise<SessionUser>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  setUser: (user: SessionUser | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<SessionUser>('/auth/me')
      setUser(me)
    } catch {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    let active = true
    api
      .get<SessionUser>('/auth/me')
      .then((me) => {
        if (active) setUser(me)
      })
      .catch(() => {
        if (active) setUser(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener('campusconnect:unauthorized', onUnauthorized)
    return () => window.removeEventListener('campusconnect:unauthorized', onUnauthorized)
  }, [])

  const login = useCallback(async (input: LoginInput) => {
    const session = await api.post<SessionUser>('/auth/login', input)
    setUser(session)
    return session
  }, [])

  const register = useCallback(async (input: RegisterInput) => {
    const session = await api.post<SessionUser>('/auth/register', input)
    setUser(session)
    return session
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post<void>('/auth/logout')
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, register, logout, refresh, setUser }),
    [user, loading, login, register, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
