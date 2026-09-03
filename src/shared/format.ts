export const formatDistance = (meters: number) => (meters / 1000).toFixed(2)
export const formatPace = (minutesPerKm: number | null) => {
  if (minutesPerKm === null || !Number.isFinite(minutesPerKm)) return '—'
  const minutes = Math.floor(minutesPerKm)
  const seconds = Math.round((minutesPerKm - minutes) * 60)
  return `${minutes}'${seconds.toString().padStart(2, '0')}"`
}
export const formatClock = (timestamp: number | null) => timestamp ? new Date(timestamp).toLocaleTimeString('ko-KR', { hour12: false }) : '—'
