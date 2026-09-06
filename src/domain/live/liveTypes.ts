import type { ParticipantStatus } from '../models'
import type { HelpStatus, MessageTargetType } from './livePolicy'

export type ParticipantLocationVisibility = 'NONE' | 'ANONYMOUS_CURRENT'
export const DEFAULT_PARTICIPANT_LOCATION_VISIBILITY: ParticipantLocationVisibility = 'ANONYMOUS_CURRENT'

export interface LiveStateInput {
  eventId: string
  participantId: string
  latitude: number
  longitude: number
  accuracyM: number | null
  distanceM: number
  elapsedTimeMs: number
  clientSequence: number
}

export interface PeerLocation {
  latitude: number
  longitude: number
  lastReceivedAt: string
}

export interface DashboardParticipant {
  id: string
  displayName: string
  participantIdentifier: string
  grade: string | null
  className: string | null
  latitude: number | null
  longitude: number | null
  accuracyM: number | null
  distanceM: number
  elapsedTimeMs: number
  clientSequence: number
  lastReceivedAt: string | null
  status: ParticipantStatus
  helpRequestId: string | null
  helpStatus: HelpStatus | null
  helpType: HelpType | null
  helpCreatedAt: string | null
}

export interface EventMessage {
  id: string
  body: string
  senderUserId: string
  targetType: MessageTargetType
  targetValue: string | null
  createdAt: string
}

export type HelpType = 'INJURY' | 'LOST' | 'COMPANION' | 'OTHER'
export interface HelpRequest {
  id: string
  participantId: string
  type: HelpType
  status: HelpStatus
  latitude: number | null
  longitude: number | null
  accuracyM: number | null
  createdAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
}
