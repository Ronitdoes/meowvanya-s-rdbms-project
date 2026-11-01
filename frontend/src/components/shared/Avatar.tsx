import { Star } from 'lucide-react'
import { cn, initials } from '@/lib/utils'

const palettes = [
  'bg-brand-100 text-brand-800',
  'bg-amber-100 text-amber-800',
  'bg-sky-100 text-sky-800',
  'bg-rose-100 text-rose-800',
  'bg-violet-100 text-violet-800',
  'bg-acid-200 text-ink-900',
]

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}) {
  const hash = Array.from(name ?? '').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const palette = palettes[hash % palettes.length]
  const sizes = {
    xs: 'h-7 w-7 text-[0.625rem]',
    sm: 'h-9 w-9 text-xs',
    md: 'h-11 w-11 text-sm',
    lg: 'h-16 w-16 text-lg',
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold uppercase tracking-wide ring-2 ring-white',
        sizes[size],
        palette,
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}

export function StarRating({
  rating,
  count,
  size = 'sm',
  className,
}: {
  rating?: number | null
  count?: number
  size?: 'sm' | 'md'
  className?: string
}) {
  const value = rating ?? 0
  const starSize = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={rating ? `${rating.toFixed(1)} out of 5` : 'No ratings yet'}>
      <span className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              starSize,
              star <= Math.round(value) ? 'fill-sun-400 text-sun-400' : 'fill-ink-100 text-ink-200',
            )}
          />
        ))}
      </span>
      <span className="text-xs font-semibold text-ink-600">
        {rating ? rating.toFixed(1) : '—'}
        {typeof count === 'number' ? <span className="font-normal text-ink-400"> ({count})</span> : null}
      </span>
    </span>
  )
}

export function StarRatingInput({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star === 1 ? '' : 's'}`}
          onClick={() => onChange(star)}
          className="rounded-lg p-0.5 transition-transform hover:scale-110"
        >
          <Star
            className={cn(
              'h-7 w-7 transition-colors',
              star <= value ? 'fill-sun-400 text-sun-400' : 'fill-ink-100 text-ink-200',
            )}
          />
        </button>
      ))}
    </div>
  )
}
