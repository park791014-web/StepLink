import type { Activity, ActivityPoint } from '../domain/models'
import { averageKph, estimatedCalories, formatDuration, paceMinutesPerKm } from '../domain/activity/activityMath'
import { AppHeader } from '../components/AppHeader'
import { LazyRouteMap } from '../components/LazyRouteMap'
import { formatDistance, formatPace } from '../shared/format'

export function SummaryScreen({ activity, points, done }: { activity: Activity; points: ActivityPoint[]; done: () => void }) {
  const elapsed = Math.max(0, (activity.endedAt ?? Date.now()) - activity.startedAt - activity.pauseDurationMs)
  return (
    <div className="screen light-screen">
      <AppHeader title="활동 요약" subtitle="기록이 안전하게 저장됐어요" />
      <main className="content summary-content">
        <div className="summary-seal"><span>✓</span><small>COMPLETED</small></div>
        <h1>오늘도 한 걸음,<br/><em>멋지게 완료했어요.</em></h1>
        <LazyRouteMap points={points} compact />
        <section className="summary-grid">
          <div className="summary-main"><strong>{formatDistance(activity.filteredDistanceM)}</strong><span>km</span><small>총 거리</small></div>
          <div><strong>{formatDuration(elapsed)}</strong><small>총 시간</small></div>
          <div><strong>{formatPace(paceMinutesPerKm(activity.filteredDistanceM, activity.movingTimeMs))}</strong><small>평균 페이스</small></div>
          <div><strong>{averageKph(activity.filteredDistanceM, activity.movingTimeMs).toFixed(1)} km/h</strong><small>평균 속도</small></div>
          <div><strong>{estimatedCalories(activity.filteredDistanceM, 65, activity.type)} kcal</strong><small>예상 칼로리</small></div>
        </section>
        <p className="local-badge">휴대폰에 저장됨 · 상세 GPS는 서버로 전송되지 않았습니다</p>
        <button className="secondary-button" onClick={done}>홈으로</button>
      </main>
    </div>
  )
}
