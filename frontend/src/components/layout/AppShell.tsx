import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Award,
  Building2,
  CalendarDays,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Sparkles,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { cn, dashboardPath } from '@/lib/utils'
import type { Role } from '@/types'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/shared/Avatar'
import { RoleBadge } from '@/components/ui/Badge'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  end?: boolean
}

const studentNav: NavItem[] = [
  { to: '/student/dashboard', label: 'Overview', icon: <LayoutDashboard className="h-[18px] w-[18px]" />, end: true },
  { to: '/student/clubs', label: 'Clubs', icon: <Users className="h-[18px] w-[18px]" /> },
  { to: '/student/events', label: 'Events', icon: <CalendarDays className="h-[18px] w-[18px]" /> },
  { to: '/student/registrations', label: 'My registrations', icon: <ClipboardList className="h-[18px] w-[18px]" /> },
  { to: '/student/certificates', label: 'Certificates', icon: <Award className="h-[18px] w-[18px]" /> },
]

const coordinatorNav: NavItem[] = [
  { to: '/coordinator/dashboard', label: 'Overview', icon: <LayoutDashboard className="h-[18px] w-[18px]" />, end: true },
  { to: '/coordinator/events', label: 'My events', icon: <CalendarDays className="h-[18px] w-[18px]" /> },
  { to: '/coordinator/members', label: 'Members', icon: <Users className="h-[18px] w-[18px]" /> },
]

const adminNav: NavItem[] = [
  { to: '/admin/dashboard', label: 'Overview', icon: <LayoutDashboard className="h-[18px] w-[18px]" />, end: true },
  { to: '/admin/students', label: 'Students', icon: <GraduationCap className="h-[18px] w-[18px]" /> },
  { to: '/admin/clubs', label: 'Clubs', icon: <Users className="h-[18px] w-[18px]" /> },
  { to: '/admin/events', label: 'Events', icon: <CalendarDays className="h-[18px] w-[18px]" /> },
  { to: '/admin/venues', label: 'Venues', icon: <MapPin className="h-[18px] w-[18px]" /> },
  { to: '/admin/departments', label: 'Departments', icon: <Building2 className="h-[18px] w-[18px]" /> },
]

const navByRole: Record<Role, NavItem[]> = {
  student: studentNav,
  coordinator: coordinatorNav,
  admin: adminNav,
}

const roleLabel: Record<Role, string> = {
  student: 'Student portal',
  coordinator: 'Coordinator studio',
  admin: 'Admin console',
}

export function AppShell() {
  const { user, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const role = user?.role ?? 'student'
  const nav = navByRole[role]

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const currentLabel = useMemo(() => {
    const match = [...nav].sort((a, b) => b.to.length - a.to.length).find((item) => location.pathname.startsWith(item.to))
    return match?.label ?? roleLabel[role]
  }, [location.pathname, nav, role])

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-ink-950 text-white">
      <div className="flex items-center justify-between px-5 pb-6 pt-6">
        <Link to={dashboardPath(role)} className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-acid-300 text-ink-950">
            <Sparkles className="h-5 w-5" />
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-brand-400 ring-2 ring-ink-950" />
          </span>
          <span>
            <span className="block font-display text-xl leading-none tracking-[-0.01em] text-white">CampusConnect</span>
            <span className="mt-1 block text-[0.5625rem] font-bold uppercase tracking-[0.18em] text-white/35">Club & event OS</span>
          </span>
        </Link>
        <button
          type="button"
          className="rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="px-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
          <p className="text-[0.5625rem] font-bold uppercase tracking-[0.16em] text-white/35">Signed in as</p>
          <p className="mt-0.5 truncate text-xs font-semibold text-white/85">{roleLabel[role]}</p>
        </div>
      </div>

      <nav className="mt-5 flex-1 space-y-1 overflow-y-auto px-3 no-scrollbar" aria-label="Main navigation">
        <p className="px-3 pb-2 pt-2 text-[0.5625rem] font-bold uppercase tracking-[0.16em] text-white/30">Workspace</p>
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.8125rem] font-medium transition-all',
                isActive
                  ? 'bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                  : 'text-white/55 hover:bg-white/[0.05] hover:text-white/90',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive ? <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-acid-300" /> : null}
                <span className={cn('transition-colors', isActive ? 'text-acid-300' : 'text-white/35 group-hover:text-white/70')}>
                  {item.icon}
                </span>
                {item.label}
              </>
            )}
          </NavLink>
        ))}

        <div className="pt-4">
          <p className="px-3 pb-2 text-[0.5625rem] font-bold uppercase tracking-[0.16em] text-white/30">Account</p>
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.8125rem] font-medium transition-colors',
                isActive ? 'bg-white/[0.09] text-white' : 'text-white/55 hover:bg-white/[0.05] hover:text-white/90',
              )
            }
          >
            <UserRound className="h-[18px] w-[18px] text-white/35" />
            Profile & security
          </NavLink>
        </div>
      </nav>

      <div className="m-3 rounded-2xl border border-white/10 bg-white/[0.045] p-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={user?.student?.fullName ?? user?.email} size="sm" className="ring-ink-950" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">{user?.student?.fullName ?? user?.email}</p>
            <p className="truncate text-[0.625rem] text-white/40">{user?.student?.departmentName ?? user?.role}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-full p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-paper">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] lg:block">{sidebar}</aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-[280px] animate-fade-in shadow-lift">{sidebar}</div>
        </div>
      ) : null}

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-20 border-b border-ink-200/60 bg-paper/85 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="rounded-xl border border-ink-200 bg-white p-2 text-ink-600 shadow-sm hover:bg-ink-50 lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="text-[0.5625rem] font-bold uppercase tracking-[0.14em] text-ink-400">CampusConnect</p>
                <p className="truncate text-[0.8125rem] font-semibold text-ink-800">{currentLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <RoleBadge role={role} />
              <Link
                to="/profile"
                className="flex items-center gap-2 rounded-full border border-ink-200 bg-white py-1 pl-1 pr-3 text-xs font-semibold text-ink-700 shadow-sm transition-colors hover:border-ink-300"
              >
                <Avatar name={user?.student?.fullName ?? user?.email} size="xs" className="ring-0" />
                <span className="hidden max-w-[140px] truncate sm:block">{user?.student?.fullName ?? user?.email}</span>
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 py-7 sm:px-6 sm:py-9 lg:px-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export function AppShellFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <div className="flex items-center gap-3 text-sm font-semibold text-ink-400">
        <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
        Loading your workspace…
      </div>
    </div>
  )
}
