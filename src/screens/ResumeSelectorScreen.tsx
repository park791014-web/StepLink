import type { Activity } from '../domain/models'
import type { EventSession } from '../domain/event/eventTypes'
import { AppHeader } from '../components/AppHeader'
import { FootIcon, GroupIcon } from '../shared/icons'

export function ResumeSelectorScreen({ activity, eventSession, choose }: { activity: Activity; eventSession: EventSession; choose: (value: 'activity' | 'event') => void }) {
  return (
    <div className="screen light-screen">
      <AppHeader title="이어서 하기" subtitle={activity.eventContext?.active ? '하나의 활동 · 두 화면' : '진행 중인 세션'} />
      <main className="content resume-content">
        <div className="section-heading"><span className="eyebrow">RESUME</span><h1>진행 중인 활동</h1><p>{activity.eventContext?.active ? '하나의 GPS 활동에 행사 참여가 연결되어 있습니다. 아래 선택은 화면만 바꾸며 기록과 전송은 계속됩니다.' : '활동 기록과 행사 세션이 모두 남아 있습니다. 선택한 화면만 먼저 엽니다.'}</p></div>
        <button className="resume-card event" onClick={() => choose('event')}><span><GroupIcon/></span><div><small>{eventSession.role} · {eventSession.event.status}</small><strong>{eventSession.event.name}</strong><p>행사 세션으로 돌아가기</p></div><i>→</i></button>
        <button className="resume-card" onClick={() => choose('activity')}><span><FootIcon/></span><div><small>{activity.type} · {activity.status}</small><strong>운동 정보 보기</strong><p>같은 GPS 활동의 거리와 시간을 확인합니다</p></div><i>→</i></button>
      </main>
    </div>
  )
}
