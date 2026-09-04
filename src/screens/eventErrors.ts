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
  }
  const key = Object.keys(messages).find((candidate) => error.includes(candidate))
  return key ? messages[key] : error
}
