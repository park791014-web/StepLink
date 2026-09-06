import { lazy, Suspense, useState } from 'react'
import type { ActivityPoint } from '../domain/models'
import type { EventMessage, HelpRequest, HelpType } from '../domain/live/liveTypes'
import type { LiveSyncStatus } from '../infrastructure/sync/eventSyncQueue'
import { relativeTime } from '../shared/format'

const helpLabels: Record<HelpType, string> = { INJURY: '다쳤어요', LOST: '길을 모르겠어요', COMPANION: '친구/일행 문제', OTHER: '기타' }
const ParticipantLiveMap = lazy(() => import('../components/ParticipantLiveMap').then((module) => ({ default: module.ParticipantLiveMap })))
interface Props {
  latestPoint: ActivityPoint | null
  messages: EventMessage[]
  activeHelp: HelpRequest | null
  busy: boolean
  lastUploadedAt: string | null
  liveSyncStatus: LiveSyncStatus | null
  operationError: string | null
  requestHelp: (type: HelpType) => Promise<void>
}

export function ParticipantOperations({ latestPoint, messages, activeHelp, busy, lastUploadedAt, liveSyncStatus, operationError, requestHelp }: Props) {
  const [helpType, setHelpType] = useState<HelpType>('INJURY')
  const ask = () => { if (window.confirm(`${helpLabels[helpType]} 도움 요청을 운영자에게 보낼까요?`)) void requestHelp(helpType) }
  const location = liveSyncStatus?.latitude != null && liveSyncStatus.longitude != null
    ? { latitude: liveSyncStatus.latitude, longitude: liveSyncStatus.longitude, accuracyM: liveSyncStatus.accuracyM ?? null }
    : latestPoint ? { latitude: latestPoint.latitude, longitude: latestPoint.longitude, accuracyM: latestPoint.accuracy } : null
  const elapsedMs = liveSyncStatus?.elapsedTimeMs ?? 0
  const syncLabel = operationError?.includes('위치 권한')
    ? '위치 권한 필요'
    : !navigator.onLine
      ? '오프라인 · 연결되면 최신 상태를 전송합니다.'
      : !location
        ? 'GPS 신호 찾는 중'
        : liveSyncStatus?.enabled
          ? `위치 공유 중 · ${relativeTime(lastUploadedAt)}`
          : '위치 공유 준비 중'

  return <section className="participant-operations map-first">
    <header className="participant-live-header"><strong>{syncLabel}</strong><span>상세 개인 경로는 서버에 전송하지 않습니다.</span></header>
    <div className="participant-map-shell">
      <Suspense fallback={<div className="map-loading">지도 불러오는 중…</div>}><ParticipantLiveMap location={location}/></Suspense>
      <div className="participant-map-metrics">
        <div><span>거리</span><strong>{((liveSyncStatus?.distanceM ?? 0) / 1000).toFixed(2)}km</strong></div>
        <div><span>시간</span><strong>{formatElapsed(elapsedMs)}</strong></div>
        <div><span>마지막 전송</span><strong>{relativeTime(lastUploadedAt)}</strong></div>
      </div>
    </div>
    {operationError && <p className="operation-status-message">{operationError}</p>}
    {activeHelp && <div className={`help-state help-${activeHelp.status.toLowerCase()}`}><strong>{activeHelp.status === 'OPEN' ? '도움 요청을 전송했습니다.' : '운영자가 도움 요청을 확인했습니다.'}</strong><span>{activeHelp.status === 'ACKNOWLEDGED' ? '운영자가 상황을 확인하고 있습니다.' : '현재 위치와 요청 유형이 운영자에게 전달됩니다.'}</span></div>}
    <nav className="participant-quick-actions" aria-label="행사 도구">
      <details><summary>공지 {messages.length > 0 ? <b>{messages.length}</b> : null}</summary><div className="participant-sheet message-feed">{messages.length === 0 ? <p>새 공지가 없습니다.</p> : messages.map((message) => <article key={message.id}><strong>{message.body}</strong><time>{relativeTime(message.createdAt)}</time></article>)}</div></details>
      <details><summary className="help-button">도움 요청</summary><div className="participant-sheet help-request-panel"><p>유형을 고른 뒤 전송 확인을 한 번 더 합니다.</p><div><select value={helpType} onChange={(event) => setHelpType(event.target.value as HelpType)}>{Object.entries(helpLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button disabled={busy || Boolean(activeHelp)} onClick={ask}>{activeHelp ? '처리 중인 요청 있음' : '도움 요청 확인'}</button></div></div></details>
    </nav>
  </section>
}

function formatElapsed(milliseconds: number) {
  const totalMinutes = Math.floor(milliseconds / 60_000)
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, '0')}`
}
