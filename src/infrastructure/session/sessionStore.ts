import type { Role } from '../../domain/models'

export interface PersistedSession {
  kind: 'personal' | 'event-participant' | 'event-operator'
  role?: Role
  localId: string
  eventId?: string
  updatedAt: number
}

const KEY = 'steplink.active-session.v1'

export function saveSession(session: PersistedSession) { localStorage.setItem(KEY, JSON.stringify(session)) }
export function loadSession(): PersistedSession | null {
  try {
    const value = localStorage.getItem(KEY)
    return value ? (JSON.parse(value) as PersistedSession) : null
  } catch { return null }
}
export function clearSession() { localStorage.removeItem(KEY) }
