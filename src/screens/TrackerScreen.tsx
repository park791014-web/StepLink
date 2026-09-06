import { useEffect, useState } from 'react'
import type { Activity, ActivityPoint } from '../domain/models'
import type { EventMessage, HelpRequest, HelpType, PeerLocation } from '../domain/live/liveTypes'
import { averageKph, estimatedCalories, formatDuration, paceMinutesPerKm } from '../domain/activity/activityMath'
import { AppHeader } from '../components/AppHeader'
import { LazyRouteMap } from '../components/LazyRouteMap'
import { ParticipantEventTools } from '../components/ParticipantEventTools'
import { formatDistance, formatPace } from '../shared/format'
import { PauseIcon, PlayIcon, StopIcon } from '../shared/icons'

interface Props {
  activity: Activity
  points: ActivityPoint[]
  peerLocations?: PeerLocation[]
  eventMessages?: EventMessage[]
  activeHelp?: HelpRequest | null
  eventBusy?: boolean
  eventError?: string | null
  requestHelp?: (type: HelpType) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  end: () => Promise<Activity | null>
  onEnded: () => void
  openSettings: () => void
  openMenu: () => void
}

export function TrackerScreen({ activity, points, peerLocations, eventMessages = [], activeHelp = null, eventBusy = false, eventError = null, requestHelp, pause, resume, end, onEnded, openSettings, openMenu }: Props) {
  const [now, setNow] = useState(Date.now())
  const [ending, setEnding] = useState(false)
  const [eventToolsOpen, setEventToolsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showPeers, setShowPeers] = useState(false)
  useEffect(() => { setShowPeers(false) }, [activity.eventContext?.eventId])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  useEffect(() => {
    if (!eventToolsOpen && !menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setEventToolsOpen(false); setMenuOpen(false) } }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [eventToolsOpen, menuOpen])
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
      <AppHeader
        title={activity.type === 'RUN' ? '달리기' : activity.type === 'WALK' ? '걷기' : activity.type === 'AUTO' ? 'AUTO 활동' : '자유 활동'}
        subtitle={statusLabel}
        leading={<button className="icon-button tracker-menu-button" aria-label="메뉴 열기" aria-expanded={menuOpen} aria-controls="tracker-navigation" onClick={() => { setMenuOpen((value) => !value); setEventToolsOpen(false) }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button>}
        trailing={activity.eventContext?.active ? (
          <button
            className="tracker-event-status-button"
            aria-label={`${activity.eventContext.eventName} 행사 상태 열기`}
            aria-expanded={eventToolsOpen}
            aria-controls="tracker-event-overlay"
            onClick={() => { setEventToolsOpen((value) => !value); setMenuOpen(false) }}
          ><span aria-hidden="true" />행사</button>
        ) : undefined}
      />
      <main className="tracker-content">
        <div className="tracker-map-area">
          <LazyRouteMap points={points} peerLocations={showPeers ? peerLocations : []} />
          {menuOpen && <nav id="tracker-navigation" className="tracker-navigation" aria-label="운동 중 메뉴">
            <button onClick={() => setMenuOpen(false)}>기록 화면으로</button>
            <button onClick={openMenu}>메인 메뉴</button>
            <button onClick={openSettings}>설정</button>
          </nav>}
          {eventToolsOpen && activity.eventContext?.active && (
            <section id="tracker-event-overlay" className="tracker-event-overlay" role="dialog" aria-modal="false" aria-label={`${activity.eventContext.eventName} 행사 상태`}>
              <header>
                <div><small>행사 진행 중</small><strong>{activity.eventContext.eventName}</strong></div>
                <button type="button" onClick={() => setEventToolsOpen(false)} aria-label="행사 상태 닫기">닫기</button>
              </header>
              {requestHelp && <ParticipantEventTools messages={eventMessages} activeHelp={activeHelp} busy={eventBusy} error={eventError} requestHelp={requestHelp}/>}
            </section>
          )}
        </div>
        <section className="tracking-panel">
          <div className="tracking-state"><span className={activity.status === 'ACTIVE' ? 'pulse-dot' : 'pause-dot'} />{statusLabel}</div>
          <div className="hero-metric"><strong>{formatDistance(distance)}</strong><span>km</span></div>
          <div className="metric-row">
            <div><strong>{formatDuration(elapsed)}</strong><span>경과 시간</span></div>
            <div><strong>{formatPace(paceMinutesPerKm(distance, moving))}</strong><span>평균 페이스 /km</span></div>
            <div><strong>{averageKph(distance, moving).toFixed(1)}</strong><span>평균 km/h</span></div>
          </div>
          <div className="minor-stats"><span>이동 {formatDuration(activity.movingTimeMs)}</span><span>정지 {formatDuration(activity.stoppedTimeMs)}</span><span>{estimatedCalories(distance, 65, activity.type)} kcal</span></div>
          {activity.eventContext?.active && peerLocations !== undefined && <label className="peer-visibility-toggle"><input type="checkbox" checked={showPeers} onChange={(event) => setShowPeers(event.target.checked)}/><span aria-hidden="true"/><strong>주변 참가자 확인</strong></label>}
          {!activity.eventContext?.active && <div className="tracking-controls">
            {activity.status === 'ACTIVE' ? <button className="control-button pause" onClick={() => void pause()}><PauseIcon/><span>일시정지</span></button> : <button className="control-button resume" onClick={() => void resume()}><PlayIcon/><span>계속하기</span></button>}
            <button className="control-button stop" onClick={() => void finish()} disabled={ending}><StopIcon/><span>{ending ? '저장 중' : '종료'}</span></button>
          </div>}
        </section>
      </main>
    </div>
  )
}
