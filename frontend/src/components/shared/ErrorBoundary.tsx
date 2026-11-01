import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-paper px-6">
          <div className="max-w-md rounded-3xl border border-ink-200 bg-white p-8 text-center shadow-card">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h1 className="font-display text-3xl text-ink-950">A page fell over.</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              Something unexpected happened while rendering this view. Reloading usually fixes it.
            </p>
            <Button className="mt-6" onClick={() => window.location.assign('/')}>
              Return to CampusConnect
            </Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
