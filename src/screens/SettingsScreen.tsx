import { useState } from 'react'
import { AppHeader } from '../components/AppHeader'
import { BatteryIcon, ChevronIcon, MapPinIcon, SatelliteIcon } from '../shared/icons'

interface Settings { notifications: boolean; voice: boolean; keepScreenOn: boolean; unit: 'km' | 'mile'; language: 'ko' | 'en'; mapMode: 'standard' | 'high-contrast' }
const defaults: Settings = { notifications: true, voice: false, keepScreenOn: false, unit: 'km', language: 'ko', mapMode: 'standard' }
const load = () => { try { return { ...defaults, ...JSON.parse(localStorage.getItem('steplink.settings.v1') ?? '{}') } as Settings } catch { return defaults } }

export function SettingsScreen({ back, diagnostics }: { back: () => void; diagnostics: () => void }) {
  const [settings, setSettings] = useState(load)
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => { const next = { ...settings, [key]: value }; setSettings(next); localStorage.setItem('steplink.settings.v1', JSON.stringify(next)) }
  return (
    <div className="screen light-screen">
      <AppHeader title="설정" subtitle="StepLink 0.3.1" back={back} />
      <main className="content settings-content">
        <section className="settings-group"><h2>활동 안내</h2>
          <Toggle label="알림" detail="기록 상태와 행사 공지" value={settings.notifications} change={(value) => update('notifications', value)} />
          <Toggle label="음성 안내" detail="향후 거리별 안내 확장" value={settings.voice} change={(value) => update('voice', value)} />
          <Toggle label="화면 켜짐 유지" detail="운동 화면을 계속 표시" value={settings.keepScreenOn} change={(value) => update('keepScreenOn', value)} />
        </section>
        <section className="settings-group"><h2>표시</h2>
          <SelectRow label="언어" value={settings.language} change={(value) => update('language', value as Settings['language'])}><option value="ko">한국어</option><option value="en">English</option></SelectRow>
          <SelectRow label="거리 단위" value={settings.unit} change={(value) => update('unit', value as Settings['unit'])}><option value="km">킬로미터 (km)</option><option value="mile">마일 (mile)</option></SelectRow>
          <SelectRow label="지도 표시" value={settings.mapMode} change={(value) => update('mapMode', value as Settings['mapMode'])}><option value="standard">기본</option><option value="high-contrast">고대비</option></SelectRow>
        </section>
        <section className="settings-group"><h2>기기 및 데이터</h2>
          <button className="settings-link" onClick={diagnostics}><span className="mini-icon"><SatelliteIcon/></span><span><strong>GPS 상태</strong><small>수신·native 기록 진단</small></span><ChevronIcon/></button>
          <button className="settings-link" onClick={diagnostics}><span className="mini-icon"><BatteryIcon/></span><span><strong>배터리 상태</strong><small>소모량과 최적화 설정</small></span><ChevronIcon/></button>
          <button className="settings-link" onClick={() => window.alert('상세 GPS와 사진은 기본적으로 이 휴대폰에만 저장됩니다.')}><span className="mini-icon"><MapPinIcon/></span><span><strong>개인정보 / 데이터 관리</strong><small>Rich on the phone, minimal on the server</small></span><ChevronIcon/></button>
        </section>
        <section className="app-about"><img src="/brand/steplink-mark.svg" alt=""/><div><strong>StepLink</strong><span>Version 0.3.1 · Build 5 · Android first</span></div></section>
      </main>
    </div>
  )
}

function Toggle({ label, detail, value, change }: { label: string; detail: string; value: boolean; change: (value: boolean) => void }) {
  return <label className="setting-row"><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" checked={value} onChange={(event) => change(event.target.checked)} /><i /></label>
}
function SelectRow({ label, value, change, children }: { label: string; value: string; change: (value: string) => void; children: React.ReactNode }) {
  return <label className="setting-row select-row"><strong>{label}</strong><select value={value} onChange={(event) => change(event.target.value)}>{children}</select></label>
}
