import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAWER_TITLE_ID } from '../src/components/MyCollectionsDrawer'
import { scrollIntoViewAboveFooter } from '../src/scrollIntoViewAboveFooter'

const originalInnerHeight = window.innerHeight
const originalMatchMedia = window.matchMedia
const originalScrollBy = window.scrollBy
const scrollByMock = vi.fn()

function makeRect(top: number, bottom: number, left: number, right: number): DOMRect {
  return {
    x: left,
    y: top,
    top,
    right,
    bottom,
    left,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  }
}

function addElement(rect: DOMRect, attributes: Record<string, string> = {}): HTMLElement {
  const element = document.createElement('div')
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect)
  document.body.appendChild(element)
  return element
}

function setReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' && matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia
}

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 })
  window.scrollBy = scrollByMock
  scrollByMock.mockReset()
  setReducedMotion(false)
})

afterEach(() => {
  document.body.replaceChildren()
  window.scrollBy = originalScrollBy
  window.matchMedia = originalMatchMedia
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: originalInnerHeight,
  })
})

describe('scrollIntoViewAboveFooter', () => {
  it('does not scroll an element that is already visible', () => {
    const element = addElement(makeRect(100, 200, 0, 100))

    scrollIntoViewAboveFooter(element)

    expect(scrollByMock).not.toHaveBeenCalled()
  })

  it('scrolls an element above the footer dock', () => {
    const element = addElement(makeRect(400, 490, 0, 100))
    addElement(makeRect(450, 500, 0, 100), { 'data-testid': 'footer-dock' })

    scrollIntoViewAboveFooter(element)

    expect(scrollByMock).toHaveBeenCalledWith({ top: 56, behavior: 'smooth' })
  })

  it('limits scrolling to the top of a horizontally overlapping trigger', () => {
    const element = addElement(makeRect(300, 450, 10, 110))
    addElement(makeRect(380, 420, 50, 150), { id: DRAWER_TITLE_ID })

    scrollIntoViewAboveFooter(element)

    expect(scrollByMock).toHaveBeenCalledWith({ top: 86, behavior: 'smooth' })
  })

  it('ignores a trigger that does not overlap horizontally', () => {
    const element = addElement(makeRect(300, 490, 0, 100))
    addElement(makeRect(380, 420, 200, 240), { id: DRAWER_TITLE_ID })

    scrollIntoViewAboveFooter(element)

    expect(scrollByMock).toHaveBeenCalledWith({ top: 6, behavior: 'smooth' })
  })

  it('caps scrolling so a tall element keeps its top at least 16 pixels down', () => {
    const element = addElement(makeRect(50, 600, 0, 100))

    scrollIntoViewAboveFooter(element)

    expect(scrollByMock).toHaveBeenCalledWith({ top: 34, behavior: 'smooth' })
    expect(50 - 34).toBe(16)
  })

  it('uses instant scrolling when reduced motion is preferred', () => {
    setReducedMotion(true)
    const element = addElement(makeRect(300, 490, 0, 100))

    scrollIntoViewAboveFooter(element)

    expect(scrollByMock).toHaveBeenCalledWith({ top: 6, behavior: 'auto' })
  })
})
