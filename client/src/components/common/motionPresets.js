// Motion settings shared by <Reveal> and staggered lists (e.g. Features.jsx).
// Kept apart from Reveal.jsx so that file exports only a component (needed
// for React fast refresh in development).

// Quick start, gentle landing (an ease-out curve).
export const EASE_OUT = [0.22, 1, 0.36, 1]

// Trigger once, when about a tenth of the element is visible. Tall cards (the
// map, the plot builder) would never reach a higher threshold on small screens.
export const REVEAL_VIEWPORT = { once: true, amount: 0.1 }

// Variants shared with staggered lists (see Features.jsx). `custom` is an
// optional delay in seconds. The delay key is left out when it is 0 so that a
// parent's staggerChildren delay is not overridden by an explicit `delay: 0`.
export const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  shown: (delay) => ({
    opacity: 1,
    y: 0,
    transition: delay ? { duration: 0.45, ease: EASE_OUT, delay } : { duration: 0.45, ease: EASE_OUT },
  }),
}

// Parent variants that only time their children's fade-up, 35 ms apart.
export const stagger = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.035 } },
}
