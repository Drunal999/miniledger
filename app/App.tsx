import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { tokenStore } from './src/api'
import { LoginScreen } from './src/LoginScreen'
import { HomeScreen } from './src/HomeScreen'
import { colors } from './src/theme'

// Two screens, so a token check is all the "navigation" we need: no token -> login, token -> home.
export default function App() {
  const [token, setToken] = useState<string | null | undefined>(undefined) // undefined = still reading storage

  useEffect(() => { tokenStore.get().then(setToken) }, [])

  const login = useCallback(async (t: string) => { await tokenStore.set(t); setToken(t) }, [])
  const logout = useCallback(async () => { await tokenStore.clear(); setToken(null) }, [])

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      {token === undefined ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : token ? (
        <HomeScreen token={token} onLogout={logout} />
      ) : (
        <LoginScreen onLogin={login} />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
