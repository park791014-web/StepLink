const DATABASE_NAME = 'steplink-secure-v1'
const DATABASE_VERSION = 1
const KEY_STORE = 'keys'
const RECORD_STORE = 'records'
const MASTER_KEY_ID = 'event-and-auth-session-v1'

interface CiphertextEnvelope {
  version: 1
  iv: string
  ciphertext: string
}

export interface AsyncRecordDriver {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

export interface EncryptionKeyProvider {
  getOrCreate(): Promise<CryptoKey>
}

export class EncryptedStorageCorruptError extends Error {
  constructor(message = '암호화된 브라우저 세션을 해독할 수 없습니다.') {
    super(message)
    this.name = 'EncryptedStorageCorruptError'
  }
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const base64ToBytes = (value: string) => {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function isCiphertextEnvelope(value: unknown): value is CiphertextEnvelope {
  if (!value || typeof value !== 'object') return false
  const envelope = value as Partial<CiphertextEnvelope>
  return envelope.version === 1 && typeof envelope.iv === 'string' && typeof envelope.ciphertext === 'string'
}

export function createEncryptedStringStorage(driver: AsyncRecordDriver, keyProvider: EncryptionKeyProvider) {
  return {
    async getItem(key: string): Promise<string | null> {
      const stored = await driver.get(key)
      if (stored == null) return null
      if (!isCiphertextEnvelope(stored)) throw new EncryptedStorageCorruptError()
      try {
        const cryptoKey = await keyProvider.getOrCreate()
        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: base64ToBytes(stored.iv) },
          cryptoKey,
          base64ToBytes(stored.ciphertext),
        )
        return new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
      } catch (error) {
        if (error instanceof EncryptedStorageCorruptError) throw error
        throw new EncryptedStorageCorruptError()
      }
    },

    async setItem(key: string, value: string): Promise<void> {
      const cryptoKey = await keyProvider.getOrCreate()
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        new TextEncoder().encode(value),
      )
      await driver.set(key, { version: 1, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) } satisfies CiphertextEnvelope)
    },

    removeItem(key: string): Promise<void> {
      return driver.remove(key)
    },
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB를 사용할 수 없습니다.'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(KEY_STORE)) database.createObjectStore(KEY_STORE)
      if (!database.objectStoreNames.contains(RECORD_STORE)) database.createObjectStore(RECORD_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB를 열지 못했습니다.'))
    request.onblocked = () => reject(new Error('IndexedDB upgrade가 차단되었습니다.'))
  })
}

async function databaseOperation<T>(storeName: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const request = operation(transaction.objectStore(storeName))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 요청이 실패했습니다.'))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('IndexedDB transaction이 실패했습니다.')) }
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('IndexedDB transaction이 중단되었습니다.')) }
  })
}

const indexedDbDriver: AsyncRecordDriver = {
  get: (key) => databaseOperation(RECORD_STORE, 'readonly', (store) => store.get(key)),
  set: async (key, value) => { await databaseOperation(RECORD_STORE, 'readwrite', (store) => store.put(value, key)) },
  remove: async (key) => { await databaseOperation(RECORD_STORE, 'readwrite', (store) => store.delete(key)) },
}

let masterKeyPromise: Promise<CryptoKey> | null = null

const indexedDbKeyProvider: EncryptionKeyProvider = {
  getOrCreate() {
    masterKeyPromise ??= (async () => {
      const existing = await databaseOperation(KEY_STORE, 'readonly', (store) => store.get(MASTER_KEY_ID))
      if (existing) return existing as CryptoKey
      const generated = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      await databaseOperation(KEY_STORE, 'readwrite', (store) => store.put(generated, MASTER_KEY_ID))
      return generated
    })().catch((error) => { masterKeyPromise = null; throw error })
    return masterKeyPromise
  },
}

const persistentStorage = createEncryptedStringStorage(indexedDbDriver, indexedDbKeyProvider)
const memoryFallback = new Map<string, string>()
let persistenceHealthy = true

export const browserEncryptedPersistenceSupported = () =>
  typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && Boolean(crypto.subtle)

export const browserEncryptedPersistenceHealthy = () => browserEncryptedPersistenceSupported() && persistenceHealthy

export const browserEncryptedStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!browserEncryptedPersistenceSupported()) return memoryFallback.get(key) ?? null
    try {
      const value = await persistentStorage.getItem(key)
      if (value != null) memoryFallback.set(key, value)
      return value ?? memoryFallback.get(key) ?? null
    } catch (error) {
      persistenceHealthy = false
      if (error instanceof EncryptedStorageCorruptError) throw error
      return memoryFallback.get(key) ?? null
    }
  },

  async setItem(key: string, value: string): Promise<boolean> {
    memoryFallback.set(key, value)
    if (!browserEncryptedPersistenceSupported()) return false
    try {
      await persistentStorage.setItem(key, value)
      persistenceHealthy = true
      return true
    } catch {
      persistenceHealthy = false
      return false
    }
  },

  async removeItem(key: string): Promise<void> {
    memoryFallback.delete(key)
    if (!browserEncryptedPersistenceSupported()) return
    try { await persistentStorage.removeItem(key) } catch { persistenceHealthy = false }
  },
}

export const supabaseEncryptedStorageAdapter = {
  async getItem(key: string) {
    try { return await browserEncryptedStorage.getItem(`supabase:${key}`) }
    catch {
      await browserEncryptedStorage.removeItem(`supabase:${key}`)
      return null
    }
  },
  setItem: (key: string, value: string) => browserEncryptedStorage.setItem(`supabase:${key}`, value).then(() => undefined),
  removeItem: (key: string) => browserEncryptedStorage.removeItem(`supabase:${key}`),
}
