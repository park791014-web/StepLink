export const PARTICIPANT_EVENT_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const OPERATOR_CODE_SUFFIX_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'
export const PARTICIPANT_EVENT_CODE_LENGTH = 5
export const OPERATOR_EVENT_CODE_LENGTH = 6

export const canonicalizeEventCode = (value: string) => value.trim().toUpperCase()

const usesAlphabet = (value: string, alphabet: string, length: number) =>
  value.length === length && [...value].every((character) => alphabet.includes(character))

export const isParticipantEventCode = (value: string) =>
  usesAlphabet(value, PARTICIPANT_EVENT_CODE_ALPHABET, PARTICIPANT_EVENT_CODE_LENGTH)

export const isOperatorEventCode = (value: string) =>
  value.length === OPERATOR_EVENT_CODE_LENGTH &&
  isParticipantEventCode(value.slice(0, PARTICIPANT_EVENT_CODE_LENGTH)) &&
  OPERATOR_CODE_SUFFIX_ALPHABET.includes(value.at(-1) ?? '')

export const operatorCodeMatchesParticipantCode = (operatorCode: string, participantCode: string) =>
  isOperatorEventCode(operatorCode) &&
  isParticipantEventCode(participantCode) &&
  operatorCode.slice(0, PARTICIPANT_EVENT_CODE_LENGTH) === participantCode

// Rejection sampling avoids modulo bias while keeping generation on Web Crypto.
export function randomCodeFromAlphabet(alphabet: string, length: number) {
  if (alphabet.length < 2 || alphabet.length > 256 || length < 1) throw new Error('INVALID_RANDOM_CODE_POLICY')
  const unbiasedLimit = 256 - (256 % alphabet.length)
  let result = ''
  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(Math.max(8, length - result.length)))
    for (const byte of bytes) {
      if (byte >= unbiasedLimit) continue
      result += alphabet[byte % alphabet.length]
      if (result.length === length) break
    }
  }
  return result
}

export const randomParticipantEventCode = () =>
  randomCodeFromAlphabet(PARTICIPANT_EVENT_CODE_ALPHABET, PARTICIPANT_EVENT_CODE_LENGTH)

export const randomOperatorCodeSuffix = () =>
  randomCodeFromAlphabet(OPERATOR_CODE_SUFFIX_ALPHABET, 1)
