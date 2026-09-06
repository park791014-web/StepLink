import { useState } from 'react'
import type { CreateEventInput } from '../domain/event/eventTypes'
import { canonicalizeEventCode, isOperatorEventCode, isParticipantEventCode, OPERATOR_CODE_SUFFIX_ALPHABET, PARTICIPANT_EVENT_CODE_ALPHABET } from '../domain/event/eventRules'
import { AppHeader } from '../components/AppHeader'
import { CompassIcon } from '../shared/icons'
import { ConfigBanner } from './EventEntryScreen'
import { friendlyEventError } from './eventErrors'

interface Props {
  back: () => void
  create: (input: CreateEventInput) => Promise<void>
  join: (operatorCode: string) => Promise<void>
  busy: boolean
  error: string | null
  configured: boolean
  configurationMessage: string | null
  recoveryNotice: string | null
  dismissRecoveryNotice: () => void
}

const localDate = () => {
  const now = new Date(); const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

export function EventOperatorScreen({ back, create, join, busy, error, configured, configurationMessage, recoveryNotice, dismissRecoveryNotice }: Props) {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [operatorCode, setOperatorCode] = useState('')
  const [configurationNotice, setConfigurationNotice] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', eventDate: localDate(), expectedParticipants: '100', requestedParticipantCode: '', scheduledStartAt: '', scheduledEndAt: '', endMessage: '' })
  const code = canonicalizeEventCode(operatorCode).slice(0, 6)
  const participantCode = canonicalizeEventCode(form.requestedParticipantCode).slice(0, 5)
  const validCreate = form.name.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(form.eventDate) && Number(form.expectedParticipants) > 0 && (participantCode.length === 0 || isParticipantEventCode(participantCode))

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault(); if (!validCreate) return
    if (!configured) { setConfigurationNotice('Supabase 설정이 필요합니다. .env.local의 public URL과 공개 키를 확인하세요.'); return }
    setConfigurationNotice(null)
    await create({ name: form.name.trim(), eventDate: form.eventDate, expectedParticipants: Number(form.expectedParticipants), requestedParticipantCode: participantCode || undefined, scheduledStartAt: form.scheduledStartAt ? new Date(form.scheduledStartAt).toISOString() : undefined, scheduledEndAt: form.scheduledEndAt ? new Date(form.scheduledEndAt).toISOString() : undefined, endMessage: form.endMessage.trim() || undefined })
  }

  const submitOperator = async (event: React.FormEvent) => {
    event.preventDefault(); if (!isOperatorEventCode(code)) return
    if (!configured) { setConfigurationNotice('Supabase 설정이 필요합니다. .env.local의 public URL과 공개 키를 확인하세요.'); return }
    setConfigurationNotice(null)
    await join(code)
  }

  return (
    <div className="screen event-entry-screen operator-theme">
      <AppHeader title="행사 운영" subtitle="OWNER · OPERATOR" back={back} />
      <main className="content event-content operator-content">
        <div className="compact-page-hero"><span className="event-glyph"><CompassIcon /></span><div className="section-heading"><span className="eyebrow">CONTROL THE FLOW</span><h1>행사의 모든 순간을 안전하게 연결하세요.</h1></div></div>
        {!configured && <ConfigBanner message={configurationMessage} />}
        {recoveryNotice && <aside className="notice-banner"><button onClick={dismissRecoveryNotice}>×</button><strong>세션 복구 안내</strong><p>{recoveryNotice}</p></aside>}
        <div className="segment-tabs"><button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>새 행사</button><button className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>운영 코드</button></div>
        {mode === 'create' ? (
          <form className="event-form" onSubmit={(event) => void submitCreate(event)}>
            <label className="field"><span>행사명 *</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value.slice(0, 120) })} placeholder="예: 2026 시민공원 걷기" /></label>
            <label className="field"><span>참가자 행사 코드 (선택)</span><input value={participantCode} maxLength={5} autoCapitalize="characters" autoCorrect="off" spellCheck={false} onChange={(event) => setForm({ ...form, requestedParticipantCode: canonicalizeEventCode(event.target.value).slice(0, 5) })} placeholder="예: 01A7K · 미입력 시 서버 생성"/><small className={participantCode && !isParticipantEventCode(participantCode) ? 'validation-error' : ''}>{participantCode && !isParticipantEventCode(participantCode) ? `사용할 수 없는 문자입니다. 허용: ${PARTICIPANT_EVENT_CODE_ALPHABET}` : '숫자 0~9 허용, 영문 I/L/O 제외. 중복 여부는 서버가 확인합니다.'}</small></label>
            <div className="field-pair schedule-pair"><label className="field"><span>시작 예정</span><input type="datetime-local" value={form.scheduledStartAt} onChange={(event) => setForm({ ...form, scheduledStartAt: event.target.value })}/></label><label className="field"><span>종료 예정</span><input type="datetime-local" value={form.scheduledEndAt} onChange={(event) => setForm({ ...form, scheduledEndAt: event.target.value })}/></label></div>
            <label className="field"><span>행사 종료 메시지</span><textarea className="single-line-textarea" rows={1} value={form.endMessage} onChange={(event) => setForm({ ...form, endMessage: event.target.value.slice(0, 1000) })} placeholder="참여해주셔서 감사합니다." /></label>
            {(configurationNotice || error) && <p className="error-banner">{configurationNotice ?? friendlyEventError(error!)}</p>}
            <button className="start-button" disabled={!validCreate || busy}><span>{busy ? '생성 중…' : '준비중 행사 만들기'}</span><i>→</i></button>
          </form>
        ) : (
          <form className="event-form" onSubmit={(event) => void submitOperator(event)}>
            <label className="code-field"><span>운영 코드</span><input value={code} maxLength={6} onChange={(event) => setOperatorCode(canonicalizeEventCode(event.target.value).slice(0, 6))} placeholder="01A7KP" autoCapitalize="characters" autoCorrect="off" spellCheck={false}/><small className={code && !isOperatorEventCode(code) ? 'validation-error' : ''}>{code && !isOperatorEventCode(code) ? `참가 코드 5문자 + suffix(${OPERATOR_CODE_SUFFIX_ALPHABET}) 1문자를 입력하세요.` : '참가 코드와 같은 5문자 + 영문 대문자 suffix 1문자'}</small></label>
            {(configurationNotice || error) && <p className="error-banner">{configurationNotice ?? friendlyEventError(error!)}</p>}
            <button className="start-button" disabled={!isOperatorEventCode(code) || busy}><span>{busy ? '확인 중…' : '운영 세션 연결'}</span><i>→</i></button>
          </form>
        )}
      </main>
    </div>
  )
}
