import { useState } from 'react'
import type { EventMessage, HelpRequest, HelpType } from '../domain/live/liveTypes'
import { relativeTime } from '../shared/format'

const helpLabels: Record<HelpType, string> = {
  INJURY: '다쳤어요',
  LOST: '길을 모르겠어요',
  COMPANION: '친구/일행 문제',
  OTHER: '기타',
}

interface Props {
  messages: EventMessage[]
  activeHelp: HelpRequest | null
  busy: boolean
  error: string | null
  requestHelp: (type: HelpType) => Promise<void>
}

export function ParticipantEventTools({ messages, activeHelp, busy, error, requestHelp }: Props) {
  const [helpType, setHelpType] = useState<HelpType>('INJURY')
  const ask = () => {
    if (window.confirm(`${helpLabels[helpType]} 도움 요청을 운영자에게 보낼까요?`)) void requestHelp(helpType)
  }

  return <section className="tracker-event-tools" aria-label="행사 공지와 도움 요청">
    <details open={messages.length > 0}>
      <summary>공지 <span>{messages.length}</span></summary>
      <div className="tracker-message-list">
        {messages.length === 0 ? <p>새 공지가 없습니다.</p> : messages.map((message) => <article key={message.id}><strong>{message.body}</strong><time>{relativeTime(message.createdAt)}</time></article>)}
      </div>
    </details>
    {activeHelp && <div className={`tracker-help-state help-${activeHelp.status.toLowerCase()}`}><strong>{activeHelp.status === 'OPEN' ? '도움 요청을 전송했습니다.' : '운영자가 도움 요청을 확인했습니다.'}</strong><span>{activeHelp.status === 'ACKNOWLEDGED' ? '운영자가 상황을 확인하고 있습니다.' : '현재 위치와 요청 유형이 운영자에게 전달됩니다.'}</span></div>}
    <div className="tracker-help-request">
      <select aria-label="도움 요청 유형" value={helpType} onChange={(event) => setHelpType(event.target.value as HelpType)}>{Object.entries(helpLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <button disabled={busy || Boolean(activeHelp)} onClick={ask}>{activeHelp ? '요청 처리 중' : '도움 요청'}</button>
    </div>
    {error && <p className="tracker-event-error">{error}</p>}
  </section>
}
