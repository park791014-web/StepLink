import { useCallback, useEffect, useRef, useState } from 'react'
import type { Activity, ActivityPoint, ActivityType, NativeDiagnostics, TrackingProfile } from '../models'
import type { EventSession } from '../event/eventTypes'
import { emptyDiagnostics, NativeGps, nativeGpsAvailable } from '../../infrastructure/native/nativeGps'
import { clearSession, saveSession } from '../../infrastructure/session/sessionStore'

const newId = () => globalThis.crypto?.randomUUID?.() ?? `activity-${Date.now()}`

export function useActivityTracker() {
  const [activity, setActivity] = useState<Activity | null>(null)
  const [points, setPoints] = useState<ActivityPoint[]>([])
  const [diagnostics, setDiagnostics] = useState<NativeDiagnostics>(emptyDiagnostics)
  const [recoveredCount, setRecoveredCount] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activityRef = useRef<Activity | null>(null)
  const pointsRef = useRef<ActivityPoint[]>([])
  const syncingRef = useRef(false)

  const commitActivity = useCallback((value: Activity | null) => {
    activityRef.current = value
    setActivity(value)
  }, [])

  const reconcile = useCallback(async () => {
    const current = activityRef.current
    if (!nativeGpsAvailable() || !current || syncingRef.current) return
    syncingRef.current = true
    try {
      const afterSequence = pointsRef.current.at(-1)?.sequence ?? 0
      const [pointResult, activityResult, diagnosticResult] = await Promise.all([
        NativeGps.readPoints({ activityId: current.id, afterSequence }),
        NativeGps.getActivity({ activityId: current.id }),
        NativeGps.getDiagnostics({ activityId: current.id }),
      ])
      if (activityRef.current?.id !== current.id) return
      if (pointResult.points.length > 0) {
        const known = new Set(pointsRef.current.map((point) => point.sequence))
        const additions = pointResult.points.filter((point) => !known.has(point.sequence))
        const merged = [...pointsRef.current, ...additions].sort((a, b) => a.sequence - b.sequence)
        pointsRef.current = merged
        setPoints(merged)
        setRecoveredCount((value) => value + additions.length)
      }
      commitActivity(activityResult.activity)
      setDiagnostics(diagnosticResult)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      syncingRef.current = false
    }
  }, [commitActivity])

  useEffect(() => {
    async function restore() {
      if (!nativeGpsAvailable()) { setReady(true); return }
      try {
        const result = await NativeGps.getActiveActivity()
        if (result.activity) {
          commitActivity(result.activity)
          saveSession({ kind: result.activity.eventContext?.active ? 'event-participant' : 'personal', localId: result.activity.id, eventId: result.activity.eventContext?.eventId, updatedAt: Date.now() })
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      } finally { setReady(true) }
    }
    void restore()
  }, [commitActivity])

  const activityId = activity?.id
  useEffect(() => {
    if (!activityId) return
    void reconcile()
    const interval = window.setInterval(() => void reconcile(), 5_000)
    const onVisibility = () => { if (!document.hidden) void reconcile() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisibility) }
  }, [activityId, reconcile])

  const start = useCallback(async (type: ActivityType, profile: TrackingProfile) => {
    setError(null)
    const id = newId()
    const startedAt = Date.now()
    if (nativeGpsAvailable()) {
      await NativeGps.requestPermissionsForTracking()
      await NativeGps.start({ activityId: id, activityType: type, profile })
      const result = await NativeGps.getActivity({ activityId: id })
      commitActivity(result.activity)
    } else {
      commitActivity({ id, eventId: null, source: 'PERSONAL', eventContext: null, type, status: 'ACTIVE', profile, startedAt, pausedAt: null, endedAt: null, pauseDurationMs: 0, rawDistanceM: 0, filteredDistanceM: 0, movingTimeMs: 0, stoppedTimeMs: 0, pointCount: 0 })
    }
    pointsRef.current = []
    setPoints([])
    setRecoveredCount(0)
    saveSession({ kind: 'personal', localId: id, updatedAt: Date.now() })
  }, [commitActivity])

  const pause = useCallback(async () => {
    const current = activityRef.current
    if (!current) return
    if (nativeGpsAvailable()) {
      await NativeGps.pause({ activityId: current.id })
      commitActivity((await NativeGps.getActivity({ activityId: current.id })).activity)
    } else commitActivity({ ...current, status: 'PAUSED', pausedAt: Date.now() })
  }, [commitActivity])

  const resume = useCallback(async () => {
    const current = activityRef.current
    if (!current) return
    if (nativeGpsAvailable()) {
      await NativeGps.resume({ activityId: current.id, profile: current.profile })
      commitActivity((await NativeGps.getActivity({ activityId: current.id })).activity)
    } else commitActivity({ ...current, status: 'ACTIVE', pauseDurationMs: current.pauseDurationMs + Math.max(0, Date.now() - (current.pausedAt ?? Date.now())), pausedAt: null })
  }, [commitActivity])

  const end = useCallback(async () => {
    const current = activityRef.current
    if (!current) return null
    let completed: Activity
    if (nativeGpsAvailable()) completed = (await NativeGps.end({ activityId: current.id })).activity
    else completed = { ...current, status: 'COMPLETED', endedAt: Date.now() }
    commitActivity(completed)
    clearSession()
    return completed
  }, [commitActivity])

  const ensureEventActivity = useCallback(async (session: EventSession) => {
    if (!nativeGpsAvailable() || session.role !== 'PARTICIPANT') return activityRef.current
    const result = await NativeGps.ensureEventActivity({
      eventId: session.event.id, participantId: session.subjectId, eventName: session.event.name,
      activityType: 'WALK', profile: activityRef.current?.profile ?? 'balanced',
    })
    if (activityRef.current?.id !== result.activity.id) {
      pointsRef.current = []; setPoints([]); setRecoveredCount(0)
    }
    commitActivity(result.activity)
    saveSession({ kind: 'event-participant', localId: result.activity.id, eventId: session.event.id, role: 'PARTICIPANT', updatedAt: Date.now() })
    return result.activity
  }, [commitActivity])

  const endEventActivityContext = useCallback(async (eventId: string, participantId: string) => {
    if (!nativeGpsAvailable()) return activityRef.current
    const result = await NativeGps.endEventActivityContext({ eventId, participantId })
    if (result.activity) commitActivity(result.activity)
    if (result.endedActivity) clearSession()
    else if (result.activity) saveSession({ kind: 'personal', localId: result.activity.id, updatedAt: Date.now() })
    return result.activity
  }, [commitActivity])

  const reset = useCallback(() => {
    commitActivity(null)
    pointsRef.current = []
    setPoints([])
    setRecoveredCount(0)
    setDiagnostics(emptyDiagnostics)
    clearSession()
  }, [commitActivity])

  return { activity, points, diagnostics, recoveredCount, ready, error, setError, start, pause, resume, end, ensureEventActivity, endEventActivityContext, reset, reconcile }
}
