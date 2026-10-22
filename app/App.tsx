import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Platform, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as LocalAuthentication from 'expo-local-authentication'
import { LOCK_KEY, secure, TOKEN_KEY } from './src/api'
import { LoginScreen } from './src/LoginScreen'
import { HomeScreen } from './src/HomeScreen'
import { colors } from './src/theme'
import { Button } from './src/ui'

// Away for longer than this -> Face ID again. Short trips (WhatsApp, camera) don't re-lock.
const RELOCK_AFTER_MS = 60_000

// Two screens, so a token check is all the "navigation" we need: no token -> login, token -> home.
export default function App() {
  const [token, setToken] = useState<string | null | undefined>(undefined) // undefined = still reading storage
  const [locked, setLocked] = useState(false)
  const leftAt = useRef<number | null>(null)

  useEffect(() => {
    Promise.all([secure.get(TOKEN_KEY), secure.get(LOCK_KEY)]).then(([t, lock]) => {
      setToken(t)
      if (t && lock === '1' && Platform.OS !== 'web') setLocked(true)
    })
  }, [])

  // Lock again when the app comes back after being in the background for a while.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'background') leftAt.current = Date.now()
      if (state === 'active' && leftAt.current && Date.now() - leftAt.current > RELOCK_AFTER_MS) {
        if ((await secure.get(LOCK_KEY)) === '1' && Platform.OS !== 'web') setLocked(true)
      }
      if (state === 'active') leftAt.current = null
    })
    return () => sub.remove()
  }, [])

  const login = useCallback(async (t: string) => { await secure.set(TOKEN_KEY, t); setToken(t) }, [])
  const logout = useCallback(async () => {
    await Promise.all([secure.del(TOKEN_KEY), secure.del(LOCK_KEY)])
    setLocked(false)
    setToken(null)
  }, [])

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      {token === undefined ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : token && locked ? (
        <LockScreen onUnlock={() => setLocked(false)} onLogout={logout} />
      ) : token ? (
        <HomeScreen token={token} onLogout={logout} />
      ) : (
        <LoginScreen onLogin={login} />
      )}
    </SafeAreaView>
  )
}

function LockScreen({ onUnlock, onLogout }: { onUnlock: () => void; onLogout: () => void }) {
  const [failed, setFailed] = useState(false)
  const unlock = useCallback(async () => {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock MiniLedger' })
    if (r.success) onUnlock()
    else setFailed(true)
  }, [onUnlock])

  useEffect(() => { unlock() }, [unlock]) // ask straight away, like banking apps

  return (
    <View style={styles.lock}>
      <Text style={styles.lockIcon}>🔒</Text>
      <Text style={styles.lockTitle}>MiniLedger is locked</Text>
      <Text style={styles.lockText}>{failed ? "That didn't work. Try again." : 'Use Face ID or your passcode to open it.'}</Text>
      <Button label="Unlock" onPress={unlock} style={{ alignSelf: 'stretch', marginTop: 24 }} />
      <Button label="Log out instead" kind="ghost" onPress={onLogout} style={{ alignSelf: 'stretch', marginTop: 10 }} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lock: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  lockIcon: { fontSize: 48 },
  lockTitle: { fontSize: 22, fontWeight: '800', color: colors.ink, marginTop: 12 },
  lockText: { color: colors.muted, marginTop: 6, textAlign: 'center' },
})
