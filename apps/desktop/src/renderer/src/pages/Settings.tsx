import React, { useState } from 'react'
import type { AppSettings } from '../App'
import { Check, AlertCircle } from '../components/Icons'
import { TMDB_ATTRIBUTION_NOTICE } from '@shared/tmdb'
import tmdbLogo from '../assets/tmdb-logo.svg'
import { useI18n } from '../i18n'

interface SettingsProps {
  initialSettings: AppSettings
  onSave: (settings: AppSettings) => Promise<void>
  onLanguageChange?: (language: AppSettings['language']) => void
}

export function Settings({ initialSettings, onSave, onLanguageChange }: SettingsProps) {
  const { t } = useI18n()
  const [url, setUrl] = useState(initialSettings.supabaseUrl)
  const [key, setKey] = useState(initialSettings.supabaseKey)
  const [geminiKey, setGeminiKey] = useState(initialSettings.geminiKey)
  const [language, setLanguage] = useState(initialSettings.language)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSelectLanguage = (nextLanguage: AppSettings['language']) => {
    setLanguage(nextLanguage)
    onLanguageChange?.(nextLanguage)
  }

  const handleSave = async () => {
    const trimmedUrl = url.trim()
    const trimmedKey = key.trim()

    if (trimmedUrl && !trimmedKey) {
      setError(t('settings.error.missingKey'))
      return
    }
    if (trimmedKey && !trimmedUrl) {
      setError(t('settings.error.missingUrl'))
      return
    }
    if (trimmedUrl && !trimmedUrl.startsWith('https://')) {
      setError(t('settings.error.invalidUrl'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({ supabaseUrl: trimmedUrl, supabaseKey: trimmedKey, geminiKey: geminiKey.trim(), language })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-slate-700 bg-slate-800 shrink-0">
        <h1 className="text-xl font-bold text-white">{t('settings.title')}</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl space-y-8">
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">{t('settings.language')}</h2>
              <p className="text-slate-400 text-sm mt-1">{t('settings.languageHelp')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleSelectLanguage('de')}
                className={`rounded-lg border px-4 py-2.5 text-sm transition-colors ${language === 'de' ? 'border-brand-500 bg-brand-900 text-white' : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500'}`}
              >
                {t('settings.languageGerman')}
              </button>
              <button
                onClick={() => handleSelectLanguage('en')}
                className={`rounded-lg border px-4 py-2.5 text-sm transition-colors ${language === 'en' ? 'border-brand-500 bg-brand-900 text-white' : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500'}`}
              >
                {t('settings.languageEnglish')}
              </button>
            </div>
          </section>

          {/* Gemini API – Titelkennnung */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">{t('settings.geminiTitle')}</h2>
              <p className="text-slate-400 text-sm mt-1">
                {t('settings.geminiDescription').split('aistudio.google.com')[0]}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  className="text-brand-400 hover:underline"
                  onClick={(e) => { e.preventDefault(); window.open('https://aistudio.google.com/app/apikey') }}
                >
                  aistudio.google.com
                </a>
                {t('settings.geminiDescription').split('aistudio.google.com')[1]}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                {t('settings.geminiKey')} <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="AIza..."
                className="w-full px-4 py-2.5 bg-slate-700 text-white placeholder-slate-500 rounded-lg border border-slate-600 focus:border-brand-500 focus:outline-none font-mono text-sm"
              />
              <p className="text-slate-500 text-xs mt-1">
                {t('settings.geminiRateLimit')}
              </p>
            </div>
          </section>

          {/* Supabase-Konfiguration */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">{t('settings.syncTitle')}</h2>
              <p className="text-slate-400 text-sm mt-1">
                {t('settings.syncDescription').split('supabase.com')[0]}
                <a
                  href="https://supabase.com"
                  className="text-brand-400 hover:underline"
                  onClick={(e) => {
                    e.preventDefault()
                    window.open('https://supabase.com')
                  }}
                >
                  supabase.com
                </a>
                {t('settings.syncDescription').split('supabase.com')[1]}
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  {t('settings.supabaseUrl')}
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://xxxxxxxxxxxx.supabase.co"
                  className="w-full px-4 py-2.5 bg-slate-700 text-white placeholder-slate-500 rounded-lg border border-slate-600 focus:border-brand-500 focus:outline-none font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  {t('settings.supabaseKey')}
                </label>
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={t('settings.supabaseKeyPlaceholder')}
                  className="w-full px-4 py-2.5 bg-slate-700 text-white placeholder-slate-500 rounded-lg border border-slate-600 focus:border-brand-500 focus:outline-none font-mono text-sm"
                />
                <p className="text-slate-500 text-xs mt-1">
                  {t('settings.supabaseKeyHint')}
                </p>
                <p className="text-slate-500 text-xs mt-1">
                  {t('settings.supabaseOptionalHint')}
                </p>
              </div>
            </div>
          </section>

          {/* Schema-Hinweis */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">{t('settings.schemaTitle')}</h2>
            <div className="p-4 bg-slate-800 rounded-xl border border-slate-700 text-sm text-slate-300 space-y-2">
              <p>{t('settings.schemaStep1')}</p>
              <p>{t('settings.schemaStep2').replace('SQL Editor', '')}<span className="font-mono bg-slate-700 px-1 rounded">SQL Editor</span>{t('settings.schemaStep2').endsWith('open SQL Editor') ? '' : ' öffnen'}</p>
              <p>
                {t('settings.schemaStep3a')}{' '}
                <span className="font-mono bg-slate-700 px-1 rounded">supabase/schema.sql</span>{' '}
                {t('settings.schemaStep3b')}
              </p>
              <p>{t('settings.schemaStep4')}</p>
            </div>
          </section>

          {/* Fehlermeldung */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
              <span className="w-4 h-4 shrink-0"><AlertCircle /></span>
              {error}
            </div>
          )}

          {/* Speichern-Button */}
          <button
            onClick={handleSave}
            disabled={saving}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-colors
              ${saved
                ? 'bg-green-700 text-white'
                : 'bg-brand-600 hover:bg-brand-500 text-white'
              }
              disabled:opacity-60`}
          >
            {saved ? (
              <>
                <span className="w-4 h-4"><Check /></span>
                {t('settings.saved')}
              </>
            ) : saving ? (
              t('settings.saving')
            ) : (
              t('settings.save')
            )}
          </button>

          {/* Info-Box */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">{t('settings.aboutTitle')}</h2>
            <div className="grid grid-cols-2 gap-3">
              <InfoCard title={t('settings.cardAi')} value={geminiKey ? t('settings.cardAiGemini') : t('settings.cardAiFallback')} />
              <InfoCard title={t('settings.cardMovies')} value="TMDB API" />
              <InfoCard title={t('settings.cardCovers')} value="TMDB Images" />
              <InfoCard title={t('settings.cardDatabase')} value={t('settings.cardDatabaseValue')} />
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
              <img
                src={tmdbLogo}
                alt="TMDB"
                className="h-8 w-auto"
              />
              <div className="text-slate-300 text-sm font-semibold mb-2">{t('settings.tmdbAttribution')}</div>
              <div className="text-slate-500 text-sm leading-6">{TMDB_ATTRIBUTION_NOTICE}</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function InfoCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="p-3 bg-slate-800 rounded-lg border border-slate-700">
      <div className="text-slate-500 text-xs mb-0.5">{title}</div>
      <div className="text-slate-300 text-sm font-medium">{value}</div>
    </div>
  )
}
