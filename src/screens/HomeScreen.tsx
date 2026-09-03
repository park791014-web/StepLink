import { AppHeader } from '../components/AppHeader'
import { CompassIcon, FootIcon, GroupIcon } from '../shared/icons'

interface Props { navigate: (screen: 'personal' | 'participant' | 'operator' | 'settings') => void }

export function HomeScreen({ navigate }: Props) {
  return (
    <div className="screen home-screen">
      <AppHeader settings={() => navigate('settings')} />
      <main className="home-content">
        <section className="welcome">
          <span className="eyebrow">MOVE · CONNECT · REMEMBER</span>
          <h1>오늘의 걸음을<br/><em>하나의 이야기로.</em></h1>
          <p>나만의 운동부터 모두가 함께하는 행사까지, 길 위의 모든 순간을 연결합니다.</p>
        </section>
        <section className="entry-grid" aria-label="시작 메뉴">
          <button className="entry-card primary-card" onClick={() => navigate('personal')}>
            <span className="entry-icon"><FootIcon /></span>
            <span className="entry-copy"><strong>개인 운동</strong><small>걷기와 달리기를 자유롭게 기록해요</small></span>
            <span className="entry-arrow">시작</span>
          </button>
          <button className="entry-card" onClick={() => navigate('participant')}>
            <span className="entry-icon coral"><GroupIcon /></span>
            <span className="entry-copy"><strong>행사 참가</strong><small>행사 코드로 간편하게 함께해요</small></span>
            <span className="entry-arrow">입장</span>
          </button>
          <button className="entry-card" onClick={() => navigate('operator')}>
            <span className="entry-icon blue"><CompassIcon /></span>
            <span className="entry-copy"><strong>행사 운영</strong><small>참가자와 진행 상황을 한눈에</small></span>
            <span className="entry-arrow">관리</span>
          </button>
        </section>
        <p className="privacy-line"><span>●</span> 상세 경로와 사진은 내 휴대폰에 안전하게 보관됩니다</p>
      </main>
    </div>
  )
}
