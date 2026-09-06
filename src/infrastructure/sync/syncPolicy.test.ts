import test from 'node:test'
import assert from 'node:assert/strict'
import { friendlyOperationalError, isTransientNetworkFailure, queuePayloadMatchesScope, syncFailureDisposition } from './syncPolicy.ts'

test('stale HELP queue payload cannot cross event or participant scope', () => {
  const payload = { eventId: 'event-a', participantId: 'participant-a' }
  assert.equal(queuePayloadMatchesScope(payload, 'event-a', 'participant-a'), true)
  assert.equal(queuePayloadMatchesScope(payload, 'event-b', 'participant-a'), false)
  assert.equal(queuePayloadMatchesScope(payload, 'event-a', 'participant-b'), false)
})

test('permanent help failures become terminal while network failures retry', () => {
  assert.equal(syncFailureDisposition(new Error('PARTICIPANT_SCOPE_DENIED')), 'TERMINAL')
  assert.equal(syncFailureDisposition(new Error('EVENT_NOT_ACTIVE')), 'TERMINAL')
  assert.equal(syncFailureDisposition(new TypeError('Failed to fetch')), 'RETRY')
  assert.equal(syncFailureDisposition(new Error('504 Gateway Timeout')), 'RETRY')
  assert.equal(isTransientNetworkFailure(new TypeError('Failed to fetch')), true)
  assert.equal(isTransientNetworkFailure(new Error('EVENT_NOT_ACTIVE')), false)
})

test('raw fetch failures are replaced with user-facing Korean status', () => {
  const message = friendlyOperationalError('help_request', new TypeError('Failed to fetch'), false)
  assert.equal(message, '인터넷 연결이 불안정합니다. 연결되면 자동으로 다시 시도합니다.')
  assert.doesNotMatch(message, /TypeError|Failed to fetch/)
})
