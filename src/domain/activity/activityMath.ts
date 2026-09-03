import type { ActivityPoint } from '../models'

const EARTH_RADIUS_M = 6_371_000
const radians = (degrees: number) => (degrees * Math.PI) / 180

export function haversineMeters(a: Pick<ActivityPoint, 'latitude' | 'longitude'>, b: Pick<ActivityPoint, 'latitude' | 'longitude'>) {
  const latitudeDelta = radians(b.latitude - a.latitude)
  const longitudeDelta = radians(b.longitude - a.longitude)
  const latitudeA = radians(a.latitude)
  const latitudeB = radians(b.latitude)
  const h = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((part) => part.toString().padStart(2, '0')).join(':')
}

export function paceMinutesPerKm(distanceM: number, movingTimeMs: number) {
  if (distanceM <= 0 || movingTimeMs <= 0) return null
  return movingTimeMs / 60_000 / (distanceM / 1000)
}

export function averageKph(distanceM: number, movingTimeMs: number) {
  if (distanceM <= 0 || movingTimeMs <= 0) return 0
  return distanceM / 1000 / (movingTimeMs / 3_600_000)
}

export function estimatedCalories(distanceM: number, weightKg = 65, type: 'WALK' | 'RUN' | 'FREE' | 'AUTO' = 'WALK') {
  const factor = type === 'RUN' ? 1.03 : type === 'WALK' ? 0.53 : 0.72
  return Math.round((distanceM / 1000) * weightKg * factor)
}
