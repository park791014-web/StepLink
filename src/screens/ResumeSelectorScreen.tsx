import type { Activity } from '../domain/models'
import type { EventSession } from '../domain/event/eventTypes'
import { AppHeader } from '../components/AppHeader'
import { FootIcon, GroupIcon } from '../shared/icons'

export function ResumeSelectorScreen({ activity, eventSession, choose }: { activity: Activity; eventSession: EventSession; choose: (value: 'activity' | 'event') => void }) {
  return (
    <div className="screen light-screen">
      <AppHeader title="이어서 하기" subtitle="진행 중인 기록 2개" />
      <main className="content resume-content">
        <div className="section-heading"><span className="eyebrow">RESUME</span><h1>어디로 돌아갈까요?</h1><p>개인 운동과 행사 세션이 모두 남아 있습니다. 어느 데이터도 삭제하지 않고 선택한 화면만 먼저 엽니다.</p></div>
        <button className="resume-card event" onClick={() => choose('event')}><span><GroupIcon/></span><div><small>{eventSession.role} · {eventSession.event.status}</small><strong>{eventSession.event.name}</strong><p>행사 세션으로 돌아가기</p></div><i>→</i></button>
        <button className="resume-card" onClick={() => choose('activity')}><span><FootIcon/></span><div><small>{activity.type} · {activity.status}</small><strong>개인 운동 기록</strong><p>GPS 활동 화면으로 돌아가기</p></div><i>→</i></button>
      </main>
    </div>
  )
}
