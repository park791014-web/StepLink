import type { EventStatus, ParticipantStatus } from '../models'

export const LIVE_UPLOAD_INTERVAL_MS = 30_000
export const DASHBOARD_POLL_INTERVAL_MS = 7_500
export const PARTICIPANT_FEED_POLL_INTERVAL_MS = 15_000
export const STALE_LOCATION_AFTER_MS = 90_000
export const OFFLINE_AFTER_MS = 5 * 60_000
export const HELP_REQUEST_COOLDOWN_MS = 60_000

export const participantStatusLabel: Record<ParticipantStatus, string> = {
  NORMAL: '정상',
  STALE_LOCATION: '위치 오래됨',
  LONG_STOP: '장시간 정지',
  COURSE_DEVIATION: '코스 이탈',
  HELP_REQUEST: '도움 요청',
  COMPLETED: '완료',
  OFFLINE: '위치 확인 안 됨',
}

export function configuredInterval(raw: string | undefined, fallback: number, minimum: number) {
  const value = Number(raw)
  return Number.isFinite(value) && value >= minimum ? Math.floor(value) : fallback
}

export function shouldUploadLiveState(status: EventStatus, role: string, hasPoint: boolean) {
  return status === 'ACTIVE' && role === 'PARTICIPANT' && hasPoint
}

export function shouldEnableNativeLiveSync(status: EventStatus, role: string, configured: boolean) {
  return configured && status === 'ACTIVE' && role === 'PARTICIPANT'
}

export function effectiveParticipantStatus(
  lastReceivedAt: string | null,
  hasOpenHelp: boolean,
  now = Date.now(),
): ParticipantStatus {
  if (hasOpenHelp) return 'HELP_REQUEST'
  if (!lastReceivedAt) return 'OFFLINE'
  const age = Math.max(0, now - Date.parse(lastReceivedAt))
  if (age >= OFFLINE_AFTER_MS) return 'OFFLINE'
  if (age >= STALE_LOCATION_AFTER_MS) return 'STALE_LOCATION'
  return 'NORMAL'
}

export function nextRetryDelayMs(attempt: number) {
  return Math.min(5 * 60_000, 2_000 * 2 ** Math.max(0, Math.min(attempt, 8)))
}

export interface FilterableParticipant {
  displayName: string
  participantIdentifier: string
  grade: string | null
  className: string | null
  status: ParticipantStatus
}

export interface DashboardFilters {
  query: string
  grade: string
  className: string
  status: ParticipantStatus | ''
}

export function matchesDashboardFilters(item: FilterableParticipant, filters: DashboardFilters) {
  const query = filters.query.trim().toLocaleLowerCase('ko-KR')
  const matchesQuery = !query || item.displayName.toLocaleLowerCase('ko-KR').includes(query) || item.participantIdentifier.toLocaleLowerCase('ko-KR').includes(query)
  return matchesQuery
    && (!filters.grade || item.grade === filters.grade)
    && (!filters.className || item.className === filters.className)
    && (!filters.status || item.status === filters.status)
}

export type MessageTargetType = 'ALL' | 'GRADE' | 'CLASS' | 'PARTICIPANT' | 'SELECTION'

export function messageTargetsParticipant(
  targetType: MessageTargetType,
  targetValue: string | null,
  participant: { id: string; grade: string | null; className: string | null },
  selectedIds: readonly string[] = [],
) {
  if (targetType === 'ALL') return true
  if (targetType === 'GRADE') return participant.grade === targetValue
  if (targetType === 'CLASS') return participant.className === targetValue
  if (targetType === 'PARTICIPANT') return participant.id === targetValue
  return selectedIds.includes(participant.id)
}

export type HelpStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
export function canTransitionHelp(from: HelpStatus, to: HelpStatus) {
  return from === to || (from === 'OPEN' && to === 'ACKNOWLEDGED') || (from === 'ACKNOWLEDGED' && to === 'RESOLVED')
}

export interface QueueItem<T = unknown> {
  idempotencyKey: string
  latestWinsKey: string | null
  payload: T
}

export function enqueueLatest<T>(items: readonly QueueItem<T>[], incoming: QueueItem<T>) {
  if (!incoming.latestWinsKey) return [...items, incoming]
  return [...items.filter((item) => item.latestWinsKey !== incoming.latestWinsKey), incoming]
}
