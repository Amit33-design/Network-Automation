/**
 * Keyboard focus must stay visible (AH11).
 *
 * Measured by tabbing through a real browser: 6 of 12 focusable elements had
 * no outline and no ring, and a sampled button showed no change at all on
 * focus — `outline: none`, `box-shadow: none`, border unchanged. WCAG 2.4.7
 * (Focus Visible, AA) is a hard requirement, not a preference.
 *
 * The fix is one global `:focus-visible` rule in index.css, so a new
 * component cannot forget it. jsdom applies no stylesheets, so the rule's
 * effect cannot be asserted here — that was verified in the browser. What
 * IS worth pinning is the thing that broke it: a component killing the
 * outline without drawing its own indicator.
 */
import { describe, it, expect } from 'vitest'

const SOURCES = import.meta.glob('../{components,pages}/**/*.tsx', {
  eager: true, query: '?raw', import: 'default',
}) as Record<string, string>

describe('focus indicators', () => {
  it('found the component sources', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(15)
  })

  it('no component removes the focus outline without replacing it', () => {
    // `focus:outline-none` is only safe alongside a ring or a border change
    // the component draws itself. Bare, it silently opts that control out of
    // the global rule.
    const offenders: string[] = []
    for (const [path, src] of Object.entries(SOURCES)) {
      for (const line of src.split('\n')) {
        if (!/focus:outline-none/.test(line)) continue
        const replaced = /focus(-visible)?:(ring|border|outline-\[|shadow)/.test(line)
        if (!replaced) offenders.push(`${path.replace('../', '')}: ${line.trim().slice(0, 70)}`)
      }
    }
    expect(offenders.slice(0, 8), `${offenders.length} control(s) kill the outline with nothing in its place`)
      .toEqual([])
  })
})
