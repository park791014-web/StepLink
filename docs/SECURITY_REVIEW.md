# Dependency and security review

검토일: 2026-09-03

## 설치 방식

직접 dependency의 npm metadata에서 scripts와 dependency를 확인한 뒤 `npm install --ignore-scripts`로 설치했다. install lifecycle은 실행하지 않았다. 외부 Git 저장소 clone, shell installer, telemetry package는 사용하지 않았다.

## 결과

| 항목 | 결과 |
| --- | --- |
| Capacitor / React / Vite | NativeGpsTest에서 사용한 고정 버전 계열 |
| MapLibre GL JS | 6.7.0, 지도 렌더링에만 사용 |
| GPS dependency | Google Play Services Location 21.4.0 |
| Capgo background-geolocation | 사용하지 않음 |
| Runtime telemetry | 앱 코드에 없음 |
| Credential access | service-role key 없음, public anon env 자리만 제공 |
| Native service exposure | `android:exported=false` |
| 상세 위치 외부 전송 | Phase 1에는 전송 코드 없음 |

`npm audit`은 moderate 3건을 보고했다. 모두 개발용 `@capacitor/cli → xcode → uuid` 경로이며 Android runtime bundle에는 포함되지 않는다. high/critical은 0건이다. 제안된 자동 해결은 Capacitor CLI downgrade이므로 `audit fix --force`를 실행하지 않았다.

## 후속 보안 gate

- 행사 코드와 운영 코드는 서버에서 rate limit 후 digest 비교한다. DB plain code 저장 금지.
- participant/recovery token은 Android Keystore 기반 암호화 저장으로 교체한다.
- Supabase anon key + RLS만 앱에 사용하고 service role은 trusted backend에만 둔다.
- custom sticker는 byte limit, MIME sniffing, raster re-encoding을 적용하고 active SVG는 거부한다.
- RLS migration은 Phase 2에서 local Supabase policy test를 통과한 뒤 적용한다.
