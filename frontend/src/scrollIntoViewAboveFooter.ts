import { DRAWER_TITLE_ID } from './components/MyCollectionsDrawer'

const SCROLL_GAP_PX = 16

export function scrollIntoViewAboveFooter(
  el: HTMLElement,
  { expectedHeightIncrease = 0 }: { expectedHeightIncrease?: number } = {},
): void {
  const rect = el.getBoundingClientRect()
  let bottomLimit = window.innerHeight
  const footerDock = document.querySelector<HTMLElement>('[data-testid="footer-dock"]')

  if (footerDock) {
    bottomLimit = Math.min(bottomLimit, footerDock.getBoundingClientRect().top)
  }

  const trigger = document.getElementById(DRAWER_TITLE_ID)
  if (trigger) {
    const triggerRect = trigger.getBoundingClientRect()
    const isVisible = triggerRect.width > 0 && triggerRect.height > 0
    const overlapsHorizontally = triggerRect.left < rect.right && triggerRect.right > rect.left

    if (isVisible && overlapsHorizontally) {
      bottomLimit = Math.min(bottomLimit, triggerRect.top)
    }
  }

  let delta = rect.bottom + expectedHeightIncrease - (bottomLimit - SCROLL_GAP_PX)
  if (delta <= 0) return

  delta = Math.min(delta, rect.top - SCROLL_GAP_PX)
  if (delta <= 0) return

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollBy({ top: delta, behavior: prefersReducedMotion ? 'auto' : 'smooth' })
}
