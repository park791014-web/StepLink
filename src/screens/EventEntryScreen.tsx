import { useState } from 'react'
import { AppHeader } from '../components/AppHeader'
import { CompassIcon, GroupIcon } from '../shared/icons'

export function EventEntryScreen({ mode, back }: { mode: 'participant' | 'operator'; back: () => void }) {
  const [code, setCode] = useState('')
  const operator = mode === 'operator'
  const normalized = code.replace(/[^0-9a-z]/gi, '').toUpperCase().slice(0, operator ? 7 : 6)
  return (
    <div className={`screen event-entry-screen ${operator ? 'operator-theme' : ''}`}>
      <AppHeader title={operator ? '행사 운영' : '행사 참가'} subtitle={operator ? 'OWNER · OPERATOR' : 'PARTICIPANT'} back={back} />
      <main className="content event-content">
        <span className="event-glyph">{operator ? <CompassIcon /> : <GroupIcon />}</span>
        <div className="section-heading">
          <span className="eyebrow">{operator ? 'CONTROL THE FLOW' : 'JOIN THE MOMENT'}</span>
          <h1>{operator ? <>행사의 모든 순간을<br/>안전하게 연결하세요.</> : <>함께 걸을 준비,<br/>되셨나요?</>}</h1>
          <p>{operator ? '운영 코드를 입력해 행사 현황과 참가자를 관리합니다.' : '안내받은 6자리 행사 코드를 입력하세요.'}</p>
        </div>
        <label className="code-field">
          <span>{operator ? '운영 코드' : '행사 코드'}</span>
          <input inputMode={operator ? 'text' : 'numeric'} autoCapitalize="characters" value={normalized} onChange={(event) => setCode(event.target.value)} placeholder={operator ? '000000A' : '000000'} />
          <small>{operator ? '숫자 6자리 + 영문 1자리' : '숫자 6자리'}</small>
        </label>
        <button className="start-button" disabled={normalized.length !== (operator ? 7 : 6)} onClick={() => window.alert('Phase 2에서 Supabase 행사 인증과 연결됩니다.')}><span>{operator ? '운영 화면으로' : '행사 입장'}</span><i>→</i></button>
        <aside className="phase-note"><strong>연결 준비 완료</strong><p>역할·세션 모델과 서버 스키마가 준비되어 있습니다. 실제 코드 인증은 Phase 2에서 안전한 서버 함수로 연결합니다.</p></aside>
      </main>
    </div>
  )
}
