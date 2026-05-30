import React, { useEffect } from 'react'
import { SplashScreen, Stack } from 'expo-router'
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

  useEffect(() => {
    // Some release builds can stay on the native splash. Force-hide after mount.
    SplashScreen.hideAsync().catch(() => {
      // Ignore to keep startup resilient.
    })
  }, [])

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
