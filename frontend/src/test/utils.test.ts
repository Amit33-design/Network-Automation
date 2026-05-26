import { describe, it, expect } from 'vitest'
import { formatUSD, formatUptime, cn } from '@/lib/utils'

describe('formatUSD', () => {
  it('formats whole numbers with $ and commas', () => {
    expect(formatUSD(28000)).toBe('$28,000')
    expect(formatUSD(1200000)).toBe('$1,200,000')
  })

  it('returns $0 for zero', () => {
    expect(formatUSD(0)).toBe('$0')
  })
})

describe('formatUptime', () => {
  it('shows days for >= 86400 seconds', () => {
    expect(formatUptime(86400)).toBe('1d')
    expect(formatUptime(172800)).toBe('2d')
  })

  it('shows hours for >= 3600 and < 86400', () => {
    expect(formatUptime(3600)).toBe('1h')
    expect(formatUptime(7200)).toBe('2h')
  })

  it('shows seconds otherwise', () => {
    expect(formatUptime(300)).toBe('300s')
  })
})

describe('cn', () => {
  it('merges classes correctly', () => {
    expect(cn('a', 'b')).toBe('a b')
    expect(cn('px-4 py-2', 'px-6')).toBe('py-2 px-6')
  })

  it('handles conditional classes', () => {
    expect(cn('base', false && 'ignored', 'included')).toBe('base included')
  })
})
