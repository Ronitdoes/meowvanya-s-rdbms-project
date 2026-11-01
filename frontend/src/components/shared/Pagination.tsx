import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn, pluralize } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import type { PaginationMeta } from '@/types'

export function Pagination({
  meta,
  onPageChange,
  className,
  label = 'items',
}: {
  meta?: PaginationMeta | null
  onPageChange: (page: number) => void
  className?: string
  label?: string
}) {
  if (!meta || meta.total === 0) return null
  const { page, totalPages, total } = meta
  if (totalPages <= 1) {
    return (
      <p className={cn('text-xs text-ink-400', className)}>
        {pluralize(total, label.replace(/s$/, ''), label)}
      </p>
    )
  }

  const start = Math.max(1, Math.min(page - 2, totalPages - 4))
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, index) => start + index).filter(
    (value) => value <= totalPages,
  )

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <p className="text-xs text-ink-400">
        Showing <span className="font-semibold text-ink-700">{(page - 1) * meta.pageSize + 1}</span>–
        <span className="font-semibold text-ink-700">{Math.min(page * meta.pageSize, total)}</span> of{' '}
        <span className="font-semibold text-ink-700">{total}</span> {label}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {pages.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onPageChange(value)}
            className={cn(
              'h-8 min-w-8 rounded-full px-2 text-xs font-semibold transition-colors',
              value === page ? 'bg-ink-950 text-white' : 'text-ink-500 hover:bg-ink-100',
            )}
            aria-current={value === page ? 'page' : undefined}
          >
            {value}
          </button>
        ))}
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
