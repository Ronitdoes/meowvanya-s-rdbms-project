import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

describe('Button', () => {
  it('renders its children as a button', () => {
    render(<Button>Save changes</Button>)
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it('disables the button and shows a spinner while loading', () => {
    render(<Button loading>Saving</Button>)

    const button = screen.getByRole('button', { name: 'Saving' })
    expect(button).toBeDisabled()
    const spinner = button.querySelector('svg')
    expect(spinner).not.toBeNull()
    expect(spinner).toHaveClass('animate-spin')
    expect(spinner).toHaveAttribute('aria-hidden')
  })

  it('applies variant and size classes', () => {
    render(
      <Button variant="danger" size="lg">
        Delete club
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Delete club' })
    expect(button).toHaveClass('bg-rose-600')
    expect(button).toHaveClass('h-12')
    expect(button).not.toHaveClass('bg-brand-700')
  })

  it('uses the default primary medium styles', () => {
    render(<Button>Default</Button>)

    const button = screen.getByRole('button', { name: 'Default' })
    expect(button).toHaveClass('bg-brand-700')
    expect(button).toHaveClass('h-10')
  })

  it('calls the click handler once when pressed', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Join club</Button>)

    await user.click(screen.getByRole('button', { name: 'Join club' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not call the click handler when disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Join club
      </Button>,
    )

    await user.click(screen.getByRole('button', { name: 'Join club' }))

    expect(onClick).not.toHaveBeenCalled()
  })
})
