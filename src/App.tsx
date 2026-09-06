import { useCallback, useEffect, useRef, useState } from 'react'
import { useActivityTracker } from './domain/activity/useActivityTracker'
import { useEventSession } from './domain/event/useEventSession'
import { usePhase3Operations } from './domain/live/usePhase3Operations'
import { DiagnosticsScreen } from './screens/DiagnosticsScreen'
import { EventEntryScreen } from './screens/EventEntryScreen'
import { EventOperatorScreen } from './screens/EventOperatorScreen'
import { EventSessionScreen } from './screens/EventSessionScreen'
import { HomeScreen } from './screens/HomeScreen'
import { PersonalSetupScreen } from './screens/PersonalSetupScreen'
import { ResumeSelectorScreen } from './screens/ResumeSelectorScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SummaryScreen } from './screens/SummaryScreen'
import { TrackerScreen } from './screens/TrackerScreen'
import { ActivityHistoryScreen } from './screens/ActivityHistoryScreen'
import type { Activity, ActivityPoint } from './domain/models'
import { exitNativeApp, setRoleOrientation } from './infrastructure/native/appUi'

type Screen = 'home' | 'personal' | 'participant' | 'operator' | 'settings' | 'tracker' | 'summary' | 'diagnostics' | 'event-session' | 'resume' | 'menu' | 'history' | 'history-summary'

const initialWebScreen = (): Screen => {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  return path === '/operator' || path === '/owner' ? 'operator' : 'home'
}

