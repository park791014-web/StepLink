import { useCallback, useEffect, useRef, useState } from 'react'
import type { CreateEventInput, EventActionResult, EventCodes, EventSession, JoinParticipantInput, SecureEventSessionSnapshot, SecureSessionSecrets } from './eventTypes'
import type { EventStatus } from '../models'
import { clearSecureEventSession, loadSecureEventSession, saveSecureEventSession, secureSessionPersistenceAvailable, secureSessionPersistenceLabel, updateSecureEventSnapshot } from '../../infrastructure/secure-session/secureEventSession'
import { eventGateway, StaleEventSessionError } from '../../infrastructure/supabase/eventGateway'

export const EVENT_LIFECYCLE_POLL_INTERVAL_MS = 5_000

const snapshotFor = (result: EventActionResult): SecureEventSessionSnapshot => ({
  eventId: result.session.event.id,
  eventName: result.session.event.name,
  role: result.session.role,
  status: result.session.event.status,
  subjectId: result.session.subjectId,
  metadata: { participantIdentifier: result.session.participantIdentifier, displayName: result.session.displayName },
  secrets: { ...result.secrets, ownerCodes: result.codes },
})

export function useEventSession() {
  const [session, setSession] = useState<EventSession | null>(null)
  const [codes, setCodes] = useState<EventCodes | null>(null)
  const [booting, setBooting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null)
  const [recoveryTarget, setRecoveryTarget] = useState<'participant' | 'operator' | null>(null)
  const [securePersistence, setSecurePersistence] = useState(secureSessionPersistenceAvailable())
  const secretRef = useRef<SecureSessionSecrets | null>(null)
  const sessionRef = useRef<EventSession | null>(null)
  const refreshInFlight = useRef(false)
  sessionRef.current = session
  const sessionEventId = session?.event.id
  const sessionEventStatus = session?.event.status

  const persist = useCallback(async (result: EventActionResult) => {
    const snapshot = snapshotFor(result)
    secretRef.current = snapshot.secrets
    setSecurePersistence(await saveSecureEventSession(snapshot))
    setSession(result.session)
    setCodes(result.codes ?? null)
  }, [])

  useEffect(() => {
    let active = true
    let storedRole: EventSession['role'] | null = null
    async function restore() {
      try {
        const stored = await loadSecureEventSession()
        setSecurePersistence(stored.persistenceAvailable ?? secureSessionPersistenceAvailable())
        if (stored.recoveryRequired) {
          setRecoveryNotice(stored.error ?? '안전한 세션을 복원할 수 없습니다. 행사 코드로 다시 연결하세요.')
          setRecoveryTarget('participant')
        }
        if (!stored.session) return
        storedRole = stored.session.role
        secretRef.current = stored.session.secrets
        const restored = await eventGateway.restore(stored.session)
        if (active) { setSession(restored); setCodes(stored.session.secrets.ownerCodes ?? null) }
        const currentSecrets = await eventGateway.currentAuthSecrets(stored.session.secrets)
        secretRef.current = currentSecrets
        setSecurePersistence(await saveSecureEventSession({ ...stored.session, eventName: restored.event.name, status: restored.event.status, subjectId: restored.subjectId, metadata: { participantIdentifier: restored.participantIdentifier, displayName: restored.displayName }, secrets: currentSecrets }))
      } catch (caught) {
        const message = caught instanceof Error && (caught.message.includes('EVENT_SESSION_INVALID') || caught.message.includes('EVENT_MEMBERSHIP_INVALID'))
          ? '저장된 행사 세션이 더 이상 유효하지 않습니다. 행사 코드로 다시 연결하세요.'
          : caught instanceof Error ? `저장된 행사 세션을 확인하지 못했습니다: ${caught.message}` : String(caught)
        await clearSecureEventSession()
        await eventGateway.signOut()
        secretRef.current = null
        if (active) { setSession(null); setCodes(null); setRecoveryNotice(message); setRecoveryTarget(storedRole === 'PARTICIPANT' ? 'participant' : 'operator') }
      } finally { if (active) setBooting(false) }
    }
    void restore()
    return () => { active = false }
  }, [])

  useEffect(() => eventGateway.onAuthChanged((authSession) => {
    const current = sessionRef.current
    const secrets = secretRef.current
    if (!current || !secrets) return
    const updated = { ...secrets, accessToken: authSession.access_token, refreshToken: authSession.refresh_token, expiresAt: authSession.expires_at ?? null }
    secretRef.current = updated
    void saveSecureEventSession({ eventId: current.event.id, eventName: current.event.name, role: current.role, status: current.event.status, subjectId: current.subjectId, metadata: { participantIdentifier: current.participantIdentifier, displayName: current.displayName }, secrets: updated }).then(setSecurePersistence)
  }), [])

  const run = useCallback(async (action: () => Promise<EventActionResult>) => {
    setBusy(true); setError(null); setCodes(null)
    try { const result = await action(); await persist(result); return result.session }
    catch (caught) { const message = caught instanceof Error ? caught.message : String(caught); setError(message); throw caught }
    finally { setBusy(false) }
  }, [persist])

  const createEvent = useCallback((input: CreateEventInput) => run(() => eventGateway.createEvent(input)), [run])
  const joinParticipant = useCallback((input: JoinParticipantInput) => run(() => eventGateway.joinParticipant(input)), [run])
  const joinOperator = useCallback((operatorCode: string) => run(() => eventGateway.joinOperator(operatorCode)), [run])

  const transition = useCallback(async (target: EventStatus) => {
    const current = sessionRef.current
    if (!current) throw new Error('진행 중인 행사 세션이 없습니다.')
    setBusy(true); setError(null)
    try {
      const event = await eventGateway.transition(current.event.id, target)
      const updated = { ...current, event }
      setSession(updated)
      setError(null)
      await updateSecureEventSnapshot(event.id, event.name, event.status, { participantIdentifier: updated.participantIdentifier, displayName: updated.displayName })
      return updated
    } catch (caught) { const message = caught instanceof Error ? caught.message : String(caught); setError(message); throw caught }
    finally { setBusy(false) }
  }, [])

  const refresh = useCallback(async () => {
    const current = sessionRef.current
    if (!current || refreshInFlight.current) return
    refreshInFlight.current = true
    try {
      const event = await eventGateway.refreshEvent(current.event.id)
      const updated = { ...current, event }
      setSession(updated)
      await updateSecureEventSnapshot(event.id, event.name, event.status, { participantIdentifier: updated.participantIdentifier, displayName: updated.displayName })
    } catch (caught) {
      if (caught instanceof StaleEventSessionError) {
        await clearSecureEventSession(current.event.id)
        await eventGateway.signOut()
        secretRef.current = null
        setSession(null); setCodes(null); setError(null)
        setRecoveryNotice(caught.message)
        setRecoveryTarget(current.role === 'PARTICIPANT' ? 'participant' : 'operator')
      } else setError(caught instanceof Error ? caught.message : String(caught))
    } finally { refreshInFlight.current = false }
  }, [])

  useEffect(() => {
    if (!sessionEventId || sessionEventStatus === 'ENDED') return
    const interval = window.setInterval(() => { if (!document.hidden) void refresh() }, EVENT_LIFECYCLE_POLL_INTERVAL_MS)
    const visible = () => { if (!document.hidden) void refresh() }
    const focused = () => void refresh()
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', focused)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', focused) }
  }, [sessionEventId, sessionEventStatus, refresh])

  const close = useCallback(async () => {
    const eventId = sessionRef.current?.event.id
    await clearSecureEventSession(eventId)
    await eventGateway.signOut()
    secretRef.current = null; setSession(null); setCodes(null); setError(null); setRecoveryTarget(null)
  }, [])

  return {
    session, codes, booting, busy, error, recoveryNotice, configured: eventGateway.configuration.configured,
    configurationMessage: eventGateway.configuration.message, securePersistence, securePersistenceLabel: secureSessionPersistenceLabel(), recoveryTarget,
    setError, dismissRecoveryNotice: () => { setRecoveryNotice(null); setRecoveryTarget(null) }, createEvent, joinParticipant, joinOperator, transition, refresh, close,
  }
}
