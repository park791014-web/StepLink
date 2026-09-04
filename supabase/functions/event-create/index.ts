import { endpoint, enforceRateLimit, hmacDigest, HttpError, operatorCode, participantCode, randomToken } from '../_shared/runtime.ts'
import { canonicalizeEventCode, isParticipantEventCode } from '../_shared/eventCodePolicy.ts'

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

Deno.serve((req) => endpoint(req, async ({ admin, user, pepper, body }) => {
  await enforceRateLimit(admin, pepper, req, user.id, 'CREATE_EVENT', 5)
  const name = text(body.name)
  const eventDate = text(body.eventDate)
  const expectedParticipants = Number(body.expectedParticipants)
  const requestedParticipantCode = canonicalizeEventCode(text(body.requestedParticipantCode))
  const scheduledStartAt = text(body.scheduledStartAt) || null
  const scheduledEndAt = text(body.scheduledEndAt) || null
  const endMessage = text(body.endMessage) || null
  if (name.length < 1 || name.length > 120) throw new HttpError(400, 'INVALID_EVENT_NAME')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw new HttpError(400, 'INVALID_EVENT_DATE')
  if (!Number.isInteger(expectedParticipants) || expectedParticipants < 1 || expectedParticipants > 10_000) throw new HttpError(400, 'INVALID_EXPECTED_PARTICIPANTS')
  if (requestedParticipantCode && !isParticipantEventCode(requestedParticipantCode)) throw new HttpError(400, 'INVALID_PARTICIPANT_CODE_FORMAT')
  if (scheduledStartAt && Number.isNaN(Date.parse(scheduledStartAt))) throw new HttpError(400, 'INVALID_START_TIME')
  if (scheduledEndAt && Number.isNaN(Date.parse(scheduledEndAt))) throw new HttpError(400, 'INVALID_END_TIME')
  if (scheduledStartAt && scheduledEndAt && Date.parse(scheduledEndAt) <= Date.parse(scheduledStartAt)) throw new HttpError(400, 'INVALID_SCHEDULE')
  if (endMessage && endMessage.length > 1000) throw new HttpError(400, 'END_MESSAGE_TOO_LONG')

  const maximumAttempts = requestedParticipantCode ? 1 : 4
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const joinCode = requestedParticipantCode || participantCode()
    const manageCode = operatorCode(joinCode)
    const eventSessionToken = randomToken()
    const { data, error } = await admin.rpc('create_event_internal', {
      target_owner_user_id: user.id,
      target_name: name,
      target_event_date: eventDate,
      target_expected_participants: expectedParticipants,
      target_scheduled_start_at: scheduledStartAt,
      target_scheduled_end_at: scheduledEndAt,
      target_end_message: endMessage,
      target_join_code_digest: await hmacDigest(pepper, 'join-code', joinCode),
      target_operator_code_digest: await hmacDigest(pepper, 'operator-code', manageCode),
      target_session_token_digest: await hmacDigest(pepper, 'event-session', eventSessionToken),
    })
    if (!error) return { event: data, codes: { participantCode: joinCode, operatorCode: manageCode }, eventSessionToken, subjectId: user.id }
    if (error.code !== '23505') throw new HttpError(400, error.message)
    if (requestedParticipantCode) throw new HttpError(409, 'PARTICIPANT_CODE_ALREADY_IN_USE')
  }
  throw new HttpError(503, 'CODE_GENERATION_RETRY_EXHAUSTED')
}))
