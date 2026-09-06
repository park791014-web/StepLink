import test from 'node:test'
import assert from 'node:assert/strict'
import { createDiagnosticFetch, diagnosticEndpointFor, getNetworkDiagnostics, networkDirectionFor } from './networkDiagnostics.ts'

test('network diagnostics retain endpoint identity without query values', () => {
  const endpoint = diagnosticEndpointFor('https://project.supabase.co/auth/v1/token?grant_type=refresh_token&secret=hidden')
  assert.equal(endpoint, 'https://project.supabase.co/auth/v1/token?grant_type&secret')
  assert.doesNotMatch(endpoint, /refresh_token|hidden/)
})

test('network diagnostics separate sends from reads including feed RPC', () => {
  assert.equal(networkDirectionFor('GET', 'https://project.supabase.co/rest/v1/events'), 'RECEIVE')
  assert.equal(networkDirectionFor('POST', 'https://project.supabase.co/rest/v1/rpc/get_participant_feed_v1'), 'RECEIVE')
  assert.equal(networkDirectionFor('POST', 'https://project.supabase.co/rest/v1/rpc/upsert_participant_live_state_v1'), 'SEND')
})

test('network diagnostics record successful receive and send responses', async () => {
  const fetch = createDiagnosticFetch(async () => new Response('{}', { status: 200 }))
  await fetch('https://project.supabase.co/rest/v1/events?event_id=private')
  assert.equal(getNetworkDiagnostics().lastHttpStatus, 200)
  assert.ok(getNetworkDiagnostics().lastReceiveSuccessAt)
  await fetch('https://project.supabase.co/rest/v1/rpc/upsert_participant_live_state_v1', { method: 'POST' })
  assert.ok(getNetworkDiagnostics().lastSendSuccessAt)
})

test('network diagnostics distinguish transport failure from an HTTP response', async () => {
  const fetch = createDiagnosticFetch(async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(() => fetch('https://project.supabase.co/functions/v1/event-join', { method: 'POST' }), /Failed to fetch/)
  const snapshot = getNetworkDiagnostics()
  assert.equal(snapshot.lastHttpStatus, null)
  assert.equal(snapshot.failedEndpoint, 'https://project.supabase.co/functions/v1/event-join')
  assert.match(snapshot.lastError ?? '', /TypeError: Failed to fetch/)
})
