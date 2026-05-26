import React from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { LanguageProvider, useI18n } from '../lib/i18n'

export default function RootLayout() {
  return (
    <LanguageProvider>
      <RootNavigator />
    </LanguageProvider>
  )
}

function RootNavigator() {
  const { t } = useI18n()

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#1e1b4b' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
          contentStyle: { backgroundColor: '#0f172a' },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="movie/[id]"
          options={{ title: t('header.movieDetails'), presentation: 'card' }}
        />
        <Stack.Screen
          name="settings"
          options={{ title: t('header.settings') }}
        />
      </Stack>
    </>
  )
}
