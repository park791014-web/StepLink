import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('../../../supabase/migrations/0004_phase3_live_operations.sql', import.meta.url), 'utf8')
const baseSql = readFileSync(new URL('../../../supabase/migrations/0001_phase0_schema.sql', import.meta.url), 'utf8')

test('Phase 3 migration keeps live state current-only and monotonic', () => {
  assert.match(sql, /on conflict \(participant_id\) do update/i)
  assert.match(sql, /client_sequence < excluded\.client_sequence/i)
  assert.doesNotMatch(sql, /create table\s+.*trail/i)
})

test('Participant live-state policy cannot select another participant', () => {
  assert.match(sql, /create policy live_self_read[\s\S]*p\.user_id = \(select auth\.uid\(\)\)/i)
  assert.match(sql, /revoke insert, update on public\.participant_live_state from authenticated/i)
  assert.doesNotMatch(sql, /grant\s+.*participant_live_state.*\bto anon\b/i)
})

test('Operator live-state read remains limited to an event they operate', () => {
  assert.match(baseSql, /create policy live_operator_read[\s\S]*public\.is_event_operator\(event_id\)/i)
})

test('Phase 3 write RPCs require auth, event scope, explicit grants and safe search path', () => {
  assert.match(sql, /security definer\s+set search_path = ''/i)
  assert.match(sql, /PARTICIPANT_SCOPE_DENIED/)
  assert.match(sql, /OPERATOR_SCOPE_DENIED/)
  assert.match(sql, /revoke all on function public\.upsert_participant_live_state_v1[\s\S]*from public, anon/i)
  assert.match(sql, /grant execute on function public\.upsert_participant_live_state_v1[\s\S]*to authenticated/i)
  assert.match(sql, /created_at > now\(\) - interval '60 seconds'/i)
  assert.match(sql, /idempotency_key = target_idempotency_key/i)
  assert.match(sql, /get_participant_feed_v1[\s\S]*security invoker/i)
})
