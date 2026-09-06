import { useEffect, useState } from 'react'
import type { Activity, ActivityPoint } from '../domain/models'
import { AppHeader } from '../components/AppHeader'
import { NativeGps, nativeGpsAvailable } from '../infrastructure/native/nativeGps'
import { formatDistance } from '../shared/format'
import { formatDuration } from '../domain/activity/activityMath'

interface Props {
  back: () => void
  open: (activity: Activity, points: ActivityPoint[]) => void
}

const activityLabel = (activity: Activity) => activity.type === 'RUN' ? '달리기' : activity.type === 'WALK' ? '걷기' : '자유 활동'
const elapsed = (activity: Activity) => Math.max(0, (activity.endedAt ?? activity.startedAt) - activity.startedAt - activity.pauseDurationMs)
const completedAt = (activity: Activity) => new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(activity.endedAt ?? activity.startedAt))

export function ActivityHistoryScreen({ back, open }: Props) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        if (!nativeGpsAvailable()) throw new Error('활동 기록은 Android 앱에서 확인할 수 있습니다.')
        const result = await NativeGps.listCompletedActivities({ limit: 100 })
        if (active) setActivities(result.activities)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  const select = async (activity: Activity) => {
    setOpeningId(activity.id)
    setError(null)
    try {
      const result = await NativeGps.readPoints({ activityId: activity.id, afterSequence: 0 })
      open(activity, result.points)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setOpeningId(null)
    }
  }

  return (
    <div className="screen light-screen">
      <AppHeader title="활동 기록" subtitle="이 휴대폰에 저장된 완료 활동" back={back} />
      <main className="content history-content">
        {loading && <p className="empty-list">기록을 불러오는 중…</p>}
        {!loading && activities.length === 0 && <p className="empty-list">아직 완료된 활동이 없습니다.</p>}
        {error && <p className="error-banner">{error}</p>}
        <section className="history-list" aria-label="완료 활동 목록">
          {activities.map((activity) => (
            <button className="history-item" key={activity.id} disabled={openingId === activity.id} onClick={() => void select(activity)}>
              <span className="history-item-top"><strong>{activity.eventContext?.eventName ?? activityLabel(activity)}</strong><small>완료</small></span>
              <span className="history-item-meta">{completedAt(activity)} · {activity.eventContext ? `행사 ${activityLabel(activity)}` : activityLabel(activity)}</span>
              <span className="history-item-stats"><b>{formatDistance(activity.filteredDistanceM)} km</b><b>{formatDuration(elapsed(activity))}</b></span>
            </button>
          ))}
        </section>
      </main>
    </div>
  )
}
