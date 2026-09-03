import { useState } from 'react'
import type { ActivityType, TrackingProfile } from '../domain/models'
import { AppHeader } from '../components/AppHeader'
import { FootIcon, RunIcon } from '../shared/icons'

const types: { id: ActivityType; label: string; detail: string; icon: string }[] = [
  { id: 'WALK', label: '걷기', detail: '편안한 걸음', icon: 'walk' },
  { id: 'RUN', label: '달리기', detail: '나만의 페이스', icon: 'run' },
  { id: 'FREE', label: '자유 활동', detail: '종류 제한 없이', icon: 'free' },
  { id: 'AUTO', label: 'AUTO', detail: '활동 자동 분류', icon: 'auto' },
]

interface Props { back: () => void; begin: (type: ActivityType, profile: TrackingProfile) => Promise<void>; error: string | null }

export function PersonalSetupScreen({ back, begin, error }: Props) {
  const [type, setType] = useState<ActivityType>('WALK')
  const [profile, setProfile] = useState<TrackingProfile>('balanced')
  const [starting, setStarting] = useState(false)
  const start = async () => {
    setStarting(true)
    try { await begin(type, profile) } finally { setStarting(false) }
  }
  return (
    <div className="screen light-screen">
      <AppHeader title="개인 운동" subtitle="나만의 리듬으로" back={back} />
      <main className="content setup-content">
        <section className="section-heading"><span className="eyebrow">ACTIVITY</span><h1>어떤 움직임을<br/>기록할까요?</h1></section>
        <div className="activity-types">
          {types.map((item) => (
            <button key={item.id} className={`activity-type ${type === item.id ? 'selected' : ''}`} onClick={() => setType(item.id)}>
              <span className="activity-type-icon">{item.icon === 'run' ? <RunIcon /> : item.icon === 'walk' ? <FootIcon /> : item.icon === 'free' ? '∞' : 'A'}</span>
              <strong>{item.label}</strong><small>{item.detail}</small>
            </button>
          ))}
        </div>
        <section className="profile-card">
          <div><span className="eyebrow">GPS PROFILE</span><h2>위치 기록 모드</h2></div>
          <select value={profile} onChange={(event) => setProfile(event.target.value as TrackingProfile)}>
            <option value="accurate">Accurate · 3초 / 5m</option>
            <option value="balanced">Balanced · 5초 / 10m</option>
            <option value="battery">Battery Saver · 15초 / 25m</option>
          </select>
          <p>Balanced는 경로 품질과 배터리 사용량 사이의 기본 권장값입니다.</p>
        </section>
        {error && <p className="error-banner">{error}</p>}
        <button className="start-button" onClick={() => void start()} disabled={starting}><span>{starting ? 'GPS 준비 중…' : '기록 시작'}</span><i>→</i></button>
        <p className="start-note">시작하면 Android 알림에 위치 기록 상태가 표시됩니다.</p>
      </main>
    </div>
  )
}
