export type SyncFailureDisposition = 'RETRY' | 'TERMINAL'
export type OperationalErrorOrigin = 'event_status' | 'participant_feed' | 'live_state' | 'token_refresh' | 'help_request' | 'native_manager'

const terminalCodes = [
  'PARTICIPANT_SCOPE_DENIED', 'EVENT_NOT_ACTIVE', 'INVALID_HELP_TYPE', 'INVALID_LOCATION',
  'INVALID_ACCURACY', 'IDEMPOTENCY_SCOPE_DENIED', 'HELP_REQUEST_COOLDOWN', 'AUTH_REQUIRED',
]

export function syncFailureDisposition(error: unknown): SyncFailureDisposition {
  const message = error instanceof Error ? error.message : String(error)
  if (terminalCodes.some((code) => message.includes(code))) return 'TERMINAL'
  if (/failed to fetch|network|timeout|timed out|load failed|fetch failed|service unavailable|bad gateway|gateway timeout|\b5\d\d\b/i.test(message)) return 'RETRY'
  return 'TERMINAL'
}

export function isTransientNetworkFailure(error: unknown) {
  return syncFailureDisposition(error) === 'RETRY'
}

export function queuePayloadMatchesScope(payload: unknown, eventId: string, participantId: string) {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as { eventId?: unknown; participantId?: unknown }
  return value.eventId === eventId && value.participantId === participantId
}

export function friendlyOperationalError(origin: OperationalErrorOrigin, error: unknown, online = true) {
  const message = error instanceof Error ? error.message : String(error)
  if (!online || /failed to fetch|network|timeout|timed out|load failed|fetch failed/i.test(message)) {
    return origin === 'live_state' || origin === 'help_request'
      ? '인터넷 연결이 불안정합니다. 연결되면 자동으로 다시 시도합니다.'
      : '인터넷 연결이 불안정합니다. 잠시 후 다시 확인합니다.'
  }
  if (message.includes('LOCATION_PERMISSION_REQUIRED')) return '위치 권한이 필요합니다.'
  if (message.includes('GPS_LOCATION_PENDING')) return 'GPS 신호를 찾는 중입니다.'
  if (origin === 'help_request') return '도움 요청을 처리하지 못했습니다. 잠시 후 다시 확인해주세요.'
  if (origin === 'participant_feed') return '공지와 도움 요청 상태를 확인하지 못했습니다.'
  if (origin === 'live_state' || origin === 'native_manager') return '위치 전송 상태를 확인하지 못했습니다.'
  return '행사 상태를 확인하지 못했습니다.'
}
