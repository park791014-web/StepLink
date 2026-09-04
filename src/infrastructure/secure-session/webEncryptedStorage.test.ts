import assert from 'node:assert/strict'
import test from 'node:test'
import type { SecureEventSessionSnapshot } from '../../domain/event/eventTypes'
import { createEncryptedStringStorage, EncryptedStorageCorruptError, type AsyncRecordDriver, type EncryptionKeyProvider } from './webEncryptedStorage.ts'

class MemoryDriver implements AsyncRecordDriver {
  readonly values = new Map<string, unknown>()
  async get(key: string) { return this.values.get(key) }
  async set(key: string, value: unknown) { this.values.set(key, value) }
  async remove(key: string) { this.values.delete(key) }
}

const keyProvider = (): EncryptionKeyProvider => {
  let key: CryptoKey | null = null
  return {
    async getOrCreate() {
      key ??= await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      return key
    },
  }
}

const snapshot = (role: SecureEventSessionSnapshot['role']): SecureEventSessionSnapshot => ({
  eventId: '5a354eb1-8136-4fef-bdc7-43c5c983406e',
  eventName: 'Test2',
  role,
  status: 'ACTIVE',
  subjectId: `${role.toLowerCase()}-subject`,
  metadata: role === 'PARTICIPANT' ? { participantIdentifier: '20315', displayName: '참가자' } : {},
  secrets: {
    accessToken: `access-${role}`,
    refreshToken: `refresh-${role}`,
    eventSessionToken: `event-${role}`,
    expiresAt: 1_800_000_000,
    ...(role === 'OWNER' ? { ownerCodes: { participantCode: '5VNCF', operatorCode: '5VNCFB' } } : {}),
  },
})

test('encrypted web storage round-trips participant, operator, and owner sessions without plaintext records', async () => {
  const driver = new MemoryDriver()
  const storage = createEncryptedStringStorage(driver, keyProvider())

  for (const role of ['PARTICIPANT', 'OPERATOR', 'OWNER'] as const) {
    const expected = snapshot(role)
    await storage.setItem(role, JSON.stringify(expected))
    const persistentRecord = JSON.stringify(driver.values.get(role))
    assert.equal(persistentRecord.includes(expected.secrets.accessToken), false)
    assert.equal(persistentRecord.includes(expected.secrets.refreshToken), false)
    assert.equal(persistentRecord.includes(expected.secrets.eventSessionToken), false)
    assert.equal(persistentRecord.includes('5VNCF'), false)
    assert.deepEqual(JSON.parse((await storage.getItem(role))!), expected)
  }
})

test('encrypted web storage removes records and reports corrupt ciphertext without returning plaintext', async () => {
  const driver = new MemoryDriver()
  const storage = createEncryptedStringStorage(driver, keyProvider())
  await storage.setItem('session', JSON.stringify(snapshot('PARTICIPANT')))
  const record = driver.values.get('session') as { ciphertext: string }
  driver.values.set('session', { ...record, ciphertext: `${record.ciphertext.slice(0, -2)}AA` })

  await assert.rejects(() => storage.getItem('session'), EncryptedStorageCorruptError)
  await storage.removeItem('session')
  assert.equal(await storage.getItem('session'), null)
})
