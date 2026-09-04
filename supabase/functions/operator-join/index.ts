import { endpoint, enforceRateLimit, hmacDigest, HttpError, randomToken } from '../_shared/runtime.ts'
import { canonicalizeEventCode, isOperatorEventCode } from '../_shared/eventCodePolicy.ts'

Deno.serve((req) => endpoint(req, async ({ admin, user, pepper, body }) => {
  await enforceRateLimit(admin, pepper, req, user.id, 'JOIN_OPERATOR', 8)
  const code = canonicalizeEventCode(typeof body.operatorCode === 'string' ? body.operatorCode : '')
  if (!isOperatorEventCode(code)) throw new HttpError(400, 'INVALID_OPERATOR_CODE_FORMAT')
  const digest = await hmacDigest(pepper, 'operator-code', code)
  const { data: secret, error: secretError } = await admin.from('event_access_secrets').select('event_id').eq('operator_code_digest', digest).maybeSingle()
  if (secretError) throw new HttpError(500, 'EVENT_LOOKUP_FAILED')
  if (!secret) throw new HttpError(404, 'OPERATOR_CODE_NOT_FOUND')

  const eventSessionToken = randomToken()
  const { data: membership, error } = await admin.rpc('join_operator_internal', {
    target_event_id: secret.event_id,
    target_user_id: user.id,
    target_session_token_digest: await hmacDigest(pepper, 'event-session', eventSessionToken),
  })
  if (error) throw new HttpError(400, error.message)
  const { data: event, error: eventError } = await admin.from('events').select('id,owner_user_id,name,event_date,expected_participants,scheduled_start_at,scheduled_end_at,end_message,status,created_at,started_at,ended_at').eq('id', secret.event_id).single()
  if (eventError) throw new HttpError(500, 'EVENT_READ_FAILED')
  return { event, membership: { userId: membership.user_id, role: membership.role }, eventSessionToken }
}))
