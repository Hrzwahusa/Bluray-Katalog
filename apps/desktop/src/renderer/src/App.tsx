import React, { useState, useEffect } from 'react'
import { Library } from './pages/Library'
import { Scan } from './pages/Scan'
import { Settings } from './pages/Settings'
import { Film, Camera, Settings as SettingsIcon } from './components/Icons'
import { I18nProvider, type AppLanguage, useI18n } from './i18n'

export type Page = 'library' | 'scan' | 'settings'

export interface AppSettings {
  supabaseUrl: string
  supabaseKey: string
  geminiKey: string
  language: AppLanguage
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('library')
  const [settings, setSettings] = useState<AppSettings>({ supabaseUrl: '', supabaseKey: '', geminiKey: '', language: 'en' })
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  useEffect(() => {
    // Einstellungen aus Electron-Store laden
    if (!window.api) {
      console.error('window.api ist nicht verfügbar – Preload-Script nicht geladen?')
      setSettingsLoaded(true)
      setCurrentPage('settings')
      return
    }
    window.api.getSettings().then((s: AppSettings) => {
      setSettings(s)
      setSettingsLoaded(true)
    }).catch((err: unknown) => {
      console.error('getSettings fehlgeschlagen:', err)
      setSettingsLoaded(true)
      setCurrentPage('settings')
    })
  }, [])

  const handleSettingsSave = async (newSettings: AppSettings) => {
    await window.api.setSettings(newSettings)
    setSettings(newSettings)
    setCurrentPage('library')
  }

  const handleLanguagePreview = (language: AppLanguage) => {
    setSettings((prev) => ({ ...prev, language }))
  }

  if (!settingsLoaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-slate-400">Loading...</div>
      </div>
    )
  }

  return (
    <I18nProvider language={settings.language}>
      <AppShell
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        settings={settings}
        onSaveSettings={handleSettingsSave}
        onLanguagePreview={handleLanguagePreview}
      />
    </I18nProvider>
  )
}

function AppShell({
  currentPage,
  onPageChange,
  settings,
  onSaveSettings,
  onLanguagePreview,
}: {
  currentPage: Page
  onPageChange: (page: Page) => void
  settings: AppSettings
  onSaveSettings: (settings: AppSettings) => Promise<void>
  onLanguagePreview: (language: AppLanguage) => void
}) {
  const { t } = useI18n()

  return (
    <div className="flex flex-col h-screen bg-slate-900">
      {/* Titelleiste */}
      <div className="drag-region flex items-center h-10 px-4 bg-brand-900 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-2 no-drag">
          <div className="w-5 h-5 text-brand-500">
            <Film />
          </div>
          <span className="text-sm font-semibold text-white tracking-wide">{t('app.title')}</span>
        </div>
      </div>

      {/* Hauptbereich */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar Navigation */}
        <nav className="flex flex-col w-56 bg-slate-800 border-r border-slate-700 shrink-0">
          <div className="flex-1 py-4 space-y-1">
            <NavButton
              icon={<Film />}
              label={t('nav.library')}
              active={currentPage === 'library'}
              onClick={() => onPageChange('library')}
            />
            <NavButton
              icon={<Camera />}
              label={t('nav.scan')}
              active={currentPage === 'scan'}
              onClick={() => onPageChange('scan')}
            />
          </div>
          <div className="border-t border-slate-700 py-4">
            <NavButton
              icon={<SettingsIcon />}
              label={t('nav.settings')}
              active={currentPage === 'settings'}
              onClick={() => onPageChange('settings')}
            />
          </div>
        </nav>

        {/* Seiteninhalt */}
        <main className="flex-1 overflow-hidden">
          {currentPage === 'library' && (
            <Library settings={settings} onScanClick={() => onPageChange('scan')} />
          )}
          {currentPage === 'scan' && (
            <Scan settings={settings} onSuccess={() => onPageChange('library')} />
          )}
          {currentPage === 'settings' && (
            <Settings initialSettings={settings} onSave={onSaveSettings} onLanguageChange={onLanguagePreview} />
          )}
        </main>
      </div>
    </div>
  )
}

function NavButton({
  icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        flex items-center gap-3 w-full px-4 py-2.5 text-sm font-medium rounded-lg mx-2
        transition-colors duration-150
        ${active
          ? 'bg-brand-600 text-white'
          : 'text-slate-400 hover:text-white hover:bg-slate-700'
        }
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
      `}
      style={{ width: 'calc(100% - 16px)' }}
    >
      <span className="w-5 h-5 shrink-0">{icon}</span>
      {label}
    </button>
  )
}
