import type { Session } from '@supabase/supabase-js'
import type { CreateEventInput, EventActionResult, EventRecord, EventSession, JoinParticipantInput, SecureEventSessionSnapshot, SecureSessionSecrets } from '../../domain/event/eventTypes'
import type { EventStatus, Role } from '../../domain/models'
import { getSupabaseClient, supabaseConfiguration } from './supabaseClient'
import { requireVisibleEventRow } from './eventGatewayErrors'

export { StaleEventSessionError } from './eventGatewayErrors'

interface EventRow {
  id: string; owner_user_id: string; name: string; event_date: string; expected_participants: number
  scheduled_start_at: string | null; scheduled_end_at: string | null; end_message: string | null
  status: EventStatus; created_at: string; started_at: string | null; ended_at: string | null
}

const mapEvent = (row: EventRow): EventRecord => ({
  id: row.id, ownerUserId: row.owner_user_id, name: row.name, eventDate: row.event_date,
  expectedParticipants: row.expected_participants, scheduledStartAt: row.scheduled_start_at,
  scheduledEndAt: row.scheduled_end_at, endMessage: row.end_message, status: row.status,
  createdAt: row.created_at, startedAt: row.started_at, endedAt: row.ended_at,
})

function secretsFromSession(session: Session, eventSessionToken: string): SecureSessionSecrets {
  return { accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: session.expires_at ?? null, eventSessionToken }
}

async function ensureAuth() {
  const client = getSupabaseClient()
  const existing = (await client.auth.getSession()).data.session
  if (existing) return existing
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.session) throw new Error(error?.message ?? '익명 사용자 세션을 만들지 못했습니다.')
  return data.session
}

async function invoke<T>(name: string, body: object): Promise<T> {
  const client = getSupabaseClient()
  const { data, error } = await client.functions.invoke(name, { body })
  if (error) {
    let detail = error.message
    const context = 'context' in error ? error.context : null
    if (context instanceof Response) {
      try { const payload = await context.clone().json() as { error?: string }; detail = payload.error ?? detail } catch { /* response was not JSON */ }
    }
    throw new Error(detail)
  }
  return data as T
}

export const eventGateway = {
  configuration: supabaseConfiguration,

  async createEvent(input: CreateEventInput): Promise<EventActionResult> {
    const auth = await ensureAuth()
    const data = await invoke<{ event: EventRow; codes: { participantCode: string; operatorCode: string }; eventSessionToken: string; subjectId: string }>('event-create', input)
    return { session: { event: mapEvent(data.event), role: 'OWNER', subjectId: data.subjectId }, codes: data.codes, secrets: secretsFromSession(auth, data.eventSessionToken) }
  },

  async joinParticipant(input: JoinParticipantInput): Promise<EventActionResult> {
    const auth = await ensureAuth()
    const data = await invoke<{ event: EventRow; participant: { id: string; participantIdentifier: string; displayName: string }; recovered: boolean; eventSessionToken: string }>('event-join', input)
    return {
      session: { event: mapEvent(data.event), role: 'PARTICIPANT', subjectId: data.participant.id, participantIdentifier: data.participant.participantIdentifier, displayName: data.participant.displayName, recovered: data.recovered },
      secrets: secretsFromSession(auth, data.eventSessionToken),
    }
  },

  async joinOperator(operatorCode: string): Promise<EventActionResult> {
    const auth = await ensureAuth()
    const data = await invoke<{ event: EventRow; membership: { userId: string; role: Role }; eventSessionToken: string }>('operator-join', { operatorCode })
    return { session: { event: mapEvent(data.event), role: data.membership.role, subjectId: data.membership.userId }, secrets: secretsFromSession(auth, data.eventSessionToken) }
  },

  async restore(snapshot: SecureEventSessionSnapshot): Promise<EventSession> {
    const client = getSupabaseClient()
    const existingAuthSession = (await client.auth.getSession()).data.session
    if (!existingAuthSession) {
      const { data, error } = await client.auth.setSession({ access_token: snapshot.secrets.accessToken, refresh_token: snapshot.secrets.refreshToken })
      if (error || !data.session) throw new Error(error?.message ?? 'Supabase 인증 세션을 복원하지 못했습니다.')
    }
    const result = await invoke<{ event: EventRow; role: Role; subjectId: string; participantIdentifier?: string; displayName?: string }>('event-session-validate', {
      eventId: snapshot.eventId, role: snapshot.role, subjectId: snapshot.subjectId, eventSessionToken: snapshot.secrets.eventSessionToken,
    })
    return { event: mapEvent(result.event), role: result.role, subjectId: result.subjectId, participantIdentifier: result.participantIdentifier, displayName: result.displayName, recovered: true }
  },

  async transition(eventId: string, targetStatus: EventStatus): Promise<EventRecord> {
    const client = getSupabaseClient()
    const { data, error } = await client.rpc('transition_event', { target_event: eventId, target_status: targetStatus })
    if (error) throw new Error(error.message)
    return mapEvent(data as EventRow)
  },

  async refreshEvent(eventId: string): Promise<EventRecord> {
    const client = getSupabaseClient()
    const { data, error } = await client.from('events').select('id,owner_user_id,name,event_date,expected_participants,scheduled_start_at,scheduled_end_at,end_message,status,created_at,started_at,ended_at').eq('id', eventId).maybeSingle()
    if (error) throw new Error(error.message)
    return mapEvent(requireVisibleEventRow(data as EventRow | null))
  },

  async currentAuthSecrets(previous: SecureSessionSecrets) {
    const session = (await getSupabaseClient().auth.getSession()).data.session
    if (!session) throw new Error('인증 세션이 없습니다.')
    return { ...secretsFromSession(session, previous.eventSessionToken), ownerCodes: previous.ownerCodes }
  },

  onAuthChanged(callback: (session: Session) => void) {
    if (!supabaseConfiguration.configured) return () => undefined
    const { data } = getSupabaseClient().auth.onAuthStateChange((event, session) => {
      if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session) callback(session)
    })
    return () => data.subscription.unsubscribe()
  },

  async signOut() {
    if (supabaseConfiguration.configured) await getSupabaseClient().auth.signOut({ scope: 'local' })
  },
}
