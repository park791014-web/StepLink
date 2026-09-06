import { Capacitor, registerPlugin } from '@capacitor/core'
import type { ActiveActivityResult, Activity, ActivityPoint, ActivityType, NativeDiagnostics, TrackingProfile } from '../../domain/models'

interface NativeGpsPlugin {
  requestPermissionsForTracking(): Promise<{ location: string; notifications: boolean }>
  start(options: { activityId: string; activityType: ActivityType; profile: TrackingProfile }): Promise<void>
  pause(options: { activityId: string }): Promise<void>
  resume(options: { activityId: string; profile: TrackingProfile }): Promise<void>
  end(options: { activityId: string }): Promise<{ activity: Activity }>
  ensureEventActivity(options: { eventId: string; participantId: string; eventName: string; activityType: ActivityType; profile: TrackingProfile }): Promise<{ activity: Activity; created: boolean }>
  endEventActivityContext(options: { eventId: string; participantId: string }): Promise<{ activity: Activity | null; endedActivity: boolean }>
  readPoints(options: { activityId: string; afterSequence: number }): Promise<{ points: ActivityPoint[] }>
  getActivity(options: { activityId: string }): Promise<{ activity: Activity }>
  getActiveActivity(): Promise<ActiveActivityResult>
  listCompletedActivities(options: { limit?: number }): Promise<{ activities: Activity[] }>
  getDiagnostics(options: { activityId?: string }): Promise<NativeDiagnostics>
  openSettings(): Promise<void>
}

export const NativeGps = registerPlugin<NativeGpsPlugin>('NativeGps')
export const nativeGpsAvailable = () => Capacitor.isNativePlatform()

export const emptyDiagnostics: NativeDiagnostics = {
  available: false,
  serviceActive: false,
  gpsEnabled: false,
  nativePointCount: 0,
  lastSequence: 0,
  nativeLastTimestamp: null,
  currentBatteryPct: null,
  batteryStartPct: null,
  batteryDropPct: null,
  batteryDrainPctPerHour: null,
  charging: false,
  batteryOptimizationIgnored: false,
  profile: null,
}
