import { useEffect, useRef, useState } from 'react'
import { useActivityTracker } from './domain/activity/useActivityTracker'
import { useEventSession } from './domain/event/useEventSession'
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

type Screen = 'home' | 'personal' | 'participant' | 'operator' | 'settings' | 'tracker' | 'summary' | 'diagnostics' | 'event-session' | 'resume'

export default function App() {
  const tracker = useActivityTracker()
  const eventSession = useEventSession()
  const [screen, setScreen] = useState<Screen>('home')
  const [returnScreen, setReturnScreen] = useState<Screen>('home')
  const initialRouteSelected = useRef(false)
  const activeActivityId = tracker.activity?.id
  const activeActivityStatus = tracker.activity?.status

  useEffect(() => {
    if (!tracker.ready || eventSession.booting || initialRouteSelected.current) return
    initialRouteSelected.current = true
    if (eventSession.recoveryTarget) { setScreen(eventSession.recoveryTarget); return }
    const hasActivity = Boolean(activeActivityId && activeActivityStatus !== 'COMPLETED')
    const hasEvent = Boolean(eventSession.session)
    if (hasActivity && hasEvent) setScreen('resume')
    else if (hasEvent) setScreen('event-session')
    else if (hasActivity) setScreen('tracker')
  }, [tracker.ready, activeActivityId, activeActivityStatus, eventSession.booting, eventSession.session, eventSession.recoveryTarget])

  useEffect(() => {
    if (eventSession.recoveryTarget) setScreen(eventSession.recoveryTarget)
  }, [eventSession.recoveryTarget])

  const diagnostics = () => { setReturnScreen(screen); setScreen('diagnostics') }
  const home = () => { tracker.reset(); setScreen('home') }
  if (!tracker.ready || eventSession.booting) return <div className="boot-screen"><img src="/brand/steplink-mark.svg" alt=""/><strong>StepLink</strong><span>기록과 세션을 불러오는 중…</span></div>
  if (screen === 'personal') return <PersonalSetupScreen back={() => setScreen('home')} error={tracker.error} begin={async (type, profile) => { try { await tracker.start(type, profile); setScreen('tracker') } catch (error) { tracker.setError(error instanceof Error ? error.message : String(error)) } }} />
  if (screen === 'participant') return <EventEntryScreen back={() => setScreen('home')} join={async (input) => { try { await eventSession.joinParticipant(input); setScreen('event-session') } catch { /* Hook exposes a user-facing error. */ } }} busy={eventSession.busy} error={eventSession.error} configured={eventSession.configured} configurationMessage={eventSession.configurationMessage} recoveryNotice={eventSession.recoveryNotice} dismissRecoveryNotice={eventSession.dismissRecoveryNotice} />
  if (screen === 'operator') return <EventOperatorScreen back={() => setScreen('home')} create={async (input) => { try { await eventSession.createEvent(input); setScreen('event-session') } catch { /* Hook exposes a user-facing error. */ } }} join={async (code) => { try { await eventSession.joinOperator(code); setScreen('event-session') } catch { /* Hook exposes a user-facing error. */ } }} busy={eventSession.busy} error={eventSession.error} configured={eventSession.configured} configurationMessage={eventSession.configurationMessage} recoveryNotice={eventSession.recoveryNotice} dismissRecoveryNotice={eventSession.dismissRecoveryNotice} />
  if (screen === 'event-session' && eventSession.session) return <EventSessionScreen session={eventSession.session} codes={eventSession.codes} busy={eventSession.busy} error={eventSession.error} securePersistence={eventSession.securePersistence} securePersistenceLabel={eventSession.securePersistenceLabel} transition={async (status) => { await eventSession.transition(status) }} refresh={eventSession.refresh} close={async () => { await eventSession.close(); setScreen('home') }} />
  if (screen === 'resume' && tracker.activity && eventSession.session) return <ResumeSelectorScreen activity={tracker.activity} eventSession={eventSession.session} choose={(target) => setScreen(target === 'event' ? 'event-session' : 'tracker')} />
  if (screen === 'settings') return <SettingsScreen back={() => setScreen('home')} diagnostics={diagnostics} />
  if (screen === 'diagnostics') return <DiagnosticsScreen back={() => setScreen(returnScreen)} activity={tracker.activity} data={tracker.diagnostics} uiPoints={tracker.points.length} recovered={tracker.recoveredCount} />
  if (screen === 'tracker' && tracker.activity) return <TrackerScreen activity={tracker.activity} points={tracker.points} diagnostics={tracker.diagnostics} recoveredCount={tracker.recoveredCount} pause={tracker.pause} resume={tracker.resume} end={tracker.end} showDiagnostics={diagnostics} onEnded={() => setScreen('summary')} />
  if (screen === 'summary' && tracker.activity) return <SummaryScreen activity={tracker.activity} points={tracker.points} done={home} />
  return <HomeScreen navigate={setScreen} />
}
