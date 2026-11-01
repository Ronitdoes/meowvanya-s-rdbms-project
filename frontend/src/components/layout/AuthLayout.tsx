import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Award, CalendarCheck2, Sparkles, Users } from 'lucide-react'

const highlights = [
  {
    icon: <Users className="h-4 w-4" />,
    title: 'Find your people',
    copy: 'Discover clubs across every department and request to join in one tap.',
  },
  {
    icon: <CalendarCheck2 className="h-4 w-4" />,
    title: 'Never miss a thing',
    copy: 'Browse upcoming events, reserve a seat and keep every registration in one place.',
  },
  {
    icon: <Award className="h-4 w-4" />,
    title: 'Proof you showed up',
    copy: 'Attendance is tracked automatically, so certificates are ready when you are.',
  },
]

export function AuthLayout({ children, backTo }: { children: ReactNode; backTo?: string }) {
  return (
    <div className="grid min-h-screen bg-paper lg:grid-cols-[1.02fr_0.98fr]">
      <aside className="hero-wash relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col xl:p-14">
        <div className="surface-grid absolute inset-0 opacity-20" aria-hidden />
        <div className="absolute -right-24 top-1/4 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" aria-hidden />
        <div className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-acid-300/10 blur-3xl" aria-hidden />

        <div className="relative flex items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-acid-300 text-ink-950">
            <Sparkles className="h-5 w-5" />
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-brand-400 ring-2 ring-ink-950" />
          </span>
          <div>
            <p className="font-display text-xl leading-none">CampusConnect</p>
            <p className="mt-1 text-[0.5625rem] font-bold uppercase tracking-[0.18em] text-white/35">Club & event OS</p>
          </div>
        </div>

        <div className="relative mt-auto max-w-xl pb-8 pt-20">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-acid-200 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-acid-300" />
            Built for campus life
          </p>
          <h1 className="display-title text-[3.4rem] leading-[0.98] text-white xl:text-[4.1rem]">
            Every club.
            <br />
            Every event.
            <br />
            <span className="italic text-acid-200">One campus.</span>
          </h1>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-white/60">
            The single place for students, coordinators and administrators to run the extracurricular side of college —
            without spreadsheets, group chats or paper sign-in sheets.
          </p>
        </div>

        <div className="relative grid max-w-xl gap-3 sm:grid-cols-3">
          {highlights.map((item) => (
            <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.055] p-4 backdrop-blur-sm">
              <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-xl bg-acid-200/15 text-acid-200">
                {item.icon}
              </span>
              <p className="text-xs font-bold text-white">{item.title}</p>
              <p className="mt-1 text-[0.6875rem] leading-relaxed text-white/45">{item.copy}</p>
            </div>
          ))}
        </div>

        <div className="relative mt-10 flex items-center justify-between border-t border-white/10 pt-5 text-[0.625rem] uppercase tracking-[0.14em] text-white/30">
          <span>RDBMS project · 2026</span>
          <span>Neon · Go · React</span>
        </div>
      </aside>

      <main className="relative flex min-h-screen flex-col justify-center px-5 py-10 sm:px-10 lg:px-14">
        <div className="absolute left-5 top-6 flex items-center gap-3 lg:hidden">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-950 text-acid-300">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <p className="font-display text-lg leading-none text-ink-950">CampusConnect</p>
            <p className="mt-0.5 text-[0.5rem] font-bold uppercase tracking-[0.16em] text-ink-400">Club & event OS</p>
          </div>
        </div>
        {backTo ? (
          <Link
            to={backTo}
            className="absolute right-5 top-6 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-400 transition-colors hover:text-ink-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Link>
        ) : null}
        <div className="mx-auto w-full max-w-[420px] pt-16 lg:pt-0">{children}</div>
      </main>
    </div>
  )
}
