import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Activity, ActivityPoint } from '../models'
import type { EventSession } from '../event/eventTypes'
import type { DashboardParticipant, EventMessage, HelpRequest, HelpType, PeerLocation } from './liveTypes'
import type { HelpStatus, MessageTargetType } from './livePolicy'
import { DASHBOARD_POLL_INTERVAL_MS, LIVE_UPLOAD_INTERVAL_MS, PARTICIPANT_FEED_POLL_INTERVAL_MS, configuredInterval, nextRetryDelayMs, shouldEnableNativeLiveSync, shouldUploadLiveState } from './livePolicy'
import { eventGateway } from '../../infrastructure/supabase/eventGateway'
import { eventSyncQueue, type SyncItem } from '../../infrastructure/sync/eventSyncQueue'
import { supabasePublicConfiguration } from '../../infrastructure/supabase/supabaseClient'
import { NativeGps, nativeGpsAvailable } from '../../infrastructure/native/nativeGps'
import { friendlyOperationalError, queuePayloadMatchesScope, syncFailureDisposition, type OperationalErrorOrigin } from '../../infrastructure/sync/syncPolicy'
import type { LiveSyncStatus } from '../../infrastructure/sync/eventSyncQueue'

interface Options {
  session: EventSession | null
  activity: Activity | null
  latestPoint: ActivityPoint | null
  ensureEventActivity: (session: EventSession) => Promise<Activity | null>
  endEventActivityContext: (eventId: string, participantId: string) => Promise<Activity | null>
}
const uploadInterval = configuredInterval(import.meta.env.VITE_LIVE_UPLOAD_INTERVAL_MS, LIVE_UPLOAD_INTERVAL_MS, 1_000)

