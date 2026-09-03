export type Role = 'OWNER' | 'OPERATOR' | 'PARTICIPANT'
export type ActivityType = 'WALK' | 'RUN' | 'FREE' | 'AUTO'
export type ActivityStatus = 'READY' | 'ACTIVE' | 'PAUSED' | 'COMPLETED'
export type TrackingProfile = 'accurate' | 'balanced' | 'battery'
export type EventStatus = 'DRAFT' | 'OPEN' | 'ACTIVE' | 'ENDED'
export type ParticipantStatus = 'NORMAL' | 'STALE_LOCATION' | 'LONG_STOP' | 'COURSE_DEVIATION' | 'HELP_REQUEST' | 'COMPLETED' | 'OFFLINE'

export interface Activity {
  id: string
  eventId: string | null
  type: ActivityType
  status: ActivityStatus
  profile: TrackingProfile
  startedAt: number
  pausedAt: number | null
  endedAt: number | null
  pauseDurationMs: number
  rawDistanceM: number
  filteredDistanceM: number
  movingTimeMs: number
  stoppedTimeMs: number
  pointCount: number
}

export interface ActivityPoint {
  activityId: string
  sequence: number
  timestamp: number
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  bearing: number | null
  altitude: number | null
  provider: string | null
  mock: boolean
  storedAt: number
  rawSegmentDistanceM: number
  filteredSegmentDistanceM: number
  classification: 'walkingCandidate' | 'runningCandidate' | 'highSpeedCandidate' | 'unknown'
  acceptedForMetrics: boolean
  filterReason: string | null
}

export interface NativeDiagnostics {
  available: boolean
  serviceActive: boolean
  gpsEnabled: boolean
  nativePointCount: number
  lastSequence: number
  nativeLastTimestamp: number | null
  currentBatteryPct: number | null
  batteryStartPct: number | null
  batteryDropPct: number | null
  batteryDrainPctPerHour: number | null
  charging: boolean
  batteryOptimizationIgnored: boolean
  profile: TrackingProfile | null
}

export interface ActiveActivityResult { activity: Activity | null }
