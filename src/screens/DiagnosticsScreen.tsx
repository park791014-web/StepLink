import type { Activity, NativeDiagnostics } from '../domain/models'
import { AppHeader } from '../components/AppHeader'
import { formatClock } from '../shared/format'
import { NativeGps, nativeGpsAvailable } from '../infrastructure/native/nativeGps'

export function DiagnosticsScreen({ back, activity, data, uiPoints, recovered }: { back: () => void; activity: Activity | null; data: NativeDiagnostics; uiPoints: number; recovered: number }) {
  const rows = [
    ['환경', nativeGpsAvailable() ? 'Android native' : 'Web preview'],
    ['Foreground service', data.serviceActive ? 'ACTIVE' : 'STOPPED'],
    ['GPS provider', data.gpsEnabled ? 'ON' : '확인 필요'],
    ['프로파일', data.profile ?? activity?.profile ?? '—'],
    ['Native point', String(data.nativePointCount)],
    ['UI point', String(uiPoints)],
    ['복구 point', String(recovered)],
    ['마지막 native 위치', formatClock(data.nativeLastTimestamp)],
    ['현재 배터리', data.currentBatteryPct === null ? '—' : `${data.currentBatteryPct}%`],
    ['시간당 추정 소모', data.batteryDrainPctPerHour === null ? '—' : `${data.batteryDrainPctPerHour.toFixed(2)}%`],
    ['배터리 최적화 제외', data.batteryOptimizationIgnored ? 'YES' : 'NO'],
  ]
  return (
    <div className="screen diagnostic-screen">
      <AppHeader title="GPS 진단" subtitle="Native · UI reconciliation" back={back} />
      <main className="content diagnostics-content">
        <div className={`diagnostic-hero ${data.serviceActive ? 'active' : ''}`}><span>{data.serviceActive ? '●' : '○'}</span><div><strong>{data.serviceActive ? '위치를 기록하고 있습니다' : '현재 기록이 없습니다'}</strong><small>WebView와 독립된 Android native 저장소</small></div></div>
        <section className="diagnostic-list">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
        <p className="diagnostic-help">Native point가 UI point보다 많아도 정상입니다. 화면이 다시 켜지면 sequence 기준으로 누락분을 읽어옵니다.</p>
        {nativeGpsAvailable() && <button className="secondary-button" onClick={() => void NativeGps.openSettings()}>Android 앱 설정 열기</button>}
      </main>
    </div>
  )
}
