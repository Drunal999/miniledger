import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

// On a phone, "localhost" is the phone itself, so point this at your laptop's Wi-Fi IP (see README).
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000'

export type LoanStatus = 'due' | 'overdue' | 'repaid'
export type Loan = {
  id: number
  friendName: string
  amountPaise: number
  dueDate: string
  repaidAt: string | null
  hasReceipt: boolean
  status: LoanStatus
}
export type Summary = { totalLentPaise: number; totalRepaidPaise: number; overduePaise: number; overdueCount: number }

// The login token lives in the phone's encrypted keystore. SecureStore has no web version, so web uses localStorage.
const TOKEN_KEY = 'miniledger.token'
export const tokenStore = {
  get: () => (Platform.OS === 'web' ? Promise.resolve(localStorage.getItem(TOKEN_KEY)) : SecureStore.getItemAsync(TOKEN_KEY)),
  set: (t: string) => (Platform.OS === 'web' ? Promise.resolve(localStorage.setItem(TOKEN_KEY, t)) : SecureStore.setItemAsync(TOKEN_KEY, t)),
  clear: () => (Platform.OS === 'web' ? Promise.resolve(localStorage.removeItem(TOKEN_KEY)) : SecureStore.deleteItemAsync(TOKEN_KEY)),
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

/** One place for every request: adds the token, turns server errors into readable messages. */
export async function api<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status)
  return data as T
}

/** Paise to "₹1,500.50" with Indian digit grouping. */
export const formatINR = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100)
