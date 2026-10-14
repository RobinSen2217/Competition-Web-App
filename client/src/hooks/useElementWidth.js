import { useLayoutEffect, useState } from 'react'

// Width of an element in CSS px, updated (debounced) when it resizes.
export default function useElementWidth(ref, delay = 150) {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    let t
    const ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => setW(el.clientWidth), delay)
    })
    ro.observe(el)
    return () => {
      clearTimeout(t)
      ro.disconnect()
    }
  }, [ref, delay])
  return w
}
