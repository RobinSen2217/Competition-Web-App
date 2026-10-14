// localStorage with a namespace; never throws (private mode, blocked storage).
export const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('votc-' + k)
      return v == null ? d : JSON.parse(v)
    } catch {
      return d
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('votc-' + k, JSON.stringify(v))
    } catch {
      /* storage unavailable */
    }
  },
}
