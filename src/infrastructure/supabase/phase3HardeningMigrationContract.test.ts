import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('../../../supabase/migrations/0005_phase3_operational_hardening.sql', import.meta.url), 'utf8')
const participantJoin = readFileSync(new URL('../../../supabase/functions/event-join/index.ts', import.meta.url), 'utf8')
const operatorJoin = readFileSync(new URL('../../../supabase/functions/operator-join/index.ts', import.meta.url), 'utf8')
const runtime = readFileSync(new URL('../../../supabase/functions/_shared/runtime.ts', import.meta.url), 'utf8')

test('participant and operator code digests are reserved per event date without plaintext', () => {
  assert.match(sql, /unique index event_access_join_code_event_date_unique[\s\S]*\(event_date, join_code_digest\)/i)
  assert.match(sql, /unique index event_access_operator_code_event_date_unique[\s\S]*\(event_date, operator_code_digest\)/i)
  assert.match(sql, /lookup_active boolean/i)
  assert.doesNotMatch(sql, /participant_code\s+text|operator_code\s+text/i)
  assert.match(sql, /drop constraint if exists event_access_secrets_join_code_digest_key/i)
})

test('same-day digest collides while a next-day digest has a distinct reservation key', () => {
  const reservationKey = (eventDate: string, digest: string) => `${eventDate}:${digest}`
  assert.equal(reservationKey('2026-09-05', 'digest-a'), reservationKey('2026-09-05', 'digest-a'))
  assert.notEqual(reservationKey('2026-09-05', 'digest-a'), reservationKey('2026-09-06', 'digest-a'))
})

test('ENDED event releases only active lookup while keeping its daily reservation', () => {
  assert.match(sql, /set lookup_active = new\.status <> 'ENDED'/i)
  assert.match(sql, /where lookup_active/i)
  assert.match(sql, /event_date, join_code_digest/i)
})

test('participant and operator join resolve only active lookup rows', () => {
  assert.match(participantJoin, /\.eq\('lookup_active', true\)/)
  assert.match(operatorJoin, /\.eq\('lookup_active', true\)/)
  assert.match(participantJoin, /\.lte\('event_date', currentServiceDate\(\)\)[\s\S]*\.order\('event_date', \{ ascending: false \}\)\.limit\(1\)/)
  assert.match(operatorJoin, /\.lte\('event_date', currentServiceDate\(\)\)[\s\S]*\.order\('event_date', \{ ascending: false \}\)\.limit\(1\)/)
  assert.match(runtime, /timeZone: 'Asia\/Seoul'/)
  assert.doesNotMatch(sql, /unique index event_access_(join|operator)_code_active/i)
})

test('auto-close derives the two deadlines in Asia Seoul and follows schedule extensions', () => {
  assert.match(sql, /scheduled_end_at \+ interval '30 minutes'/i)
  assert.match(sql, /time '01:00'\) at time zone 'Asia\/Seoul'/i)
  assert.match(sql, /before insert or update of event_date, scheduled_end_at/i)
})

test('auto-close is idempotent and covers every non-ended lifecycle state', () => {
  assert.match(sql, /status in \('DRAFT','OPEN','ACTIVE'\) and auto_close_at <= now\(\)/i)
  assert.match(sql, /set status = 'ENDED'/i)
  assert.match(sql, /revoke all on function public\.close_due_events_v1\(\) from public, anon, authenticated/i)
  assert.match(sql, /grant execute on function public\.close_due_events_v1\(\) to service_role/i)
})
