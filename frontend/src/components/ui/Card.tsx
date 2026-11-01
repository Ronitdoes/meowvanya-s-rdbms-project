import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-3xl border border-ink-200/70 bg-white shadow-card', className)} {...props} />
}

export function CardHeader({
  title,
  description,
  action,
  className,
  children,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4 px-6 pt-6', className)}>
      <div className="min-w-0 space-y-1">
        {title ? <h2 className="text-base font-bold tracking-[-0.02em] text-ink-900">{title}</h2> : null}
        {description ? <p className="text-sm text-ink-500">{description}</p> : null}
        {children}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6', className)} {...props} />
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-3 border-t border-ink-100 px-6 py-4', className)} {...props} />
}
