import { useEffect, useRef } from 'react'
import type { KeyboardEvent, RefObject } from 'react'

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url'])

/** True when a keypress should submit its form: Enter in a single-line text
 *  field (not while an autocomplete list is open), or Ctrl/⌘+Enter anywhere,
 *  including multiline fields where plain Enter adds a newline. */
export function isSubmitKey(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' || event.defaultPrevented || event.nativeEvent.isComposing) return false
  if (event.shiftKey || event.altKey) return false
  if (event.ctrlKey || event.metaKey) return true
  const target = event.target
  return (
    target instanceof HTMLInputElement &&
    TEXT_INPUT_TYPES.has(target.type) &&
    target.getAttribute('aria-expanded') !== 'true'
  )
}

/** Focuses `ref` once it is `ready`. Deferred a frame so a modal Dialog's
 *  focus trap, which moves focus to the dialog root on open, doesn't win. */
export function useInitialFocus(ref: RefObject<HTMLElement | null>, ready = true) {
  const done = useRef(false)
  useEffect(() => {
    if (!ready || done.current) return
    const frame = requestAnimationFrame(() => {
      if (!ref.current) return
      ref.current.focus()
      done.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [ready, ref])
}
