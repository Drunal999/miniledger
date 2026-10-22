import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

// On a phone, "localhost" is the phone itself, so point this at your laptop's Wi-Fi IP (see README).
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000'

export type LoanStatus = 'due' | 'overdue' | 'repaid'
export type Loan = {
  id: number
  friendName: string
  amountPaise: number
  paidPaise: number
  dueDate: string
  repaidAt: string | null
  hasReceipt: boolean
  createdAt: string
  status: LoanStatus
}
export type Payment = { id: number; amountPaise: number; paidAt: string }
export type Summary = { totalLentPaise: number; totalRepaidPaise: number; overduePaise: number; overdueCount: number }
export type Profile = { phone: string; upiId: string | null }

// Small values (login token, app-lock setting) live in the phone's encrypted keystore.
// SecureStore has no web version, so web falls back to localStorage.
export const secure = {
  get: (k: string) => (Platform.OS === 'web' ? Promise.resolve(localStorage.getItem(k)) : SecureStore.getItemAsync(k)),
  set: (k: string, v: string) => (Platform.OS === 'web' ? Promise.resolve(localStorage.setItem(k, v)) : SecureStore.setItemAsync(k, v)),
  del: (k: string) => (Platform.OS === 'web' ? Promise.resolve(localStorage.removeItem(k)) : SecureStore.deleteItemAsync(k)),
}
export const TOKEN_KEY = 'miniledger.token'
export const LOCK_KEY = 'miniledger.lock'

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
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status)
  return data as T
}

export type Photo = { uri: string; mimeType?: string; fileName?: string | null }

/** Uploads a receipt photo as multipart form data. Native takes {uri,name,type}; web needs a real Blob. */
export async function uploadReceipt(loanId: number, photo: Photo, token: string) {
  const form = new FormData()
  const type = photo.mimeType ?? 'image/jpeg'
  if (Platform.OS === 'web') {
    form.append('receipt', await (await fetch(photo.uri)).blob(), photo.fileName ?? 'receipt.jpg')
  } else {
    form.append('receipt', { uri: photo.uri, name: photo.fileName ?? 'receipt.jpg', type } as unknown as Blob)
  }
  return api<{ loan: Loan }>(`/loans/${loanId}/receipt`, { method: 'POST', body: form }, token)
}
