import React from 'react'
import { Tabs, router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Pressable } from 'react-native'
import { useI18n } from '../../lib/i18n'

export default function TabLayout() {
  const { t } = useI18n()

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#6366f1',
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: { backgroundColor: '#1e293b', borderTopColor: '#334155' },
        headerStyle: { backgroundColor: '#1e1b4b' },
        headerTintColor: '#fff',
        headerRight: () => (
          <Pressable
            onPress={() => router.push('/settings')}
            style={{ paddingHorizontal: 12, paddingVertical: 4 }}
            hitSlop={10}
          >
            <Ionicons name="settings-outline" size={24} color="#fff" />
          </Pressable>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab.library'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="film-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: t('tab.scan'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="camera-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  )
}
