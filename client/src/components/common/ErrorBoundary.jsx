import { Component } from 'react'

/*
  Error boundary: catches an error thrown while rendering anything inside it
  and shows `fallback` instead, so one broken part never blanks the whole page
  (without a boundary React unmounts the entire tree on a render error).

    <ErrorBoundary fallback={({ error, reset }) => <MyErrorCard error={error} onRetry={reset} />}>
      ...
    </ErrorBoundary>

  Used at three levels:
  - Boot.jsx around the whole app (last resort: a full-screen "Reload"),
  - App.jsx around the routed page (the nav stays usable),
  - LazySection around each lazily mounted section (only that card shows the
    error, with "Try again").

  Error boundaries must be class components (React has no hook for this), and
  this file imports nothing but React so Boot.jsx can use it before the data
  has loaded. Helpers for chunk-download errors are in lib/chunkError.js.
*/
export default class ErrorBoundary extends Component {
  state = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error) {
    return { error }
  }

  // A new resetKey (e.g. the route changed) clears the error, so navigating
  // away from a broken page shows the next page instead of the old error.
  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  componentDidCatch(error, info) {
    console.error('[ui] a part of the page failed to render:', error, info?.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) return this.props.fallback({ error: this.state.error, reset: this.reset })
    return this.props.children
  }
}