export default function App() {
  const tracker = useActivityTracker()
  const eventSession = useEventSession()
  const phase3 = usePhase3Operations({
    session: eventSession.session,
    activity: tracker.activity,
    latestPoint: tracker.points.at(-1) ?? null,
    ensureEventActivity: tracker.ensureEventActivity,
    endEventActivityContext: tracker.endEventActivityContext,
  })
  const initialScreen = initialWebScreen()
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [returnScreen, setReturnScreen] = useState<Screen>('home')
  const [historyDetail, setHistoryDetail] = useState<{ activity: Activity; points: ActivityPoint[] } | null>(null)
  const navigationStack = useRef<Screen[]>([])
  const screenRef = useRef<Screen>(initialScreen)
  const initialRouteSelected = useRef(false)
  const activeActivityId = tracker.activity?.id
  const activeActivityStatus = tracker.activity?.status

  const navigate = useCallback((target: Screen, replace = false) => {
    if (target === screenRef.current) return
    if (!replace) navigationStack.current.push(screenRef.current)
    screenRef.current = target
    setScreen(target)
  }, [])

  const back = useCallback((fallback: Screen = 'home') => {
    const previous = navigationStack.current.pop()
    if (previous) {
      screenRef.current = previous
      setScreen(previous)
    } else if (screenRef.current !== 'home') {
      screenRef.current = fallback
      setScreen(fallback)
    } else void exitNativeApp()
  }, [])

  useEffect(() => {
    const onBack = () => back('home')
    window.addEventListener('steplink:back', onBack)
    return () => window.removeEventListener('steplink:back', onBack)
  }, [back])

  useEffect(() => {
    const flexible = screen === 'operator' || (screen === 'event-session' && eventSession.session?.role !== 'PARTICIPANT')
    void setRoleOrientation(flexible)
  }, [screen, eventSession.session?.role])

  useEffect(() => {
    if (!tracker.ready || eventSession.booting || initialRouteSelected.current) return
    initialRouteSelected.current = true
    if (eventSession.recoveryTarget) { navigate(eventSession.recoveryTarget); return }
    const hasActivity = Boolean(activeActivityId && activeActivityStatus !== 'COMPLETED')
    const hasEvent = Boolean(eventSession.session)
    const unifiedParticipantWalk = hasActivity && eventSession.session?.role === 'PARTICIPANT' && eventSession.session.event.status === 'ACTIVE' && tracker.activity?.eventContext?.active
    if (unifiedParticipantWalk) navigate('tracker')
    else if (hasActivity && hasEvent) navigate('resume')
    else if (hasEvent) navigate('event-session')
    else if (hasActivity) navigate('tracker')
  }, [tracker.ready, tracker.activity?.eventContext?.active, activeActivityId, activeActivityStatus, eventSession.booting, eventSession.session, eventSession.recoveryTarget, navigate])

  useEffect(() => {
    if (eventSession.recoveryTarget) navigate(eventSession.recoveryTarget)
  }, [eventSession.recoveryTarget, navigate])

  useEffect(() => {
    const current = eventSession.session
    const context = tracker.activity?.eventContext
    if (current?.role === 'PARTICIPANT' && current.event.status === 'ACTIVE' && context?.active
      && context.eventId === current.event.id && (screen === 'event-session' || screen === 'resume')) navigate('tracker')
  }, [eventSession.session, tracker.activity?.eventContext, screen, navigate])

  const diagnostics = () => { setReturnScreen(screen); navigate('diagnostics') }
  const home = () => { tracker.reset(); navigationStack.current = []; navigate('home', true) }
  if (!tracker.ready || eventSession.booting) return <div className="boot-screen"><img src="/brand/steplink-mark.svg" alt=""/><strong>StepLink</strong><span>기록과 세션을 불러오는 중…</span></div>
  if (screen === 'personal') return <PersonalSetupScreen back={() => back()} error={tracker.error} begin={async (type, profile) => { try { await tracker.start(type, profile); navigate('tracker') } catch (error) { tracker.setError(error instanceof Error ? error.message : String(error)) } }} />
  if (screen === 'participant') return <EventEntryScreen back={() => back()} join={async (input) => { try { await eventSession.joinParticipant(input); navigate('event-session') } catch { /* Hook exposes a user-facing error. */ } }} busy={eventSession.busy} error={eventSession.error} configured={eventSession.configured} configurationMessage={eventSession.configurationMessage} recoveryNotice={eventSession.recoveryNotice} dismissRecoveryNotice={eventSession.dismissRecoveryNotice} />
  if (screen === 'operator') return <EventOperatorScreen back={() => back()} create={async (input) => { try { await eventSession.createEvent(input); navigate('event-session') } catch { /* Hook exposes a user-facing error. */ } }} join={async (code) => { try { await eventSession.joinOperator(code); navigate('event-session') } catch { /* Hook exposes a user-facing error. */ } }} busy={eventSession.busy} error={eventSession.error} configured={eventSession.configured} configurationMessage={eventSession.configurationMessage} recoveryNotice={eventSession.recoveryNotice} dismissRecoveryNotice={eventSession.dismissRecoveryNotice} />
  if (screen === 'event-session' && eventSession.session) return <EventSessionScreen session={eventSession.session} codes={eventSession.codes} busy={eventSession.busy || phase3.busy} eventError={eventSession.error || tracker.error} operationsError={phase3.error} securePersistence={eventSession.securePersistence} securePersistenceLabel={eventSession.securePersistenceLabel} transition={async (status) => { await eventSession.transition(status) }} refresh={async () => { await Promise.all([eventSession.refresh(), phase3.refreshOperations()]) }} close={async () => { const current = eventSession.session; if (current?.role === 'PARTICIPANT' && tracker.activity?.eventContext?.active) await tracker.endEventActivityContext(current.event.id, current.subjectId); await eventSession.close(); navigationStack.current = []; navigate('home', true) }} phase3={phase3} showActivity={tracker.activity?.eventContext?.eventId === eventSession.session.event.id ? () => navigate('tracker') : undefined} />
  if (screen === 'resume' && tracker.activity && eventSession.session) return <ResumeSelectorScreen activity={tracker.activity} eventSession={eventSession.session} choose={(target) => navigate(target === 'event' ? 'event-session' : 'tracker')} />
  if (screen === 'menu') return <HomeScreen activeOwnerEvent={eventSession.session?.role === 'OWNER' && eventSession.session.event.status === 'ACTIVE' ? { name: eventSession.session.event.name } : undefined} back={() => back('tracker')} navigate={(target) => { setReturnScreen('tracker'); navigate(target === 'personal' ? 'tracker' : target) }} />
  if (screen === 'history') return <ActivityHistoryScreen back={() => back(returnScreen)} open={(activity, points) => { setHistoryDetail({ activity, points }); navigate('history-summary') }} />
  if (screen === 'history-summary' && historyDetail) return <SummaryScreen activity={historyDetail.activity} points={historyDetail.points} done={() => back('history')} doneLabel="목록으로" />
  if (screen === 'settings') return <SettingsScreen back={() => back(tracker.activity?.status === 'ACTIVE' || tracker.activity?.status === 'PAUSED' ? 'tracker' : 'home')} diagnostics={diagnostics} />
  if (screen === 'diagnostics') return <DiagnosticsScreen back={() => back(returnScreen)} activity={tracker.activity} data={tracker.diagnostics} uiPoints={tracker.points.length} recovered={tracker.recoveredCount} />
  if (screen === 'tracker' && tracker.activity) {
    const activeParticipantEvent = eventSession.session?.role === 'PARTICIPANT' && eventSession.session.event.status === 'ACTIVE' && tracker.activity.eventContext?.eventId === eventSession.session.event.id
    return <TrackerScreen activity={tracker.activity} points={tracker.points} peerLocations={activeParticipantEvent ? phase3.peerLocations : undefined} eventMessages={activeParticipantEvent ? phase3.messages : undefined} activeHelp={activeParticipantEvent ? phase3.activeHelp : null} eventBusy={phase3.busy} eventError={activeParticipantEvent ? phase3.error : null} requestHelp={activeParticipantEvent ? phase3.requestHelp : undefined} pause={tracker.pause} resume={tracker.resume} end={tracker.end} onEnded={() => navigate('summary')} openMenu={() => navigate('menu')} openSettings={() => navigate('settings')} />
  }
  if (screen === 'summary' && tracker.activity) return <SummaryScreen activity={tracker.activity} points={tracker.points} done={home} />
  return <HomeScreen activeOwnerEvent={eventSession.session?.role === 'OWNER' && eventSession.session.event.status === 'ACTIVE' ? { name: eventSession.session.event.name } : undefined} navigate={(target) => { setReturnScreen('home'); navigate(target) }} />
}
