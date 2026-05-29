import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center p-8">
          <div className="max-w-lg w-full bg-gray-900 border border-red-500/40 rounded-xl p-6 text-center space-y-4">
            <div className="text-3xl">⚠️</div>
            <h2 className="text-lg font-semibold text-red-400">Something went wrong</h2>
            <pre className="text-xs text-gray-400 bg-black/30 rounded p-3 text-left overflow-auto max-h-40">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => { localStorage.clear(); window.location.reload() }}
              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
            >
              Clear state &amp; reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
