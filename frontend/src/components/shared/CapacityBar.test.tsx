import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CapacityBar } from './CapacityBar'

function getBar(container: HTMLElement): HTMLElement {
  const bar = container.querySelector<HTMLElement>('div[style]')
  if (!bar) throw new Error('Capacity bar fill element not found')
  return bar
}

describe('CapacityBar', () => {
  it('sizes the fill to the rounded percentage and shows seats left', () => {
    const { container } = render(<CapacityBar confirmed={30} capacity={100} />)

    expect(getBar(container)).toHaveStyle({ width: '30%' })
    expect(screen.getByText('30 / 100 seats')).toBeInTheDocument()
    expect(screen.getByText('70 left')).toBeInTheDocument()
  })

  it('rounds fractional percentages', () => {
    const { container } = render(<CapacityBar confirmed={1} capacity={3} />)

    expect(getBar(container)).toHaveStyle({ width: '33%' })
    expect(screen.getByText('2 left')).toBeInTheDocument()
  })

  it('shows Full when every seat is taken', () => {
    const { container } = render(<CapacityBar confirmed={50} capacity={50} />)

    expect(getBar(container)).toHaveStyle({ width: '100%' })
    expect(screen.getByText('50 / 50 seats')).toBeInTheDocument()
    expect(screen.getByText('Full')).toBeInTheDocument()
  })

  it('clamps overbooked events to 100% and zero seats left', () => {
    const { container } = render(<CapacityBar confirmed={75} capacity={60} />)

    expect(getBar(container)).toHaveStyle({ width: '100%' })
    expect(screen.getByText('75 / 60 seats')).toBeInTheDocument()
    expect(screen.getByText('Full')).toBeInTheDocument()
  })

  it('renders an empty bar when capacity is zero', () => {
    const { container } = render(<CapacityBar confirmed={5} capacity={0} />)

    expect(getBar(container)).toHaveStyle({ width: '0%' })
    expect(screen.getByText('Full')).toBeInTheDocument()
  })

  it('hides the labels when showLabel is false', () => {
    const { container } = render(<CapacityBar confirmed={10} capacity={20} showLabel={false} />)

    expect(screen.queryByText('10 / 20 seats')).not.toBeInTheDocument()
    expect(getBar(container)).toHaveStyle({ width: '50%' })
  })
})
