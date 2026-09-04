import type { EventStatus, Role } from '../models'

export interface EventRecord {
  id: string
  ownerUserId: string
  name: string
  eventDate: string
  expectedParticipants: number
  scheduledStartAt: string | null
  scheduledEndAt: string | null
  endMessage: string | null
  status: EventStatus
  createdAt: string
  startedAt: string | null
  endedAt: string | null
}

export interface EventSession {
  event: EventRecord
  role: Role
  subjectId: string
  participantIdentifier?: string
  displayName?: string
  recovered?: boolean
}

export interface EventCodes { participantCode: string; operatorCode: string }

export interface SecureSessionSecrets {
  accessToken: string
  refreshToken: string
  eventSessionToken: string
  expiresAt: number | null
  ownerCodes?: EventCodes
}

export interface SecureEventSessionSnapshot {
  eventId: string
  eventName: string
  role: Role
  status: EventStatus
  subjectId: string
  metadata: { participantIdentifier?: string; displayName?: string }
  secrets: SecureSessionSecrets
  savedAt?: number
}

export interface EventActionResult {
  session: EventSession
  secrets: SecureSessionSecrets
  codes?: EventCodes
}

export interface CreateEventInput {
  name: string
  eventDate: string
  expectedParticipants: number
  requestedParticipantCode?: string
  scheduledStartAt?: string
  scheduledEndAt?: string
  endMessage?: string
}

export interface JoinParticipantInput { eventCode: string; participantIdentifier: string; displayName: string }
