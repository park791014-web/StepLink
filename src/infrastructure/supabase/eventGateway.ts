import type { Session } from '@supabase/supabase-js'
import type { CreateEventInput, EventActionResult, EventRecord, EventSession, JoinParticipantInput, SecureEventSessionSnapshot, SecureSessionSecrets } from '../../domain/event/eventTypes'
import type { EventStatus, Role } from '../../domain/models'
import type { DashboardParticipant, EventMessage, HelpRequest, HelpType, LiveStateInput, PeerLocation } from '../../domain/live/liveTypes'
import type { HelpStatus, MessageTargetType } from '../../domain/live/livePolicy'
import { effectiveParticipantStatus } from '../../domain/live/livePolicy'
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

  async uploadLiveState(input: LiveStateInput) {
    const { data, error } = await getSupabaseClient().rpc('upsert_participant_live_state_v1', {
      target_event: input.eventId,
      target_participant: input.participantId,
      target_latitude: input.latitude,
      target_longitude: input.longitude,
      target_accuracy_m: input.accuracyM,
      target_distance_m: input.distanceM,
      target_elapsed_time_ms: input.elapsedTimeMs,
      target_client_sequence: input.clientSequence,
    })
    if (error) throw new Error(error.message)
    return data as { accepted: boolean; clientSequence: number; lastReceivedAt: string }
  },

  async fetchDashboard(eventId: string): Promise<DashboardParticipant[]> {
    const client = getSupabaseClient()
    const [participantResult, liveResult, helpResult] = await Promise.all([
      client.from('participants').select('id,display_name,participant_identifier,grade,class_name').eq('event_id', eventId).order('display_name'),
      client.from('participant_live_state').select('participant_id,latitude,longitude,accuracy_m,distance_m,elapsed_time_ms,client_sequence,last_received_at').eq('event_id', eventId),
      client.from('help_requests').select('id,participant_id,status,request_type,latitude,longitude,accuracy_m,location_received_at,created_at').eq('event_id', eventId).in('status', ['OPEN', 'ACKNOWLEDGED']).order('created_at', { ascending: false }),
    ])
    const firstError = participantResult.error ?? liveResult.error ?? helpResult.error
    if (firstError) throw new Error(firstError.message)
    const liveByParticipant = new Map((liveResult.data ?? []).map((row) => [row.participant_id, row]))
    const helpByParticipant = new Map<string, { id: string; status: HelpStatus; type: HelpType; latitude: number | null; longitude: number | null; accuracyM: number | null; locationReceivedAt: string | null; createdAt: string }>()
    for (const row of helpResult.data ?? []) if (!helpByParticipant.has(row.participant_id)) helpByParticipant.set(row.participant_id, { id: row.id, status: row.status as HelpStatus, type: row.request_type as HelpType, latitude: row.latitude, longitude: row.longitude, accuracyM: row.accuracy_m, locationReceivedAt: row.location_received_at, createdAt: row.created_at })
    return (participantResult.data ?? []).map((row) => {
      const live = liveByParticipant.get(row.id)
      const help = helpByParticipant.get(row.id)
      return {
        id: row.id,
        displayName: row.display_name,
        participantIdentifier: row.participant_identifier,
        grade: row.grade,
        className: row.class_name,
        latitude: live?.latitude ?? help?.latitude ?? null,
        longitude: live?.longitude ?? help?.longitude ?? null,
        accuracyM: live?.accuracy_m ?? help?.accuracyM ?? null,
        distanceM: live?.distance_m ?? 0,
        elapsedTimeMs: live?.elapsed_time_ms ?? 0,
        clientSequence: live?.client_sequence ?? 0,
        lastReceivedAt: live?.last_received_at ?? help?.locationReceivedAt ?? null,
        status: effectiveParticipantStatus(live?.last_received_at ?? null, Boolean(help)),
        helpRequestId: help?.id ?? null,
        helpStatus: help?.status ?? null,
        helpType: help?.type ?? null,
        helpCreatedAt: help?.createdAt ?? null,
      }
    })
  },

  async fetchParticipantMessages(eventId: string): Promise<EventMessage[]> {
    const { data, error } = await getSupabaseClient().from('event_messages')
      .select('id,body,sender_user_id,target_type,target_value,created_at')
      .eq('event_id', eventId).order('created_at', { ascending: false }).limit(20)
    if (error) throw new Error(error.message)
    return (data ?? []).map((row) => ({
      id: row.id, body: row.body, senderUserId: row.sender_user_id,
      targetType: row.target_type as MessageTargetType, targetValue: row.target_value, createdAt: row.created_at,
    }))
  },

  async fetchParticipantHelp(eventId: string, participantId: string): Promise<HelpRequest[]> {
    const { data, error } = await getSupabaseClient().from('help_requests')
      .select('id,participant_id,request_type,status,latitude,longitude,accuracy_m,created_at,acknowledged_at,resolved_at')
      .eq('event_id', eventId).eq('participant_id', participantId).order('created_at', { ascending: false }).limit(10)
    if (error) throw new Error(error.message)
    return (data ?? []).map(mapHelp)
  },

  async fetchParticipantFeed(eventId: string, participantId: string): Promise<{ messages: EventMessage[]; helpRequests: HelpRequest[] }> {
    const { data, error } = await getSupabaseClient().rpc('get_participant_feed_v1', { target_event: eventId, target_participant: participantId })
    if (error) throw new Error(error.message)
    if (!data) throw new Error('PARTICIPANT_SCOPE_DENIED')
    const feed = data as { messages?: Array<Record<string, unknown>>; helpRequests?: Array<Record<string, unknown>> }
    return {
      messages: (feed.messages ?? []).map((row) => ({
        id: String(row.id), body: String(row.body), senderUserId: String(row.sender_user_id),
        targetType: row.target_type as MessageTargetType, targetValue: row.target_value == null ? null : String(row.target_value), createdAt: String(row.created_at),
      })),
      helpRequests: (feed.helpRequests ?? []).map(mapHelp),
    }
  },

  async fetchParticipantPeerLocations(eventId: string, participantId: string): Promise<PeerLocation[]> {
    const { data, error } = await getSupabaseClient().rpc('get_participant_peer_locations_v1', { target_event: eventId, target_participant: participantId })
    if (error) throw new Error(error.message)
    if (!Array.isArray(data)) return []
    return data.flatMap((row) => {
      if (!row || typeof row !== 'object') return []
      const value = row as { latitude?: unknown; longitude?: unknown; lastReceivedAt?: unknown }
      const latitude = Number(value.latitude); const longitude = Number(value.longitude)
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || typeof value.lastReceivedAt !== 'string') return []
      return [{ latitude, longitude, lastReceivedAt: value.lastReceivedAt }]
    })
  },

  async sendMessage(eventId: string, targetType: MessageTargetType, targetValue: string | null, body: string, participantIds: string[]) {
    const { data, error } = await getSupabaseClient().rpc('send_event_message_v1', {
      target_event: eventId, target_type: targetType, target_value: targetValue,
      target_body: body, target_participant_ids: participantIds,
    })
    if (error) throw new Error(error.message)
    return data
  },

  async createHelp(eventId: string, participantId: string, type: HelpType, location: { latitude: number | null; longitude: number | null; accuracyM: number | null }, idempotencyKey: string) {
    const { data, error } = await getSupabaseClient().rpc('create_help_request_v1', {
      target_event: eventId, target_participant: participantId, target_request_type: type,
      target_latitude: location.latitude, target_longitude: location.longitude,
      target_accuracy_m: location.accuracyM, target_idempotency_key: idempotencyKey,
    })
    if (error) throw new Error(error.message)
    return mapHelp(data as Record<string, unknown>)
  },

  async transitionHelp(requestId: string, status: HelpStatus) {
    const { data, error } = await getSupabaseClient().rpc('transition_help_request_v1', { target_request: requestId, target_status: status })
    if (error) throw new Error(error.message)
    return mapHelp(data as Record<string, unknown>)
  },

  async currentAuthSecrets(previous: SecureSessionSecrets) {
    const session = (await getSupabaseClient().auth.getSession()).data.session
    if (!session) throw new Error('인증 세션이 없습니다.')
    return { ...secretsFromSession(session, previous.eventSessionToken), ownerCodes: previous.ownerCodes }
  },

  async applyAuthSecrets(secrets: SecureSessionSecrets) {
    const { data, error } = await getSupabaseClient().auth.setSession({ access_token: secrets.accessToken, refresh_token: secrets.refreshToken })
    if (error || !data.session) throw new Error(error?.message ?? '갱신된 인증 세션을 적용하지 못했습니다.')
    return secretsFromSession(data.session, secrets.eventSessionToken)
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

function mapHelp(row: Record<string, unknown>): HelpRequest {
  return {
    id: String(row.id), participantId: String(row.participant_id), type: row.request_type as HelpType,
    status: row.status as HelpStatus, latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude), accuracyM: row.accuracy_m == null ? null : Number(row.accuracy_m),
    createdAt: String(row.created_at), acknowledgedAt: row.acknowledged_at == null ? null : String(row.acknowledged_at),
    resolvedAt: row.resolved_at == null ? null : String(row.resolved_at),
  }
}
