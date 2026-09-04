import { Capacitor, registerPlugin } from '@capacitor/core'
import type { SecureEventSessionSnapshot } from '../../domain/event/eventTypes'
import { browserEncryptedPersistenceHealthy, browserEncryptedPersistenceSupported, browserEncryptedStorage, EncryptedStorageCorruptError } from './webEncryptedStorage'

interface SecureEventSessionNativePlugin {
  save(options: SecureEventSessionSnapshot): Promise<void>
  loadSession(): Promise<{ session: SecureEventSessionSnapshot | null; recoveryRequired: boolean; error?: string }>
  updateSnapshot(options: { eventId: string; eventName?: string; status?: string; metadata?: Record<string, unknown> }): Promise<void>
  clear(options?: { eventId?: string }): Promise<void>
}

const NativeStore = registerPlugin<SecureEventSessionNativePlugin>('SecureEventSession')
const WEB_EVENT_SESSION_KEY = 'event-session:latest'

export const secureSessionPersistenceAvailable = () => Capacitor.getPlatform() === 'android' || browserEncryptedPersistenceHealthy()

export const secureSessionPersistenceLabel = () => {
  if (Capacitor.getPlatform() === 'android') return 'Android Keystore로 이 기기의 세션을 보호합니다'
  if (browserEncryptedPersistenceHealthy()) return 'WebCrypto로 암호화해 IndexedDB에 세션을 보관합니다'
  return '브라우저 저장소를 사용할 수 없어 이 탭에서만 세션을 유지합니다'
}

export async function saveSecureEventSession(snapshot: SecureEventSessionSnapshot) {
  if (Capacitor.getPlatform() === 'android') { await NativeStore.save(snapshot); return true }
  return browserEncryptedStorage.setItem(WEB_EVENT_SESSION_KEY, JSON.stringify(snapshot))
}

export async function loadSecureEventSession() {
  if (Capacitor.getPlatform() === 'android') return { ...(await NativeStore.loadSession()), persistenceAvailable: true }
  try {
    const stored = await browserEncryptedStorage.getItem(WEB_EVENT_SESSION_KEY)
    if (!stored) return { session: null, recoveryRequired: false, persistenceAvailable: browserEncryptedPersistenceHealthy() }
    return { session: JSON.parse(stored) as SecureEventSessionSnapshot, recoveryRequired: false, persistenceAvailable: browserEncryptedPersistenceHealthy() }
  } catch (error) {
    await browserEncryptedStorage.removeItem(WEB_EVENT_SESSION_KEY)
    return {
      session: null,
      recoveryRequired: true,
      persistenceAvailable: false,
      error: error instanceof EncryptedStorageCorruptError ? error.message : '저장된 브라우저 세션이 손상되어 안전하게 정리했습니다.',
    }
  }
}

export async function updateSecureEventSnapshot(eventId: string, eventName: string, status: string, metadata: Record<string, unknown>) {
  if (Capacitor.getPlatform() === 'android') { await NativeStore.updateSnapshot({ eventId, eventName, status, metadata }); return }
  const stored = await loadSecureEventSession()
  if (stored.session?.eventId === eventId) await saveSecureEventSession({ ...stored.session, eventName, status: status as SecureEventSessionSnapshot['status'], metadata })
}

export async function clearSecureEventSession(eventId?: string) {
  if (Capacitor.getPlatform() === 'android') { await NativeStore.clear(eventId ? { eventId } : undefined); return }
  if (!eventId) { await browserEncryptedStorage.removeItem(WEB_EVENT_SESSION_KEY); return }
  const stored = await loadSecureEventSession()
  if (stored.session?.eventId === eventId) await browserEncryptedStorage.removeItem(WEB_EVENT_SESSION_KEY)
}

export const webSecureSessionPersistenceSupported = browserEncryptedPersistenceSupported
