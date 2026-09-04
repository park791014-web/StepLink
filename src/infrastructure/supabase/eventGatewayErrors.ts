export class StaleEventSessionError extends Error {
  readonly code = 'EVENT_SESSION_REBOUND'

  constructor() {
    super('이 참가자 세션이 다른 기기 또는 브라우저에서 다시 연결되었습니다.')
    this.name = 'StaleEventSessionError'
  }
}

export function requireVisibleEventRow<T>(row: T | null): T {
  if (row === null) throw new StaleEventSessionError()
  return row
}
