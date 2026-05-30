import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  StyleSheet,
  Alert,
  Linking,
  Platform,
} from 'react-native'
import * as SecureStore from 'expo-secure-store'
import * as Clipboard from 'expo-clipboard'
import { router } from 'expo-router'
import { useI18n } from '../lib/i18n'
import { SUPABASE_SCHEMA_SQL } from '../lib/schema-sql'
import { syncStoredMoviesNow } from '../lib/movie-store'
import { TMDB_ATTRIBUTION_NOTICE } from '@bluray-katalog/shared'
import { TmdbLogo } from '../lib/tmdb-logo'

export default function SettingsScreen() {
  const { language, setLanguage, t } = useI18n()

  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
      const u = await SecureStore.getItemAsync('supabaseUrl')
      const k =
        (await SecureStore.getItemAsync('supabaseKey')) ||
        (await SecureStore.getItemAsync('supabaseAnonKey'))
      const g = await SecureStore.getItemAsync('geminiKey')
      if (u) setUrl(u)
      if (k) setKey(k)
      if (g) setGeminiKey(g)
    }
    load()
  }, [])

  const handleSave = async () => {
    if (saving) return

    const trimmedUrl = url.trim()
    const trimmedKey = key.trim()

    if (trimmedUrl && !trimmedKey) {
      Alert.alert(t('alert.error'), t('settings.keyRequiredWhenUrl'))
      return
    }
    if (trimmedKey && !trimmedUrl) {
      Alert.alert(t('alert.error'), t('settings.urlRequiredWhenKey'))
      return
    }
    if (trimmedUrl && !trimmedUrl.startsWith('https://')) {
      Alert.alert(t('alert.error'), t('alert.urlMustHttps'))
      return
    }
    setSaving(true)
    try {
      await SecureStore.setItemAsync('supabaseUrl', trimmedUrl)
      await SecureStore.setItemAsync('supabaseKey', trimmedKey)
      await SecureStore.setItemAsync('supabaseAnonKey', trimmedKey)

      if (geminiKey.trim()) {
        await SecureStore.setItemAsync('geminiKey', geminiKey.trim())
      } else {
        await SecureStore.deleteItemAsync('geminiKey')
      }

      // Run initial sync in background so settings save stays responsive.
      if (trimmedUrl && trimmedKey) {
        syncStoredMoviesNow().catch((error) => {
          console.warn('Initial Supabase sync after saving settings failed:', error)
        })
      }

      setSaved(true)
      setTimeout(() => {
        setSaved(false)
        router.back()
      }, 1200)
    } finally {
      setSaving(false)
    }
  }

  const handleCopySchemaSql = async () => {
    try {
      await Clipboard.setStringAsync(SUPABASE_SCHEMA_SQL)
      Alert.alert('OK', t('settings.copySchemaDone'))
    } catch {
      Alert.alert(t('alert.error'), t('settings.copySchemaError'))
    }
  }

  const handleOpenSupabaseWebsite = async () => {
    const url = 'https://supabase.com'
    try {
      const canOpen = await Linking.canOpenURL(url)
      if (!canOpen) {
        Alert.alert(t('alert.error'), t('settings.openSupabaseError'))
        return
      }
      await Linking.openURL(url)
    } catch {
      Alert.alert(t('alert.error'), t('settings.openSupabaseError'))
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 24}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
        <Text style={styles.description}>{t('settings.languageHelp')}</Text>
        <View style={styles.languageRow}>
          <TouchableOpacity
            style={[styles.langBtn, language === 'de' && styles.langBtnActive]}
            onPress={() => setLanguage('de')}
          >
            <Text style={styles.langBtnText}>{t('settings.languageGerman')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.langBtn, language === 'en' && styles.langBtnActive]}
            onPress={() => setLanguage('en')}
          >
            <Text style={styles.langBtnText}>{t('settings.languageEnglish')}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>{t('settings.supabaseTitle')}</Text>
        <Text style={styles.description}>
          {t('settings.supabaseDescription')}
        </Text>

        <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={handleOpenSupabaseWebsite}>
          <Text style={styles.btnText}>{t('settings.openSupabase')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={handleCopySchemaSql}>
          <Text style={styles.btnText}>{t('settings.copySchema')}</Text>
        </TouchableOpacity>

        <View style={styles.form}>
          <Text style={styles.label}>{t('settings.supabaseUrl')}</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="https://xxxx.supabase.co"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
            keyboardType="url"
          />

          <Text style={[styles.label, { marginTop: 16 }]}>{t('settings.anonKey')}</Text>
          <TextInput
            style={styles.input}
            value={key}
            onChangeText={setKey}
            placeholder="eyJhbGci..."
            placeholderTextColor="#64748b"
            secureTextEntry
            autoCapitalize="none"
          />
          <Text style={styles.hint}>
            {t('settings.anonHint')}
          </Text>
          <Text style={styles.hint}>
            {t('settings.supabaseOptionalHint')}
          </Text>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 8 }]}>{t('settings.geminiTitle')}</Text>
        <Text style={styles.description}>
          {t('settings.geminiDescription')}
        </Text>
        <View style={styles.form}>
          <Text style={styles.label}>{t('settings.geminiKey')}</Text>
          <TextInput
            style={styles.input}
            value={geminiKey}
            onChangeText={setGeminiKey}
            placeholder="AIzaSy..."
            placeholderTextColor="#64748b"
            secureTextEntry
            autoCapitalize="none"
          />
          <Text style={styles.hint}>{t('settings.geminiHint')}</Text>
        </View>

        <TouchableOpacity
          style={[styles.btn, saved && styles.btnSaved, saving && styles.btnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.btnText}>
            {saved ? `✓ ${t('settings.saved')}` : saving ? t('movie.saving') : t('settings.save')}
          </Text>
        </TouchableOpacity>

        <View style={styles.infoGrid}>
          <InfoCard title="OCR" value="Gemini AI (online)" />
          <InfoCard title={t('settings.cardMovies')} value="TMDB" />
          <InfoCard title={t('settings.cardCover')} value="TMDB Images" />
          <InfoCard title={t('settings.cardDb')} value={t('settings.cardDbValue')} />
        </View>

        <View style={styles.attributionBox}>
          <TmdbLogo width={110} height={22} />
          <Text style={styles.attributionTitle}>TMDB Attribution</Text>
          <Text style={styles.attributionText}>{TMDB_ATTRIBUTION_NOTICE}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function InfoCard({ title, value }: { title: string; value: string }) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.infoLabel}>{title}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, gap: 16, paddingBottom: 220 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  description: { color: '#94a3b8', lineHeight: 20 },
  languageRow: { flexDirection: 'row', gap: 8 },
  langBtn: {
    flex: 1,
    backgroundColor: '#334155',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  langBtnActive: {
    backgroundColor: '#6366f1',
  },
  langBtnText: { color: '#fff', fontWeight: '600' },
  mono: { fontFamily: 'monospace', color: '#818cf8' },
  form: { backgroundColor: '#1e293b', borderRadius: 12, padding: 16, gap: 4 },
  label: { color: '#cbd5e1', fontSize: 13, fontWeight: '600' },
  input: {
    backgroundColor: '#334155',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'monospace',
    fontSize: 13,
    marginTop: 4,
  },
  hint: { color: '#64748b', fontSize: 11, marginTop: 4 },
  btn: {
    backgroundColor: '#6366f1',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnSecondary: { backgroundColor: '#334155' },
  btnSaved: { backgroundColor: '#16a34a' },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  infoLabel: { color: '#64748b', fontSize: 11, marginBottom: 2 },
  infoValue: { color: '#e2e8f0', fontSize: 12, fontWeight: '500' },
  attributionBox: {
    backgroundColor: '#111827',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
  },
  attributionTitle: { color: '#cbd5e1', fontSize: 12, fontWeight: '700', marginBottom: 6 },
  attributionText: { color: '#94a3b8', lineHeight: 18, fontSize: 12 },
})
