import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { router } from 'expo-router'

export default function SettingsScreen() {
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
      Alert.alert('Fehler', 'Bitte beide Felder ausfüllen.')
      return
    }
    if (!url.startsWith('https://')) {
      Alert.alert('Fehler', 'URL muss mit https:// beginnen.')
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Supabase Datenbank</Text>
      <Text style={styles.description}>
        Kostenloses Konto auf supabase.com erstellen, SQL-Schema aus{' '}
        <Text style={styles.mono}>supabase/schema.sql</Text> ausführen und Zugangsdaten eingeben.
      </Text>

      <View style={styles.form}>
        <Text style={styles.label}>Supabase URL</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="https://xxxx.supabase.co"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          keyboardType="url"
        />

        <Text style={[styles.label, { marginTop: 16 }]}>Anon (Public) Key</Text>
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
          Zu finden unter: Dashboard → Project Settings → API → anon (public)
        </Text>
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 8 }]}>KI-Titelerkennung (Gemini)</Text>
      <Text style={styles.description}>
        Kostenlosen API-Schlüssel auf aistudio.google.com erstellen (15 Anfragen/Minute gratis).
        Ohne Key wird der Filmtitel manuell eingegeben.
      </Text>
      <View style={styles.form}>
        <Text style={styles.label}>Gemini API Key</Text>
        <TextInput
          style={styles.input}
          value={geminiKey}
          onChangeText={setGeminiKey}
          placeholder="AIzaSy..."
          placeholderTextColor="#64748b"
          secureTextEntry
          autoCapitalize="none"
        />
        <Text style={styles.hint}>Zu finden unter: aistudio.google.com → API Keys</Text>
      </View>

      <TouchableOpacity
        style={[styles.btn, saved && styles.btnSaved]}
        onPress={handleSave}
      >
        <Text style={styles.btnText}>{saved ? '✓ Gespeichert!' : 'Einstellungen speichern'}</Text>
      </TouchableOpacity>

      <View style={styles.infoGrid}>
        <InfoCard title="OCR" value="Gemini AI (online)" />
        <InfoCard title="Filmdaten" value="Wikidata (kostenlos)" />
        <InfoCard title="Cover" value="Wikipedia API" />
        <InfoCard title="Datenbank" value="Supabase (gratis)" />
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
