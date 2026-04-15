import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '', stack: '' }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: String(error?.message || error || 'Unknown error') }
  }

  componentDidCatch(error, info) {
    this.setState({
      message: String(error?.message || error || 'Unknown error'),
      stack: String(info?.componentStack || ''),
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', background: '#0b1020', color: '#f0f6ff', padding: '20px', fontFamily: 'monospace' }}>
          <h2 style={{ marginTop: 0 }}>V3 UI runtime error</h2>
          <p>The app failed to render. This screen replaces the blank page so the exact error is visible.</p>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#121a30', padding: '12px', borderRadius: '8px' }}>{this.state.message}</pre>
          {this.state.stack && (
            <pre style={{ whiteSpace: 'pre-wrap', background: '#121a30', padding: '12px', borderRadius: '8px', marginTop: '12px' }}>{this.state.stack}</pre>
          )}
        </div>
      )
    }

    return this.props.children
  }
}