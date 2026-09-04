import { useState } from 'react'
import type { JoinParticipantInput } from '../domain/event/eventTypes'
import { canonicalizeEventCode, isParticipantEventCode, isSchoolParticipantIdentifier, PARTICIPANT_EVENT_CODE_ALPHABET } from '../domain/event/eventRules'
import { AppHeader } from '../components/AppHeader'
import { GroupIcon } from '../shared/icons'
import { friendlyEventError } from './eventErrors'

interface Props {
  back: () => void
  join: (input: JoinParticipantInput) => Promise<void>
  busy: boolean
  error: string | null
  configured: boolean
  configurationMessage: string | null
  recoveryNotice: string | null
  dismissRecoveryNotice: () => void
}

export function EventEntryScreen({ back, join, busy, error, configured, configurationMessage, recoveryNotice, dismissRecoveryNotice }: Props) {
  const [eventCode, setEventCode] = useState('')
  const [participantIdentifier, setParticipantIdentifier] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [generalIdentifier, setGeneralIdentifier] = useState(false)
  const [configurationNotice, setConfigurationNotice] = useState<string | null>(null)
  const normalizedCode = canonicalizeEventCode(eventCode).slice(0, 5)
  const normalizedIdentifier = generalIdentifier ? participantIdentifier.slice(0, 80) : participantIdentifier.replace(/\D/g, '').slice(0, 5)
  const identifierValid = generalIdentifier ? normalizedIdentifier.trim().length > 0 : isSchoolParticipantIdentifier(normalizedIdentifier)
  const valid = isParticipantEventCode(normalizedCode) && identifierValid && displayName.trim().length > 0

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid) return
    if (!configured) { setConfigurationNotice('Supabase 설정이 필요합니다. .env.local의 public URL과 공개 키를 확인하세요.'); return }
    setConfigurationNotice(null)
    await join({ eventCode: normalizedCode, participantIdentifier: normalizedIdentifier.trim(), displayName: displayName.trim() })
  }

  return (
    <div className="screen event-entry-screen">
      <AppHeader title="행사 참가" subtitle="PARTICIPANT" back={back} />
      <main className="content event-content">
        <span className="event-glyph"><GroupIcon /></span>
        <div className="section-heading">
          <span className="eyebrow">JOIN THE MOMENT</span>
          <h1>함께 걸을 준비,<br/>되셨나요?</h1>
          <p>행사가 참가를 연 뒤에만 입장할 수 있습니다. 같은 정보로 다시 입장하면 기존 참가 기록에 연결됩니다.</p>
        </div>
        {!configured && <ConfigBanner message={configurationMessage} />}
        {recoveryNotice && <aside className="notice-banner"><button onClick={dismissRecoveryNotice}>×</button><strong>세션 복구 안내</strong><p>{recoveryNotice}</p></aside>}
        <form className="event-form" onSubmit={(event) => void submit(event)}>
          <label className="code-field"><span>행사 코드</span><input value={normalizedCode} maxLength={5} autoCapitalize="characters" autoCorrect="off" spellCheck={false} onChange={(event) => setEventCode(canonicalizeEventCode(event.target.value).slice(0, 5))} placeholder="01A7K"/><small className={normalizedCode && !isParticipantEventCode(normalizedCode) ? 'validation-error' : ''}>{normalizedCode && !isParticipantEventCode(normalizedCode) ? `사용할 수 없는 문자입니다. 허용: ${PARTICIPANT_EVENT_CODE_ALPHABET}` : '영문·숫자 5문자(I, L, O 제외) · 학번과 별도 항목'}</small></label>
          <label className="field"><span>학번 / 식별번호</span><input inputMode={generalIdentifier ? 'text' : 'numeric'} value={normalizedIdentifier} onChange={(event) => setParticipantIdentifier(event.target.value)} placeholder={generalIdentifier ? '참가자 식별번호' : '예: 20315'} /><small>{generalIdentifier ? '일반 행사 식별번호' : '학년 1자리 + 반 2자리 + 번호 2자리'}</small></label>
          <label className="compact-check"><input type="checkbox" checked={generalIdentifier} onChange={(event) => { setGeneralIdentifier(event.target.checked); setParticipantIdentifier('') }} /><span>학교 행사가 아닌 일반 식별번호 사용</span></label>
          <label className="field"><span>이름</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value.slice(0, 80))} placeholder="이름을 입력하세요" autoComplete="name" /></label>
          {(configurationNotice || error) && <p className="error-banner">{configurationNotice ?? friendlyEventError(error!)}</p>}
          <button className="start-button" disabled={!valid || busy}><span>{busy ? '확인 중…' : '행사 입장'}</span><i>→</i></button>
        </form>
        <p className="security-caption">참가자 식별번호는 문자열로 처리되며 다른 참가자에게 공개되지 않습니다.</p>
      </main>
    </div>
  )
}

export function ConfigBanner({ message }: { message: string | null }) {
  return <aside className="config-banner"><strong>Supabase 연결 설정 필요</strong><p>{message ?? '환경 설정을 확인하세요.'} 실제 연결 전에는 성공 상태를 만들지 않습니다.</p></aside>
}
