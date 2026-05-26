import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
} from 'react-native'
import * as SecureStore from 'expo-secure-store'
import * as Clipboard from 'expo-clipboard'
import { router } from 'expo-router'
import { useI18n } from '../lib/i18n'
import { SUPABASE_SCHEMA_SQL } from '../lib/schema-sql'

export default function SettingsScreen() {
  const { language, setLanguage, t } = useI18n()

  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [saved, setSaved] = useState(false)

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
    if (!url.trim() || !key.trim()) {
      Alert.alert(t('alert.error'), t('alert.fillBothFields'))
      return
    }
    if (!url.startsWith('https://')) {
      Alert.alert(t('alert.error'), t('alert.urlMustHttps'))
      return
    }
    await SecureStore.setItemAsync('supabaseUrl', url.trim())
    await SecureStore.setItemAsync('supabaseKey', key.trim())
    await SecureStore.setItemAsync('supabaseAnonKey', key.trim())
    if (geminiKey.trim()) {
      await SecureStore.setItemAsync('geminiKey', geminiKey.trim())
    }
    setSaved(true)
    setTimeout(() => {
      setSaved(false)
      router.back()
    }, 1500)
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
        style={[styles.btn, saved && styles.btnSaved]}
        onPress={handleSave}
      >
        <Text style={styles.btnText}>{saved ? `✓ ${t('settings.saved')}` : t('settings.save')}</Text>
      </TouchableOpacity>

      <View style={styles.infoGrid}>
        <InfoCard title="OCR" value="Gemini AI (online)" />
        <InfoCard title={t('settings.cardMovies')} value="Wikidata" />
        <InfoCard title={t('settings.cardCover')} value="Wikipedia API" />
        <InfoCard title={t('settings.cardDb')} value="Supabase" />
      </View>
    </ScrollView>
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
  content: { padding: 16, gap: 16, paddingBottom: 40 },
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
})
