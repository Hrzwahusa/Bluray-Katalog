import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { I18nProvider, type AppLanguage } from './i18n'

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; title: string },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode; title: string }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, background: '#0f172a', color: '#f87171', fontFamily: 'monospace', minHeight: '100vh' }}>
          <h2 style={{ color: '#fca5a5', marginBottom: 16 }}>{this.props.title}</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

function Root() {
  const language = (window.navigator.language ?? '').toLowerCase().startsWith('de') ? 'de' : 'en'

  return (
    <I18nProvider language={language as AppLanguage}>
      <ErrorBoundary title={language === 'de' ? 'Anwendungsfehler' : 'Application error'}>
        <App />
      </ErrorBoundary>
    </I18nProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Root />
)
