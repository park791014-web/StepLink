import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OFFLINE_AFTER_MS, STALE_LOCATION_AFTER_MS, canTransitionHelp, effectiveParticipantStatus,
  enqueueLatest, matchesDashboardFilters, messageTargetsParticipant, participantStatusLabel,
  shouldEnableNativeLiveSync, shouldUploadLiveState,
} from './livePolicy.ts'
import { DEFAULT_PARTICIPANT_LOCATION_VISIBILITY } from './liveTypes.ts'

test('latest-wins queue replaces only the same participant live item', () => {
  const first = { idempotencyKey: '1', latestWinsKey: 'live:event:a', payload: { sequence: 1 } }
  const durable = { idempotencyKey: 'help', latestWinsKey: null, payload: { type: 'INJURY' } }
  const next = enqueueLatest([first, durable], { idempotencyKey: '2', latestWinsKey: 'live:event:a', payload: { sequence: 2 } })
  assert.deepEqual(next.map((item) => item.idempotencyKey), ['help', '2'])
})

test('live upload is participant-only and ACTIVE-only', () => {
  assert.equal(shouldUploadLiveState('ACTIVE', 'PARTICIPANT', true), true)
  assert.equal(shouldUploadLiveState('ENDED', 'PARTICIPANT', true), false)
  assert.equal(shouldUploadLiveState('ACTIVE', 'OPERATOR', true), false)
})

test('ACTIVE join, late join and restored ACTIVE session all enable native live sync', () => {
  for (const scenario of ['active-join', 'active-late-join', 'restored-active-session']) {
    assert.equal(shouldEnableNativeLiveSync('ACTIVE', 'PARTICIPANT', true), true, scenario)
  }
  assert.equal(shouldEnableNativeLiveSync('OPEN', 'PARTICIPANT', true), false)
  assert.equal(shouldEnableNativeLiveSync('ENDED', 'PARTICIPANT', true), false)
  assert.equal(shouldEnableNativeLiveSync('ACTIVE', 'OPERATOR', true), false)
})

test('stale and offline are derived from one time policy and help takes priority', () => {
  const now = Date.parse('2026-09-04T10:00:00Z')
  assert.equal(effectiveParticipantStatus(new Date(now - STALE_LOCATION_AFTER_MS + 1).toISOString(), false, now), 'NORMAL')
  assert.equal(effectiveParticipantStatus(new Date(now - STALE_LOCATION_AFTER_MS).toISOString(), false, now), 'STALE_LOCATION')
  assert.equal(effectiveParticipantStatus(new Date(now - OFFLINE_AFTER_MS).toISOString(), false, now), 'OFFLINE')
  assert.equal(effectiveParticipantStatus(null, false, now), 'OFFLINE')
  assert.equal(effectiveParticipantStatus(null, true, now), 'HELP_REQUEST')
})

test('dashboard filters combine name/id, grade, class and status', () => {
  const item = { displayName: '김하늘', participantIdentifier: '20315', grade: '2', className: '3', status: 'NORMAL' as const }
  assert.equal(matchesDashboardFilters(item, { query: '하늘', grade: '2', className: '3', status: 'NORMAL' }), true)
  assert.equal(matchesDashboardFilters(item, { query: '203', grade: '', className: '', status: '' }), true)
  assert.equal(matchesDashboardFilters(item, { query: '', grade: '1', className: '', status: '' }), false)
})

test('message targeting and help transitions stay constrained', () => {
  const p = { id: 'p1', grade: '2', className: '3' }
  assert.equal(messageTargetsParticipant('ALL', null, p), true)
  assert.equal(messageTargetsParticipant('GRADE', '2', p), true)
  assert.equal(messageTargetsParticipant('SELECTION', null, p, ['p1']), true)
  assert.equal(canTransitionHelp('OPEN', 'ACKNOWLEDGED'), true)
  assert.equal(canTransitionHelp('OPEN', 'RESOLVED'), false)
  assert.equal(participantStatusLabel.HELP_REQUEST, '도움 요청')
})

test('participant map exposes only anonymous current locations by default', () => {
  assert.equal(DEFAULT_PARTICIPANT_LOCATION_VISIBILITY, 'ANONYMOUS_CURRENT')
})
