import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalizeEventCode, isAllowedEventTransition, isOperatorEventCode, isParticipantEventCode, isSchoolParticipantIdentifier, nextEventStatus, operatorCodeMatchesParticipantCode, participantIdentityMatches, randomOperatorCodeSuffix, randomParticipantEventCode } from './eventRules.ts'

test('event lifecycle only moves forward one step or remains idempotent', () => {
  assert.equal(nextEventStatus('DRAFT'), 'OPEN')
  assert.equal(nextEventStatus('OPEN'), 'ACTIVE')
  assert.equal(nextEventStatus('ACTIVE'), 'ENDED')
  assert.equal(nextEventStatus('ENDED'), null)
  assert.equal(isAllowedEventTransition('DRAFT', 'OPEN'), true)
  assert.equal(isAllowedEventTransition('OPEN', 'OPEN'), true)
  assert.equal(isAllowedEventTransition('OPEN', 'ENDED'), false)
  assert.equal(isAllowedEventTransition('ENDED', 'ACTIVE'), false)
})

test('same participant name tolerates casing and repeated whitespace', () => {
  assert.equal(participantIdentityMatches('홍 길동', '  홍   길동 '), true)
  assert.equal(participantIdentityMatches('Alice KIM', 'alice kim'), true)
  assert.equal(participantIdentityMatches('홍길동', '홍길순'), false)
})

test('school participant identifier is exactly five digits', () => {
  assert.equal(isSchoolParticipantIdentifier('20315'), true)
  assert.equal(isSchoolParticipantIdentifier('0315'), false)
  assert.equal(isSchoolParticipantIdentifier('20A15'), false)
})

test('event codes canonicalize case and accept only the confusion-safe alphabet', () => {
  assert.equal(isParticipantEventCode('01A7K'), true)
  assert.equal(isParticipantEventCode('00000'), true)
  assert.equal(isParticipantEventCode('11111'), true)
  assert.equal(canonicalizeEventCode(' 01a7k '), '01A7K')
  for (const value of ['01O7K', '01A7I', '01A7L', '1A7K', '001A7K']) {
    assert.equal(isParticipantEventCode(value), false)
  }
})

test('operator code keeps the participant prefix and uses an allowed suffix', () => {
  assert.equal(isOperatorEventCode('01A7KP'), true)
  assert.equal(canonicalizeEventCode(' 01a7kp '), '01A7KP')
  assert.equal(operatorCodeMatchesParticipantCode('01A7KP', '01A7K'), true)
  assert.equal(operatorCodeMatchesParticipantCode('01A7MP', '01A7K'), false)
  assert.equal(isOperatorEventCode('01A7KO'), false)
  assert.equal(isOperatorEventCode('01A7K'), false)
  assert.equal(isOperatorEventCode('01A7KPP'), false)
})

test('school identifier validation remains independent from event-code validation', () => {
  assert.equal(isSchoolParticipantIdentifier('20315'), true)
  assert.equal(isParticipantEventCode('20315'), true)
  assert.equal(isParticipantEventCode('01A7K'), true)
  assert.equal(isSchoolParticipantIdentifier('01A7K'), false)
})

test('random participant codes always use the canonical five-character policy', () => {
  for (let index = 0; index < 100; index += 1) {
    const participantCode = randomParticipantEventCode()
    assert.equal(isParticipantEventCode(participantCode), true)
    assert.equal(isOperatorEventCode(`${participantCode}${randomOperatorCodeSuffix()}`), true)
  }
})
