import { currentServiceDate, endpoint, enforceRateLimit, hmacDigest, HttpError, randomToken } from '../_shared/runtime.ts'
import { canonicalizeEventCode, isParticipantEventCode } from '../_shared/eventCodePolicy.ts'

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

Deno.serve((req) => endpoint(req, async ({ admin, user, pepper, body }) => {
  await enforceRateLimit(admin, pepper, req, user.id, 'JOIN_EVENT', 8)
  const eventCode = canonicalizeEventCode(text(body.eventCode))
  const participantIdentifier = text(body.participantIdentifier)
  const displayName = text(body.displayName)
  if (!isParticipantEventCode(eventCode)) throw new HttpError(400, 'INVALID_EVENT_CODE_FORMAT')
  if (participantIdentifier.length < 1 || participantIdentifier.length > 80) throw new HttpError(400, 'INVALID_IDENTIFIER')
  if (displayName.length < 1 || displayName.length > 80) throw new HttpError(400, 'INVALID_NAME')

  const digest = await hmacDigest(pepper, 'join-code', eventCode)
  const { data: secret, error: secretError } = await admin.from('event_access_secrets').select('event_id,event_date')
    .eq('join_code_digest', digest).eq('lookup_active', true).lte('event_date', currentServiceDate())
    .order('event_date', { ascending: false }).limit(1).maybeSingle()
  if (secretError) throw new HttpError(500, 'EVENT_LOOKUP_FAILED')
  if (!secret) throw new HttpError(404, 'EVENT_CODE_NOT_FOUND')

  const eventSessionToken = randomToken()
  const { data: participant, error } = await admin.rpc('join_event_internal', {
    target_event_id: secret.event_id,
    target_user_id: user.id,
    target_identifier: participantIdentifier,
    target_display_name: displayName,
    target_session_token_digest: await hmacDigest(pepper, 'event-session', eventSessionToken),
  })
  if (error) {
    const status = error.message.includes('PARTICIPANT_NAME_MISMATCH') ? 409 : error.message.includes('EVENT_NOT_JOINABLE') ? 409 : 400
    throw new HttpError(status, error.message)
  }
  const { data: event, error: eventError } = await admin.from('events').select('id,owner_user_id,name,event_date,expected_participants,scheduled_start_at,scheduled_end_at,auto_close_at,end_message,status,created_at,started_at,ended_at').eq('id', secret.event_id).single()
  if (eventError) throw new HttpError(500, 'EVENT_READ_FAILED')
  return { event, participant: { id: participant.id, participantIdentifier: participant.participantIdentifier, displayName: participant.displayName }, recovered: participant.recovered, eventSessionToken }
}))
