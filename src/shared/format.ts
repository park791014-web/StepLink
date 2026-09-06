export const formatDistance = (meters: number) => (meters / 1000).toFixed(2)
export const formatPace = (minutesPerKm: number | null) => {
  if (minutesPerKm === null || !Number.isFinite(minutesPerKm)) return '—'
  const minutes = Math.floor(minutesPerKm)
  const seconds = Math.round((minutesPerKm - minutes) * 60)
  return `${minutes}'${seconds.toString().padStart(2, '0')}"`
}
export const formatClock = (timestamp: number | null) => timestamp ? new Date(timestamp).toLocaleTimeString('ko-KR', { hour12: false }) : '—'
export const relativeTime = (iso: string | null, now = Date.now()) => {
  if (!iso) return '수신 없음'
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return `${seconds}초 전`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}분 ${seconds % 60}초 전`
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 전`
}
