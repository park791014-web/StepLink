import { useEffect, useState } from 'react'
import { useActivityTracker } from './domain/activity/useActivityTracker'
import { DiagnosticsScreen } from './screens/DiagnosticsScreen'
import { EventEntryScreen } from './screens/EventEntryScreen'
import { HomeScreen } from './screens/HomeScreen'
import { PersonalSetupScreen } from './screens/PersonalSetupScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SummaryScreen } from './screens/SummaryScreen'
import { TrackerScreen } from './screens/TrackerScreen'

type Screen = 'home' | 'personal' | 'participant' | 'operator' | 'settings' | 'tracker' | 'summary' | 'diagnostics'

export default function App() {
  const tracker = useActivityTracker()
  const [screen, setScreen] = useState<Screen>('home')
  const [returnScreen, setReturnScreen] = useState<Screen>('home')
  const activeActivityId = tracker.activity?.id
  const activeActivityStatus = tracker.activity?.status

  useEffect(() => {
    if (tracker.ready && activeActivityId && activeActivityStatus !== 'COMPLETED') setScreen('tracker')
  }, [tracker.ready, activeActivityId, activeActivityStatus])

  const diagnostics = () => { setReturnScreen(screen); setScreen('diagnostics') }
  const home = () => { tracker.reset(); setScreen('home') }
  if (!tracker.ready) return <div className="boot-screen"><img src="/brand/steplink-mark.svg" alt=""/><strong>StepLink</strong><span>기록을 불러오는 중…</span></div>
  if (screen === 'personal') return <PersonalSetupScreen back={() => setScreen('home')} error={tracker.error} begin={async (type, profile) => { try { await tracker.start(type, profile); setScreen('tracker') } catch (error) { tracker.setError(error instanceof Error ? error.message : String(error)) } }} />
  if (screen === 'participant' || screen === 'operator') return <EventEntryScreen mode={screen} back={() => setScreen('home')} />
  if (screen === 'settings') return <SettingsScreen back={() => setScreen('home')} diagnostics={diagnostics} />
  if (screen === 'diagnostics') return <DiagnosticsScreen back={() => setScreen(returnScreen)} activity={tracker.activity} data={tracker.diagnostics} uiPoints={tracker.points.length} recovered={tracker.recoveredCount} />
  if (screen === 'tracker' && tracker.activity) return <TrackerScreen activity={tracker.activity} points={tracker.points} diagnostics={tracker.diagnostics} recoveredCount={tracker.recoveredCount} pause={tracker.pause} resume={tracker.resume} end={tracker.end} showDiagnostics={diagnostics} onEnded={() => setScreen('summary')} />
  if (screen === 'summary' && tracker.activity) return <SummaryScreen activity={tracker.activity} points={tracker.points} done={home} />
  return <HomeScreen navigate={setScreen} />
}
