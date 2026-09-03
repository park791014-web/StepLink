import { useEffect, useState } from 'react'
import type { Activity, ActivityPoint, NativeDiagnostics } from '../domain/models'
import { averageKph, estimatedCalories, formatDuration, paceMinutesPerKm } from '../domain/activity/activityMath'
import { AppHeader } from '../components/AppHeader'
import { LazyRouteMap } from '../components/LazyRouteMap'
import { formatDistance, formatPace } from '../shared/format'
import { PauseIcon, PlayIcon, StopIcon } from '../shared/icons'

interface Props {
  activity: Activity
  points: ActivityPoint[]
  diagnostics: NativeDiagnostics
  recoveredCount: number
  pause: () => Promise<void>
  resume: () => Promise<void>
  end: () => Promise<Activity | null>
  showDiagnostics: () => void
  onEnded: () => void
}

export function TrackerScreen({ activity, points, diagnostics, recoveredCount, pause, resume, end, showDiagnostics, onEnded }: Props) {
  const [now, setNow] = useState(Date.now())
  const [ending, setEnding] = useState(false)
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const elapsed = (activity.endedAt ?? now) - activity.startedAt - activity.pauseDurationMs - (activity.pausedAt ? now - activity.pausedAt : 0)
  const distance = activity.filteredDistanceM
  const moving = activity.movingTimeMs || Math.max(0, elapsed - activity.stoppedTimeMs)
  const statusLabel = activity.status === 'ACTIVE' ? '기록 중' : activity.status === 'PAUSED' ? '일시정지' : '완료'
  const finish = async () => {
    if (!window.confirm('운동을 종료하고 기록을 저장할까요?')) return
    setEnding(true)
    try { await end(); onEnded() } finally { setEnding(false) }
  }
  return (
    <div className="screen tracker-screen">
      <AppHeader title={activity.type === 'RUN' ? '달리기' : activity.type === 'WALK' ? '걷기' : activity.type === 'AUTO' ? 'AUTO 활동' : '자유 활동'} subtitle={statusLabel} />
      <main className="tracker-content">
        <LazyRouteMap points={points} />
        <section className="tracking-panel">
          <div className="tracking-state"><span className={activity.status === 'ACTIVE' ? 'pulse-dot' : 'pause-dot'} />{statusLabel}<button onClick={showDiagnostics}>GPS 상태</button></div>
          <div className="hero-metric"><strong>{formatDistance(distance)}</strong><span>km</span><small>이동 거리</small></div>
          <div className="metric-row">
            <div><strong>{formatDuration(elapsed)}</strong><span>경과 시간</span></div>
            <div><strong>{formatPace(paceMinutesPerKm(distance, moving))}</strong><span>평균 페이스 /km</span></div>
            <div><strong>{averageKph(distance, moving).toFixed(1)}</strong><span>평균 km/h</span></div>
          </div>
          <div className="minor-stats"><span>이동 {formatDuration(activity.movingTimeMs)}</span><span>정지 {formatDuration(activity.stoppedTimeMs)}</span><span>{estimatedCalories(distance, 65, activity.type)} kcal</span></div>
          <div className="tracking-controls">
            {activity.status === 'ACTIVE' ? <button className="control-button pause" onClick={() => void pause()}><PauseIcon/><span>일시정지</span></button> : <button className="control-button resume" onClick={() => void resume()}><PlayIcon/><span>계속하기</span></button>}
            <button className="control-button stop" onClick={() => void finish()} disabled={ending}><StopIcon/><span>{ending ? '저장 중' : '종료'}</span></button>
          </div>
          <p className="native-note">Native {diagnostics.nativePointCount} · UI {points.length} · 복구 {recoveredCount} points</p>
        </section>
      </main>
    </div>
  )
}
