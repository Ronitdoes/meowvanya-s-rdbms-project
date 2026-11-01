import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { buttonStyles } from '@/components/ui/Button'

export default function NotFoundPage() {
  usePageTitle('Page not found')
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-950 text-acid-300">
        <Compass className="h-6 w-6" />
      </span>
      <p className="eyebrow">404 — off campus</p>
      <h1 className="display-title mt-2 text-5xl text-ink-950">This page wandered off.</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-500">
        The link may be outdated, or the page may have moved. Head back to your dashboard and pick up where you left
        off.
      </p>
      <Link to="/" className={buttonStyles({ className: 'mt-6' })}>
        Back to dashboard
      </Link>
    </div>
  )
}
