import { Component } from 'react'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[Lumen] Uncaught error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      const { fallback, lang } = this.props
      if (fallback) return fallback
      const th = lang === 'th'
      return (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            {th ? 'เกิดข้อผิดพลาด' : 'Something went wrong'}
          </h2>
          <p className="muted" style={{ fontSize: 13, marginBottom: 24 }}>
            {th ? 'ลองรีเฟรชหน้าเว็บ หรือกลับหน้าหลัก' : 'Try refreshing the page or going back to dashboard'}
          </p>
          <button
            className="btn"
            onClick={() => window.location.reload()}
            style={{ marginRight: 8 }}
          >
            {th ? 'รีเฟรช' : 'Reload'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => this.setState({ error: null })}
          >
            {th ? 'ลองใหม่' : 'Try again'}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
