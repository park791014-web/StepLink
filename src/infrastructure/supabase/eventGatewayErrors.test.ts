import assert from 'node:assert/strict'
import test from 'node:test'
import { requireVisibleEventRow, StaleEventSessionError } from './eventGatewayErrors.ts'

test('an RLS-hidden event row becomes a stale-session domain error instead of a PostgREST 406 message', () => {
  assert.throws(
    () => requireVisibleEventRow(null),
    (error) => error instanceof StaleEventSessionError
      && error.code === 'EVENT_SESSION_REBOUND'
      && !error.message.includes('Cannot coerce the result to a single JSON object'),
  )
  assert.deepEqual(requireVisibleEventRow({ status: 'ACTIVE' }), { status: 'ACTIVE' })
})