export function usePhase3Operations({ session, activity, latestPoint, ensureEventActivity, endEventActivityContext }: Options) {
  const [participants, setParticipants] = useState<DashboardParticipant[]>([])
  const [messages, setMessages] = useState<EventMessage[]>([])
  const [helpRequests, setHelpRequests] = useState<HelpRequest[]>([])
  const [peerLocations, setPeerLocations] = useState<PeerLocation[]>([])
  const [busy, setBusy] = useState(false)
  const [lastUploadedAt, setLastUploadedAt] = useState<string | null>(null)
  const [liveSyncStatus, setLiveSyncStatus] = useState<LiveSyncStatus | null>(null)
  const [operationErrors, setOperationErrors] = useState<Partial<Record<OperationalErrorOrigin, string>>>({})
  const draining = useRef(false)
  const liveUploadBlocked = useRef(false)
  const drainRef = useRef<() => Promise<void>>(async () => undefined)
  const retryTimer = useRef<number | null>(null)
  const latestState = useRef({ session, activity, latestPoint })
  latestState.current = { session, activity, latestPoint }

  const liveKey = session?.role === 'PARTICIPANT' ? `live:${session.event.id}:${session.subjectId}` : null
  const sessionEventId = session?.event.id
  const sessionEventStatus = session?.event.status
  const sessionRole = session?.role
  const sessionSubjectId = session?.subjectId

  const reportError = useCallback((origin: OperationalErrorOrigin, caught: unknown) => {
    const detail = caught instanceof Error ? caught.message : String(caught)
    console.warn('StepLink operational error', { origin, detail })
    setOperationErrors((current) => ({ ...current, [origin]: detail }))
  }, [])

  const clearError = useCallback((origin: OperationalErrorOrigin) => {
    setOperationErrors((current) => { const next = { ...current }; delete next[origin]; return next })
  }, [])

  const drain = useCallback(async () => {
    if (!eventGateway.configuration.configured || draining.current) return
    draining.current = true
    try {
      for (const item of await eventSyncQueue.ready(10)) {
        const current = latestState.current.session
        if (!current || current.role !== 'PARTICIPANT' || !queuePayloadMatchesScope(item.payload, current.event.id, current.subjectId)) {
          if (item.kind === 'HELP_REQUEST') await eventSyncQueue.terminal(item.id, 'session_scope_changed')
          else await eventSyncQueue.complete(item.id)
          continue
        }
        try {
          if (item.kind === 'LIVE_STATE') {
            const payload = item.payload as unknown as Parameters<typeof eventGateway.uploadLiveState>[0]
            const result = await eventGateway.uploadLiveState(payload)
            setLastUploadedAt(result.lastReceivedAt); clearError('live_state')
          } else if (item.kind === 'HELP_REQUEST') {
            const payload = item.payload as { eventId: string; participantId: string; type: HelpType; latitude: number | null; longitude: number | null; accuracyM: number | null }
            await eventGateway.createHelp(payload.eventId, payload.participantId, payload.type, payload, item.idempotencyKey); clearError('help_request')
          }
          await eventSyncQueue.complete(item.id)
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : String(caught)
          if (item.kind === 'LIVE_STATE' && /EVENT_NOT_ACTIVE|PARTICIPANT_SCOPE_DENIED|AUTH_REQUIRED/.test(message)) { liveUploadBlocked.current = true; await eventSyncQueue.complete(item.id) }
          else if (syncFailureDisposition(caught) === 'TERMINAL') await eventSyncQueue.terminal(item.id, message.slice(0, 160))
          else {
            const delay = nextRetryDelayMs(item.attemptCount)
            await eventSyncQueue.retry(item as SyncItem, delay)
            if (retryTimer.current != null) window.clearTimeout(retryTimer.current)
            retryTimer.current = window.setTimeout(() => void drainRef.current(), delay)
          }
          reportError(item.kind === 'HELP_REQUEST' ? 'help_request' : 'live_state', caught)
        }
      }
    } finally { draining.current = false }
  }, [clearError, reportError])
  drainRef.current = drain

  const queueCurrentState = useCallback(async () => {
    const current = latestState.current
    if (liveUploadBlocked.current || !current.session || !current.latestPoint || !liveKey || !shouldUploadLiveState(current.session.event.status, current.session.role, true)) return
    const payload = {
      eventId: current.session.event.id, participantId: current.session.subjectId,
      latitude: current.latestPoint.latitude, longitude: current.latestPoint.longitude,
      accuracyM: current.latestPoint.accuracy,
      distanceM: current.activity?.filteredDistanceM ?? 0,
      elapsedTimeMs: (current.activity?.movingTimeMs ?? 0) + (current.activity?.stoppedTimeMs ?? 0),
      clientSequence: current.latestPoint.sequence,
    }
    await eventSyncQueue.enqueueLatest('LIVE_STATE', `${liveKey}:${payload.clientSequence}`, liveKey, payload)
    await drain()
  }, [drain, liveKey])

  useEffect(() => {
    if (!session || !liveKey) return
    if (session.event.status !== 'ACTIVE') { void eventSyncQueue.discardLatest(liveKey); return }
    if (nativeGpsAvailable()) return
    void queueCurrentState()
    const timer = window.setInterval(() => void queueCurrentState(), uploadInterval)
    const wake = () => { if (!document.hidden) void drain() }
    window.addEventListener('online', wake); document.addEventListener('visibilitychange', wake)
    return () => { window.clearInterval(timer); window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake) }
  }, [session, liveKey, queueCurrentState, drain])

  useEffect(() => {
    if (!nativeGpsAvailable()) return
    if (sessionEventId && sessionSubjectId && sessionEventStatus && sessionRole && shouldEnableNativeLiveSync(sessionEventStatus, sessionRole, eventGateway.configuration.configured)) {
      void (async () => {
        const permission = await NativeGps.requestPermissionsForTracking()
        if (permission.location !== 'granted') throw new Error('LOCATION_PERMISSION_REQUIRED')
        const currentSession = latestState.current.session
        if (!currentSession || currentSession.role !== 'PARTICIPANT' || currentSession.event.status !== 'ACTIVE') return
        await ensureEventActivity(currentSession)
        const confirmedSession = latestState.current.session
        if (!confirmedSession || confirmedSession.role !== 'PARTICIPANT' || confirmedSession.event.status !== 'ACTIVE'
          || confirmedSession.event.id !== sessionEventId || confirmedSession.subjectId !== sessionSubjectId) {
          await eventSyncQueue.disableLiveSync()
          await endEventActivityContext(sessionEventId, sessionSubjectId)
          return
        }
        await eventSyncQueue.reconcileScope(sessionEventId, sessionSubjectId)
        await eventSyncQueue.configureLiveSync({
          supabaseUrl: supabasePublicConfiguration.url, anonKey: supabasePublicConfiguration.anonKey,
          eventId: sessionEventId, participantId: sessionSubjectId, intervalMs: uploadInterval,
        })
        setLiveSyncStatus(await eventSyncQueue.getLiveSyncStatus()); clearError('native_manager')
      })().catch((caught) => reportError('native_manager', caught))
    } else if (sessionRole !== 'PARTICIPANT' || sessionEventStatus !== 'ACTIVE') {
      void (async () => {
        await eventSyncQueue.disableLiveSync(); setLiveSyncStatus(null)
        if (sessionRole === 'PARTICIPANT' && sessionEventStatus === 'ENDED' && sessionEventId && sessionSubjectId) {
          await endEventActivityContext(sessionEventId, sessionSubjectId)
        }
      })().catch((caught) => reportError('native_manager', caught))
    }
  }, [sessionEventId, sessionEventStatus, sessionRole, sessionSubjectId, clearError, reportError, ensureEventActivity, endEventActivityContext])

  useEffect(() => {
    if (!nativeGpsAvailable() || session?.role !== 'PARTICIPANT' || session.event.status !== 'ACTIVE') return
    const refreshStatus = async () => {
      try {
        const status = await eventSyncQueue.getLiveSyncStatus()
        setLiveSyncStatus(status)
        if (status?.lastSuccessAt) setLastUploadedAt(new Date(status.lastSuccessAt).toISOString())
      } catch (caught) { reportError('native_manager', caught) }
    }
    void refreshStatus()
    const timer = window.setInterval(() => void refreshStatus(), 5_000)
    return () => window.clearInterval(timer)
  }, [session?.event.id, session?.event.status, session?.role, reportError])

  useEffect(() => { liveUploadBlocked.current = false }, [session?.event.id, session?.subjectId])

  const refreshOperations = useCallback(async () => {
    const current = latestState.current.session
    if (!current || !eventGateway.configuration.configured) return
    try {
      if (current.role === 'PARTICIPANT') {
        const [feed, peers] = await Promise.all([
          eventGateway.fetchParticipantFeed(current.event.id, current.subjectId),
          eventGateway.fetchParticipantPeerLocations(current.event.id, current.subjectId).catch((caught) => {
            console.warn('StepLink peer locations unavailable', { detail: caught instanceof Error ? caught.message : String(caught) })
            return []
          }),
        ])
        setMessages(feed.messages); setHelpRequests(feed.helpRequests); clearError('participant_feed')
        setPeerLocations(peers)
      } else setParticipants(await eventGateway.fetchDashboard(current.event.id))
    } catch (caught) { reportError(current.role === 'PARTICIPANT' ? 'participant_feed' : 'event_status', caught) }
  }, [clearError, reportError])

  useEffect(() => {
    if (!session) return
    void refreshOperations()
    const interval = session.role === 'PARTICIPANT' ? PARTICIPANT_FEED_POLL_INTERVAL_MS : DASHBOARD_POLL_INTERVAL_MS
    if (session.event.status === 'ENDED') return
    const poll = () => { if (!document.hidden) void refreshOperations() }
    const timer = window.setInterval(poll, interval)
    const visible = () => { if (!document.hidden) void refreshOperations() }
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [session, refreshOperations])

  const requestHelp = useCallback(async (type: HelpType) => {
    const current = latestState.current
    if (!current.session || current.session.role !== 'PARTICIPANT') return
    const idempotencyKey = crypto.randomUUID()
    const payload = {
      eventId: current.session.event.id, participantId: current.session.subjectId, type,
      latitude: current.latestPoint?.latitude ?? null, longitude: current.latestPoint?.longitude ?? null,
      accuracyM: current.latestPoint?.accuracy ?? null,
    }
    setBusy(true)
    try { await eventSyncQueue.enqueueDurable('HELP_REQUEST', idempotencyKey, payload); await drain(); await refreshOperations() }
    catch (caught) { reportError('help_request', caught) }
    finally { setBusy(false) }
  }, [drain, refreshOperations, reportError])

  const sendMessage = useCallback(async (targetType: MessageTargetType, targetValue: string | null, body: string, ids: string[]) => {
    const current = latestState.current.session
    if (!current || current.role === 'PARTICIPANT') return
    setBusy(true); clearError('event_status')
    try { await eventGateway.sendMessage(current.event.id, targetType, targetValue, body, ids) }
    catch (caught) { reportError('event_status', caught); throw caught }
    finally { setBusy(false) }
  }, [clearError, reportError])

  const transitionHelp = useCallback(async (requestId: string, status: HelpStatus) => {
    setBusy(true); clearError('help_request')
    try { await eventGateway.transitionHelp(requestId, status); await refreshOperations() }
    catch (caught) { reportError('help_request', caught); throw caught }
    finally { setBusy(false) }
  }, [clearError, refreshOperations, reportError])

  const activeHelp = useMemo(() => helpRequests.find((item) => item.status !== 'RESOLVED') ?? null, [helpRequests])
  const error = useMemo(() => {
    const origins: OperationalErrorOrigin[] = ['native_manager', 'live_state', 'help_request', 'participant_feed', 'event_status', 'token_refresh']
    const origin = origins.find((candidate) => operationErrors[candidate])
    return origin ? friendlyOperationalError(origin, new Error(operationErrors[origin]!), navigator.onLine) : null
  }, [operationErrors])
  useEffect(() => () => { if (retryTimer.current != null) window.clearTimeout(retryTimer.current) }, [])
  return { participants, messages, helpRequests, peerLocations, activeHelp, error, operationErrors, busy, lastUploadedAt, liveSyncStatus, queueDurable: eventSyncQueue.durable, requestHelp, sendMessage, transitionHelp, refreshOperations }
}
