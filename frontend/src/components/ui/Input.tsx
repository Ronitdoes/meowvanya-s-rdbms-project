import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const controlBase =
  'w-full rounded-xl border bg-white text-sm text-ink-900 shadow-sm transition-colors placeholder:text-ink-400 focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400'

function controlTone(error?: string) {
  return error
    ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/10'
    : 'border-ink-200 focus:border-brand-500 focus:ring-brand-500/10'
}

export function FieldShell({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
  action,
}: {
  label?: ReactNode
  htmlFor?: string
  error?: string
  hint?: ReactNode
  required?: boolean
  className?: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={htmlFor} className="text-[0.8125rem] font-semibold text-ink-800">
            {label}
            {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
          </label>
          {action}
        </div>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs font-medium text-rose-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-400">{hint}</p>
      ) : null}
    </div>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode
  error?: string
  hint?: ReactNode
  leftIcon?: ReactNode
  rightSlot?: ReactNode
  fieldClassName?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, fieldClassName, label, error, hint, leftIcon, rightSlot, id, required, ...props },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  return (
    <FieldShell label={label} htmlFor={inputId} error={error} hint={hint} required={required} className={fieldClassName}>
      <div className="relative">
        {leftIcon ? (
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-ink-400">{leftIcon}</span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={Boolean(error)}
          className={cn(controlBase, controlTone(error), 'h-11 px-3.5', leftIcon && 'pl-10', rightSlot && 'pr-11', className)}
          {...props}
        />
        {rightSlot ? <span className="absolute inset-y-0 right-0 flex items-center pr-2">{rightSlot}</span> : null}
      </div>
    </FieldShell>
  )
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode
  error?: string
  hint?: ReactNode
  placeholder?: string
  fieldClassName?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, fieldClassName, label, error, hint, id, required, placeholder, children, ...props },
  ref,
) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  return (
    <FieldShell label={label} htmlFor={selectId} error={error} hint={hint} required={required} className={fieldClassName}>
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          required={required}
          aria-invalid={Boolean(error)}
          className={cn(controlBase, controlTone(error), 'h-11 appearance-none px-3.5 pr-10', className)}
          {...props}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      </div>
    </FieldShell>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode
  error?: string
  hint?: ReactNode
  fieldClassName?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, fieldClassName, label, error, hint, id, required, rows = 4, ...props },
  ref,
) {
  const generatedId = useId()
  const textareaId = id ?? generatedId
  return (
    <FieldShell label={label} htmlFor={textareaId} error={error} hint={hint} required={required} className={fieldClassName}>
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        required={required}
        aria-invalid={Boolean(error)}
        className={cn(controlBase, controlTone(error), 'resize-y px-3.5 py-3', className)}
        {...props}
      />
    </FieldShell>
  )
})
