import type { EventStatus } from '../models'
export {
  PARTICIPANT_EVENT_CODE_ALPHABET,
  OPERATOR_CODE_SUFFIX_ALPHABET,
  canonicalizeEventCode,
  isOperatorEventCode,
  isParticipantEventCode,
  operatorCodeMatchesParticipantCode,
  randomOperatorCodeSuffix,
  randomParticipantEventCode,
} from '../../../supabase/functions/_shared/eventCodePolicy.ts'

const transitions: Partial<Record<EventStatus, EventStatus>> = {
  DRAFT: 'OPEN',
  OPEN: 'ACTIVE',
  ACTIVE: 'ENDED',
}

export const nextEventStatus = (status: EventStatus) => transitions[status] ?? null

export const isAllowedEventTransition = (from: EventStatus, to: EventStatus) =>
  from === to || transitions[from] === to

export const normalizeParticipantName = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR')

export const participantIdentityMatches = (storedName: string, enteredName: string) =>
  normalizeParticipantName(storedName) === normalizeParticipantName(enteredName)

export const isSchoolParticipantIdentifier = (value: string) => /^\d{5}$/.test(value)
