import type { EventCodes, EventSession } from '../domain/event/eventTypes'
import type { EventStatus } from '../domain/models'
import { AppHeader } from '../components/AppHeader'
import { friendlyEventError } from './eventErrors'

interface Props {
  session: EventSession
  codes: EventCodes | null
  busy: boolean
  error: string | null
  securePersistence: boolean
  securePersistenceLabel: string
  transition: (status: EventStatus) => Promise<void>
  refresh: () => Promise<void>
  close: () => Promise<void>
}

const states: EventStatus[] = ['DRAFT', 'OPEN', 'ACTIVE', 'ENDED']
const stateLabel: Record<EventStatus, string> = { DRAFT: '준비중', OPEN: '참가 접수중', ACTIVE: '진행중', ENDED: '종료' }

export function EventSessionScreen({ session, codes, busy, error, securePersistence, securePersistenceLabel, transition, refresh, close }: Props) {
  const { event, role } = session
  const owner = role === 'OWNER'
  const participant = role === 'PARTICIPANT'
  const next: Partial<Record<EventStatus, { target: EventStatus; label: string; detail: string }>> = {
    DRAFT: { target: 'OPEN', label: '참가 열기', detail: '행사 코드로 참가할 수 있게 됩니다.' },
    OPEN: { target: 'ACTIVE', label: '행사 시작', detail: '대기 중인 참가자에게 시작 상태가 표시됩니다.' },
    ACTIVE: { target: 'ENDED', label: '행사 종료', detail: '신규 참가와 향후 live upload가 중단됩니다.' },
  }
  const action = next[event.status]
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value) } catch { window.prompt('코드를 복사하세요.', value) } }
  const act = async () => {
    if (!action) return
    const warning = action.target === 'ENDED' ? '행사를 종료하면 이전 상태로 되돌릴 수 없습니다. 종료할까요?' : `${action.label} 상태로 전환할까요?`
    if (window.confirm(warning)) await transition(action.target)
  }

  return (
    <div className={`screen event-session-screen status-${event.status.toLowerCase()}`}>
      <AppHeader title={event.name} subtitle={`${role} · ${stateLabel[event.status]}`} />
      <main className="content session-content">
        <section className="event-status-hero">
          <span className="status-kicker">{stateLabel[event.status]}</span>
          <h1>{participant ? participantTitle(event.status) : operatorTitle(event.status)}</h1>
          <p>{participant ? participantDetail(event.status, event.endMessage) : operatorDetail(event.status)}</p>
        </section>
        <ol className="lifecycle" aria-label="행사 진행 상태">
          {states.map((state, index) => <li key={state} className={index <= states.indexOf(event.status) ? 'reached' : ''}><i>{index + 1}</i><span>{stateLabel[state]}</span></li>)}
        </ol>
        {codes && owner && <section className="code-receipt"><div className="receipt-heading"><span>이 기기에 안전하게 보관된 행사 코드</span><strong>현장 운영 중 다시 확인할 수 있습니다</strong></div><CodeRow label="참가 코드" value={codes.participantCode} copy={copy}/><CodeRow label="운영 코드" value={codes.operatorCode} copy={copy}/><p>서버에는 keyed digest만 저장됩니다. 기기의 보안 저장소를 지우거나 잃으면 기존 plain code는 서버에서 복구할 수 없습니다.</p></section>}
        <section className="event-facts">
          <div><span>행사일</span><strong>{event.eventDate}</strong></div>
          <div><span>예상 인원</span><strong>{event.expectedParticipants.toLocaleString()}명</strong></div>
          {session.participantIdentifier && <div><span>내 식별번호</span><strong>{session.participantIdentifier}</strong></div>}
          {session.displayName && <div><span>참가자</span><strong>{session.displayName}</strong></div>}
        </section>
        <p className={`secure-session-badge ${securePersistence ? 'secure' : ''}`}><span>{securePersistence ? '✓' : '!'}</span>{securePersistenceLabel}</p>
        {owner && action && <section className="lifecycle-action"><div><strong>{action.label}</strong><p>{action.detail}</p></div><button onClick={() => void act()} disabled={busy}>{busy ? '처리 중…' : action.label}</button></section>}
        {!owner && !participant && <aside className="phase-note"><strong>운영자 세션 연결됨</strong><p>현재 행사 상태를 확인할 수 있습니다. 참가자 지도와 운영 dashboard는 Phase 3에서 연결됩니다.</p></aside>}
        {participant && event.status === 'ACTIVE' && <aside className="phase-note active-note"><strong>행사가 시작되었습니다</strong><p>행사 live 위치 전송과 코스 화면은 Phase 3에서 이 세션에 연결됩니다. 개인 GPS core는 변경하지 않았습니다.</p></aside>}
        {error && <p className="error-banner">{friendlyEventError(error)}</p>}
        <div className="session-actions"><button className="secondary-button" onClick={() => void refresh()} disabled={busy}>상태 새로고침</button><button className="text-button" onClick={() => { if (window.confirm('이 기기의 행사 세션을 지울까요? 서버 참가 기록은 유지됩니다.')) void close() }}>이 기기에서 세션 지우기</button></div>
      </main>
    </div>
  )
}

function CodeRow({ label, value, copy }: { label: string; value: string; copy: (value: string) => Promise<void> }) {
  return <div className="receipt-code"><span>{label}</span><strong>{value}</strong><button onClick={() => void copy(value)}>복사</button></div>
}
const participantTitle = (status: EventStatus) => status === 'OPEN' ? '참가가 확인됐어요.' : status === 'ACTIVE' ? '함께 출발해요.' : status === 'ENDED' ? '행사가 종료됐어요.' : '행사를 준비하고 있어요.'
const participantDetail = (status: EventStatus, message: string | null) => status === 'OPEN' ? '운영자가 행사를 시작할 때까지 잠시 기다려주세요.' : status === 'ACTIVE' ? '현재 세션은 유지되며 앱을 다시 열어도 이 화면으로 돌아옵니다.' : status === 'ENDED' ? (message || '참여해주셔서 감사합니다.') : '아직 참가할 수 없는 상태입니다.'
const operatorTitle = (status: EventStatus) => status === 'DRAFT' ? '행사를 만들었습니다.' : status === 'OPEN' ? '참가자를 받고 있습니다.' : status === 'ACTIVE' ? '행사가 진행 중입니다.' : '행사를 종료했습니다.'
const operatorDetail = (status: EventStatus) => status === 'DRAFT' ? '코드를 전달하기 전에 참가를 열어주세요.' : status === 'OPEN' ? '참가자는 대기 화면으로 입장합니다.' : status === 'ACTIVE' ? 'Phase 3 운영 dashboard가 연결될 준비가 되었습니다.' : '신규 참가와 상태 전이가 종료됐습니다.'
