import React, { useState } from 'react'
import type { AppSettings } from '../App'
import { Check, AlertCircle } from '../components/Icons'

interface SettingsProps {
  initialSettings: AppSettings
  onSave: (settings: AppSettings) => Promise<void>
}

export function Settings({ initialSettings, onSave }: SettingsProps) {
  const [url, setUrl] = useState(initialSettings.supabaseUrl)
  const [key, setKey] = useState(initialSettings.supabaseKey)
  const [geminiKey, setGeminiKey] = useState(initialSettings.geminiKey)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!url.trim() || !key.trim()) {
      setError('Bitte Supabase-URL und API-Key ausfüllen.')
      return
    }
    if (!url.startsWith('https://')) {
      setError('Supabase-URL muss mit https:// beginnen.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({ supabaseUrl: url.trim(), supabaseKey: key.trim(), geminiKey: geminiKey.trim() })
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
        <h1 className="text-xl font-bold text-white">Einstellungen</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl space-y-8">
          {/* Gemini API – Titelkennnung */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">KI-Texterkennung (Gemini)</h2>
              <p className="text-slate-400 text-sm mt-1">
                Kostenloser API-Key von{' '}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  className="text-brand-400 hover:underline"
                  onClick={(e) => { e.preventDefault(); window.open('https://aistudio.google.com/app/apikey') }}
                >
                  aistudio.google.com
                </a>{' '}
                – kein Kreditkarte nötig. Erkennt Filmtitel auf Covern viel zuverlässiger als klassisches OCR. Ohne Key wird Tesseract als Fallback genutzt.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Gemini API-Key <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="AIza..."
                className="w-full px-4 py-2.5 bg-slate-700 text-white placeholder-slate-500 rounded-lg border border-slate-600 focus:border-brand-500 focus:outline-none font-mono text-sm"
              />
              <p className="text-slate-500 text-xs mt-1">
                Kostenlos: 15 Anfragen/Minute, 1.500 Anfragen/Tag (Gemini 1.5 Flash)
              </p>
            </div>
          </section>

          {/* Supabase-Konfiguration */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Datenbank (Supabase)</h2>
              <p className="text-slate-400 text-sm mt-1">
                Kostenloses Hosting auf{' '}
                <a
                  href="https://supabase.com"
                  className="text-brand-400 hover:underline"
                  onClick={(e) => {
                    e.preventDefault()
                    window.open('https://supabase.com')
                  }}
                >
                  supabase.com
                </a>{' '}
                – kein Kreditkarte erforderlich. Projekt anlegen, SQL-Schema ausführen und die
                Zugangsdaten hier eintragen.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Supabase URL
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
                  Anon (Public) API-Key
                </label>
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  className="w-full px-4 py-2.5 bg-slate-700 text-white placeholder-slate-500 rounded-lg border border-slate-600 focus:border-brand-500 focus:outline-none font-mono text-sm"
                />
                <p className="text-slate-500 text-xs mt-1">
                  Zu finden unter: Supabase Dashboard → Project Settings → API → anon (public)
                </p>
              </div>
            </div>
          </section>

          {/* Schema-Hinweis */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">Datenbank-Schema einrichten</h2>
            <div className="p-4 bg-slate-800 rounded-xl border border-slate-700 text-sm text-slate-300 space-y-2">
              <p>1. Supabase-Projekt anlegen (kostenlos auf supabase.com)</p>
              <p>2. Im Dashboard: <span className="font-mono bg-slate-700 px-1 rounded">SQL Editor</span> öffnen</p>
              <p>
                3. Inhalt der Datei{' '}
                <span className="font-mono bg-slate-700 px-1 rounded">supabase/schema.sql</span>{' '}
                einfügen und ausführen
              </p>
              <p>4. URL und API-Key oben eintragen und speichern</p>
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
                Gespeichert!
              </>
            ) : saving ? (
              'Speichere...'
            ) : (
              'Einstellungen speichern'
            )}
          </button>

          {/* Info-Box */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">Über die App</h2>
            <div className="grid grid-cols-2 gap-3">
              <InfoCard title="KI-Erkennung" value={geminiKey ? 'Google Gemini 1.5 Flash' : 'Tesseract.js (Fallback)'} />
              <InfoCard title="Filmdaten" value="Wikidata SPARQL (kostenlos)" />
              <InfoCard title="Coverbilder" value="Wikipedia API (kostenlos)" />
              <InfoCard title="Datenbank" value="Supabase PostgreSQL" />
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
