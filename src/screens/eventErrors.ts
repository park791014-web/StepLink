export function friendlyEventError(error: string) {
  const messages: Record<string, string> = {
    EVENT_CODE_NOT_FOUND: '행사 코드를 확인해주세요.',
    PARTICIPANT_CODE_ALREADY_IN_USE: '이미 사용 중인 행사 코드입니다. 다른 5문자 코드를 입력하세요.',
    OPERATOR_CODE_NOT_FOUND: '운영 코드를 확인해주세요.',
    EVENT_NOT_JOINABLE: '아직 참가가 열리지 않았거나 종료된 행사입니다.',
    PARTICIPANT_NAME_MISMATCH: '기존 참가자의 이름과 일치하지 않습니다. 운영자에게 확인해주세요.',
    DEVICE_ALREADY_JOINED_AS_ANOTHER_PARTICIPANT: '이 기기는 이미 다른 참가 정보로 연결되어 있습니다.',
    TOO_MANY_ATTEMPTS: '시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
    AUTH_REQUIRED: '인증 세션을 만들 수 없습니다.',
    EVENT_SESSION_REBOUND: '이 참가자 세션이 다른 기기 또는 브라우저에서 다시 연결되었습니다.',
    EVENT_NOT_ACTIVE: '진행 중인 행사에서만 사용할 수 있습니다.',
    HELP_REQUEST_COOLDOWN: '도움 요청을 방금 보냈습니다. 잠시 후 다시 시도해주세요.',
    PARTICIPANT_SCOPE_DENIED: '참가자 세션이 유효하지 않습니다. 행사 코드로 다시 연결해주세요.',
    OPERATOR_SCOPE_DENIED: '이 행사를 운영할 권한이 없습니다.',
    INVALID_HELP_TRANSITION: '도움 요청 상태를 순서대로 처리해주세요.',
  }
  const key = Object.keys(messages).find((candidate) => error.includes(candidate))
  if (key) return messages[key]
  if (/TypeError|Failed to fetch|NetworkError|Load failed|timeout/i.test(error)) return '인터넷 연결이 불안정합니다. 연결되면 자동으로 다시 시도합니다.'
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.'
}
