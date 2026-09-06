/**
 * Shared page chrome (AH5).
 *
 * PageHeader and StatCard exist because the five step pages each wrote their
 * own, in two different sizes and weights. These tests pin the contract the
 * pages rely on rather than the styling.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/StatCard'
import { IconServer } from '@/components/icons'

describe('PageHeader', () => {
  it('renders the title as the page heading', () => {
    render(<PageHeader title="Bill of Materials" />)
    expect(screen.getByRole('heading', { name: 'Bill of Materials' })).toBeTruthy()
  })

  it('renders a description and actions when given', () => {
    render(
      <PageHeader
        title="T" description={<>18 devices</>}
        actions={<button>Export</button>}
      />,
    )
    expect(screen.getByText('18 devices')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()
  })

  it('omits the description and actions when absent', () => {
    const { container } = render(<PageHeader title="T" />)
    expect(container.querySelector('p')).toBeNull()
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })
})

describe('StatCard', () => {
  it('shows the label and value', () => {
    render(<StatCard label="Total Devices" value={18} />)
    expect(screen.getByText('Total Devices')).toBeTruthy()
    expect(screen.getByText('18')).toBeTruthy()
  })

  it('shows a hint and an icon when given', () => {
    const { container } = render(
      <StatCard label="Grand Total" value="$410,000" hint="excl. cabling" Icon={IconServer} />,
    )
    expect(screen.getByText('excl. cabling')).toBeTruthy()
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('keeps the decorative accent out of the accessibility tree', () => {
    const { container } = render(<StatCard label="L" value="1" tone="green" />)
    const accent = container.querySelector('span[aria-hidden="true"]')
    expect(accent).toBeTruthy()
  })
})
