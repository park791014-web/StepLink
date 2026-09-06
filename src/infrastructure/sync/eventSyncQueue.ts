import { Capacitor, registerPlugin } from '@capacitor/core'
import { queuePayloadMatchesScope } from './syncPolicy'

export type SyncKind = 'LIVE_STATE' | 'HELP_REQUEST'
export interface SyncItem<T = Record<string, unknown>> {
  id: number
  kind: SyncKind
  idempotencyKey: string
  latestWinsKey: string | null
  payload: T
  attemptCount: number
  nextAttemptAt?: number | null
}

export interface LiveSyncStatus {
  enabled: boolean
  apiBaseUrl?: string
  managerStartedAt: number | null
  lastLocationAt: number | null
  lastSuccessAt: number | null
  lastSendSuccessAt?: number | null
  lastReceiveSuccessAt?: number | null
  lastHttpStatus?: number | null
  lastError?: string | null
  lastStage?: string | null
  lastEndpoint?: string | null
  failedEndpoint?: string | null
  lastClientSequence: number
  pendingLiveCount: number
  pendingHelpCount: number
  latitude?: number
  longitude?: number
  accuracyM?: number | null
  distanceM?: number
  elapsedTimeMs?: number
}

interface NativeQueue {
  enqueueLatest(options: { kind: SyncKind; idempotencyKey: string; latestWinsKey: string; payload: Record<string, unknown> }): Promise<void>
  enqueueDurable(options: { kind: SyncKind; idempotencyKey: string; payload: Record<string, unknown> }): Promise<void>
  ready(options: { limit: number }): Promise<{ items: SyncItem[] }>
  complete(options: { id: number }): Promise<void>
  retry(options: { id: number; nextAttemptAt: number }): Promise<void>
  terminal(options: { id: number; reason: string }): Promise<void>
  discardLatest(options: { latestWinsKey: string }): Promise<void>
  reconcileScope(options: { eventId: string; participantId: string }): Promise<void>
  configureLiveSync(options: { supabaseUrl: string; anonKey: string; eventId: string; participantId: string; intervalMs: number }): Promise<void>
  disableLiveSync(): Promise<void>
  getLiveSyncStatus(): Promise<LiveSyncStatus>
}

const NativeSyncQueue = registerPlugin<NativeQueue>('EventSyncQueue')
let memoryId = 0
let memoryItems: SyncItem[] = []
const isAndroid = () => Capacitor.getPlatform() === 'android'

export const eventSyncQueue = {
  durable: isAndroid(),
  async enqueueLatest(kind: SyncKind, idempotencyKey: string, latestWinsKey: string, payload: Record<string, unknown>) {
    if (isAndroid()) return NativeSyncQueue.enqueueLatest({ kind, idempotencyKey, latestWinsKey, payload })
    memoryItems = [...memoryItems.filter((item) => item.latestWinsKey !== latestWinsKey), { id: ++memoryId, kind, idempotencyKey, latestWinsKey, payload, attemptCount: 0 }]
  },
  async enqueueDurable(kind: SyncKind, idempotencyKey: string, payload: Record<string, unknown>) {
    if (isAndroid()) return NativeSyncQueue.enqueueDurable({ kind, idempotencyKey, payload })
    if (!memoryItems.some((item) => item.idempotencyKey === idempotencyKey)) memoryItems.push({ id: ++memoryId, kind, idempotencyKey, latestWinsKey: null, payload, attemptCount: 0 })
  },
  async ready(limit = 10) { const now = Date.now(); return isAndroid() ? (await NativeSyncQueue.ready({ limit })).items : memoryItems.filter((item) => !item.nextAttemptAt || item.nextAttemptAt <= now).slice(0, limit) },
  async complete(id: number) { if (isAndroid()) return NativeSyncQueue.complete({ id }); memoryItems = memoryItems.filter((item) => item.id !== id) },
  async retry(item: SyncItem, delayMs: number) {
    if (isAndroid()) return NativeSyncQueue.retry({ id: item.id, nextAttemptAt: Date.now() + delayMs })
    const found = memoryItems.find((candidate) => candidate.id === item.id); if (found) { found.attemptCount += 1; found.nextAttemptAt = Date.now() + delayMs }
  },
  async terminal(id: number, reason: string) {
    if (isAndroid()) return NativeSyncQueue.terminal({ id, reason })
    memoryItems = memoryItems.filter((item) => item.id !== id)
    console.warn('StepLink sync item terminal', { id, reason })
  },
  async discardLatest(latestWinsKey: string) { if (isAndroid()) return NativeSyncQueue.discardLatest({ latestWinsKey }); memoryItems = memoryItems.filter((item) => item.latestWinsKey !== latestWinsKey) },
  async reconcileScope(eventId: string, participantId: string) {
    if (isAndroid()) return NativeSyncQueue.reconcileScope({ eventId, participantId })
    const stale = memoryItems.filter((item) => !queuePayloadMatchesScope(item.payload, eventId, participantId))
    for (const item of stale) console.warn('StepLink stale operational queue item removed', { id: item.id, kind: item.kind })
    memoryItems = memoryItems.filter((item) => queuePayloadMatchesScope(item.payload, eventId, participantId))
  },
  async configureLiveSync(options: { supabaseUrl: string; anonKey: string; eventId: string; participantId: string; intervalMs: number }) {
    if (isAndroid()) await NativeSyncQueue.configureLiveSync(options)
  },
  async disableLiveSync() { if (isAndroid()) await NativeSyncQueue.disableLiveSync() },
  async getLiveSyncStatus(): Promise<LiveSyncStatus | null> {
    return isAndroid() ? NativeSyncQueue.getLiveSyncStatus() : null
  },
}
