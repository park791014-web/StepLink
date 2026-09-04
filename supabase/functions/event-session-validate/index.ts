import { endpoint, enforceRateLimit, hmacDigest, HttpError } from '../_shared/runtime.ts'

Deno.serve((req) => endpoint(req, async ({ admin, user, pepper, body }) => {
  await enforceRateLimit(admin, pepper, req, user.id, 'VALIDATE_SESSION', 20)
  const eventId = typeof body.eventId === 'string' ? body.eventId : ''
  const subjectId = typeof body.subjectId === 'string' ? body.subjectId : ''
  const role = typeof body.role === 'string' ? body.role : ''
  const token = typeof body.eventSessionToken === 'string' ? body.eventSessionToken : ''
  if (!eventId || !subjectId || !token || !['OWNER', 'OPERATOR', 'PARTICIPANT'].includes(role)) throw new HttpError(400, 'INVALID_SESSION_PAYLOAD')
  const digest = await hmacDigest(pepper, 'event-session', token)
  let participantIdentifier: string | undefined
  let displayName: string | undefined

  if (role === 'PARTICIPANT') {
    const { data, error } = await admin.from('participants').select('id,user_id,participant_identifier,display_name,session_token_digest').eq('id', subjectId).eq('event_id', eventId).maybeSingle()
    if (error) throw new HttpError(500, 'SESSION_LOOKUP_FAILED')
    if (!data || data.user_id !== user.id || data.session_token_digest !== digest) throw new HttpError(401, 'SESSION_INVALID')
    participantIdentifier = data.participant_identifier; displayName = data.display_name
  } else {
    const { data, error } = await admin.from('event_operators').select('user_id,role,session_token_digest,revoked_at').eq('event_id', eventId).eq('user_id', subjectId).maybeSingle()
    if (error) throw new HttpError(500, 'SESSION_LOOKUP_FAILED')
    if (!data || data.user_id !== user.id || data.role !== role || data.revoked_at || data.session_token_digest !== digest) throw new HttpError(401, 'SESSION_INVALID')
  }

  const { data: event, error: eventError } = await admin.from('events').select('id,owner_user_id,name,event_date,expected_participants,scheduled_start_at,scheduled_end_at,end_message,status,created_at,started_at,ended_at').eq('id', eventId).single()
  if (eventError) throw new HttpError(404, 'EVENT_NOT_FOUND')
  return { event, role, subjectId, participantIdentifier, displayName }
}))
