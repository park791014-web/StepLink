# StepLink 인수인계

최종 조사일: 2026-09-03  
작업 폴더: `C:\Codex\StepLink`  
현재 버전: `0.1.0`

이 문서는 현재 저장소의 코드와 설정을 최우선 근거로 작성했다. README나 계획 문서와 코드가 충돌하면 실제 코드의 상태를 우선한다. 현재 폴더에는 `.git`이 없으므로 Git 이력, 기준 branch, commit 상태는 확인할 수 없다.

## 1. 현재 범위와 상태

Phase 0은 구현되어 있다. Phase 1은 React/TypeScript 코드, Android native GPS 코드, local SQLite schema까지 작성되어 있으나 **StepLink Android native compile과 APK 생성, 실기기 검증은 아직 완료되지 않았다.**

현재 실제로 구현된 범위:

- 첫 화면의 `개인 운동`, `행사 참가`, `행사 운영` 3개 진입점과 설정 화면
- 개인 운동 유형 `WALK`, `RUN`, `FREE`, `AUTO`
- 위치 프로파일 `accurate`, `balanced`, `battery`
- 개인 운동 start / pause / resume / end UI와 활동 요약
- Android Capacitor custom plugin API와 location foreground service 코드
- `FusedLocationProviderClient` 기반 위치 요청 코드
- `SQLiteOpenHelper` 기반 activity 및 raw point durable storage 코드
- sequence 이후 point만 읽는 React reconciliation
- MapLibre 기반 기본 route 표시와 map provider 추상화
- GPS/native point/UI point/배터리 진단 화면
- 행사·역할·세션 확장을 위한 domain type
- Supabase table/RLS migration 초안

아직 구현되지 않은 범위:

- 실제 행사 생성, 행사 코드 인증, 참가자 등록·복구, 운영자 인증
- Supabase client 연결과 migration 적용/검증
- 참가자 current location 30초 upload와 durable queue worker
- 운영 dashboard, clustering, filter, 공지, 도움 요청
- 코스 편집, finish zone, 코스 이탈, 자동·수동 완주
- 카메라, 사진 합성, sticker, 인증번호·image hash 처리
- CSV/JSON/PDF/XLSX report 구현
- Android Keystore 기반 행사 session/recovery token 저장
- iOS native 구현

행사 참가·운영 화면의 버튼은 현재 Supabase로 연결되지 않고 Phase 2 안내 `window.alert`만 표시한다. 웹 환경에서 개인 운동을 시작하면 UI activity만 만들어지며 실제 GPS point는 수집하지 않는다.

## 2. 버전 및 주요 의존성

버전은 다음 위치에서 모두 `0.1.0`으로 일치한다.

- `package.json`: `version = 0.1.0`
- `android/app/build.gradle`: `versionName = 0.1.0`, `versionCode = 1`
- 설정 UI: `StepLink 0.1.0`
- Capacitor app: `appId = kr.co.steplink.app`, `appName = StepLink`

고정된 주요 버전:

| 항목 | 버전 |
| --- | --- |
| React / React DOM | 19.2.8 |
| Vite | 8.2.2 |
| TypeScript | 5.9.3 |
| Capacitor core / android / CLI | 8.5.1 |
| MapLibre GL JS | 6.7.0 |
| Google Play Services Location | 21.4.0 |
| Android min / target / compile SDK | 24 / 36 / 36 |
| Android Gradle Plugin | 8.13.0 |
| Gradle wrapper | 8.14.3 |

의존성은 `npm install --ignore-scripts`로 설치했다. 확인된 install-script 표시는 Windows에서 사용되지 않는 optional `fsevents 2.3.3`뿐이다. `npm audit`의 최근 결과는 moderate 3건, high/critical 0건이며 moderate는 개발용 `@capacitor/cli → xcode → uuid` 경로다. 강제 downgrade를 제안하므로 `npm audit fix --force`는 실행하지 않았다.

## 3. 현재 정상 동작이 확인된 부분

최근 실행 결과:

| 검증 | 결과 | 비고 |
| --- | --- | --- |
| `npm run test` | PASS | activity math smoke test 1/1 |
| `npm run lint` | PASS | 오류·경고 0 |
| `npm run build` | PASS | TypeScript + Vite production build |
| `npm run cap:sync` | PASS | web assets 및 Android project sync |
| Gradle `assembleDebug` | FAIL | source compile 전 loopback 환경 오류 |
| APK | 없음 | `android/app/build/outputs/apk`에 결과 없음 |
| Android 실기기 | 미실시 | StepLink build가 없어 화면 OFF 검증 전 |

최근 build 산출물은 초기 앱 JS 약 224 KB, gzip 약 71 KB다. MapLibre는 lazy route chunk 약 966 KB, gzip 약 254 KB로 분리됐으며 Vite의 500 KB chunk warning은 남는다.

코드와 웹 빌드 기준으로 확인된 흐름:

- 앱 화면 간 이동과 개인 운동 설정/기록/요약 UI
- 개인 운동 진행 중 5초 주기 reconciliation 구성
- document visibility 복귀 시 즉시 reconciliation 호출
- 활동 계산 함수의 거리, 시간, pace, 평균속도, 칼로리 smoke test
- MapLibre 모듈의 lazy loading
- 설정값의 localStorage 저장
- production web assets의 Android project 복사

Android native 동작은 코드가 존재한다는 사실만 확인됐다. StepLink의 foreground service, SQLite insert, pause/resume, process recreation을 정상 동작으로 확정하려면 Android compile과 실기기 검증이 필요하다.

## 4. Android GPS 구조

핵심 파일:

- `android/app/src/main/java/kr/co/steplink/app/MainActivity.java`
- `android/app/src/main/java/kr/co/steplink/app/NativeGpsPlugin.java`
- `android/app/src/main/java/kr/co/steplink/app/StepLinkLocationService.java`
- `android/app/src/main/java/kr/co/steplink/app/StepLinkDatabase.java`
- `android/app/src/main/AndroidManifest.xml`

의도된 흐름:

```text
사용자 시작
  → Capacitor NativeGps plugin
  → Android location foreground service
  → FusedLocationProviderClient
  → raw location 즉시 native SQLite 저장
  → React가 마지막 sequence 이후 row를 읽어 UI와 지도 갱신
```

`StepLinkLocationService`는 `android:exported=false`, `foregroundServiceType=location`, `stopWithTask=false`, `START_STICKY`로 선언되어 있다. activity id, profile, service 상태는 app-private SharedPreferences에 기록하며 null intent service recreation 경로가 있다. 사용자 force-stop과 제조사별 절전 정책 이후의 자동 복원은 보장하지 않는다.

프로파일의 실제 native 값:

| Profile | interval | min interval | distance | priority | max delay |
| --- | ---: | ---: | ---: | --- | ---: |
| Accurate | 3초 | 1.5초 | 5m | high accuracy | 5초 |
| Balanced | 5초 | 2.5초 | 10m | high accuracy | 5초 |
| Battery Saver | 15초 | 7.5초 | 25m | balanced power | 30초 |

## 5. 로컬 SQLite 상태

DB 이름은 `steplink.db`, schema version은 `1`이며 WAL과 foreign key를 활성화한다.

현재 생성되는 table:

- `activities`: 상태, profile, 시작/일시정지/종료 시각, raw/filtered 거리, moving/stopped time, point count
- `activity_points`: 모든 raw GPS 필드, global sequence, raw/filtered segment, classification, 분석 반영 여부와 사유
- `photos`, `photo_metadata`: Phase 5용 local schema 자리
- `segments`: 구간 기록 확장 자리
- `event_local_state`: 행사 role/session 상태 자리
- `sync_queue`: unique idempotency key, latest-wins key, retry 상태 자리
- `settings`: native 설정 확장 자리
- `diagnostic_events`: service/lifecycle/location 진단 기록

모든 위치 row는 accuracy나 speed 때문에 삭제하지 않는다. 분석용 거리에서만 accuracy 50m 초과, jitter, 짧은 시간의 250m 초과 teleport, 12m/s 초과 implied speed 등을 제외하며 `filter_reason`을 남긴다. 3.5m/s는 `highSpeedCandidate` 분류 기준일 뿐 삭제 기준이 아니다.

주의: `onUpgrade()`는 비어 있다. schema version을 올리기 전에 destructive recreate가 아닌 명시적 migration을 먼저 작성해야 한다.

## 6. React 구조

- `src/App.tsx`: 화면 전환과 복원 routing
- `src/domain/models.ts`: activity/event/role/status type
- `src/domain/activity/useActivityTracker.ts`: native activity 복원, 명령, sequence reconciliation
- `src/infrastructure/native/nativeGps.ts`: Capacitor plugin interface
- `src/infrastructure/session/sessionStore.ts`: 현재 discriminated session envelope
- `src/infrastructure/map/mapProvider.ts`: 지도 style/attribution provider
- `src/components/RouteMap.tsx`: MapLibre route source/layer
- `src/screens/`: home, personal setup, tracker, summary, event entry, settings, diagnostics

앱 실행 시 native `getActiveActivity()`로 `ACTIVE` 또는 `PAUSED` 개인 활동을 먼저 복원한다. 행사 participant/operator session 복원 순서는 문서와 type 수준에서만 준비되어 있으며 구현되지 않았다.

## 7. Supabase 초안 상태

`supabase/migrations/0001_phase0_schema.sql`은 아직 적용하지 않은 Phase 0 초안이다. 다음 table과 RLS policy가 정의돼 있다.

- `events`, `event_access_secrets`, `event_operators`
- `participants`, `participant_live_state`
- `event_messages`, `event_message_recipients`
- `help_requests`, `event_results`
- `photo_verifications`, `event_roster`, `event_stickers`
- `event_courses`, `course_points`

`event_access_secrets`는 member-readable event row와 분리되고 RLS는 활성화되지만 client policy는 없다. 짧은 코드는 단순 hash만으로 보호되지 않으므로 Phase 2의 trusted function/Edge Function에서 server-held pepper, rate limit, idempotent join을 함께 구현해야 한다. participant 생성과 코드 인증은 의도적으로 direct INSERT policy가 없다.

현재 `@supabase/supabase-js` dependency와 실제 Supabase gateway는 없다. migration은 local policy test, role matrix test, recursion/privilege 검토 없이 production에 적용하지 않는다.

## 8. 확정 정책

- 제품 원칙은 **Rich on the phone, minimal on the server**다.
- 상세 GPS, 사진, 상세 segment와 개인 운동 기록은 기본적으로 Android local storage에 보관한다.
- 서버에는 행사 운영용 current state, 결과 요약, 공지, 도움 요청과 최소 사진 인증 metadata만 둔다.
- raw GPS는 보존한다. speed나 accuracy는 classification/filter 분석에만 사용한다.
- GPS canonical 저장은 React callback이나 WebView 상태에 의존하지 않는다.
- 내부 GPS 수집과 서버 upload 주기는 분리한다. 향후 기본 upload 간격은 약 30초다.
- role 이름은 `OWNER`, `OPERATOR`, `PARTICIPANT`를 사용하며 학교 전용 teacher/student로 고정하지 않는다.
- 참가자는 다른 참가자의 위치를 볼 수 없고 친구 위치 기능은 만들지 않는다.
- 운영 코드와 session/recovery token은 plain storage하지 않는다.
- 앱에는 Supabase service-role key를 넣지 않는다. anon key + RLS를 사용한다.
- 기본 course finish는 단일 point가 아니라 radius 기본 100m의 finish zone과 복수 위치 확인을 사용한다.
- MapLibre provider abstraction을 유지하고 OSM public tile을 production에서 직접 대규모 사용하지 않는다.
- Capgo background-geolocation은 핵심 GPS engine으로 사용하지 않는다.
- UI version, package version, Android versionName은 항상 일치시킨다.

## 9. 알려진 문제와 위험

1. **Android native compile 미확인**: Gradle 8.14.3 다운로드 후 `java.io.IOException: Unable to establish loopback connection`으로 source compile 전에 실패했다. Java compile error 유무도 아직 확정할 수 없다.
2. **APK와 실기기 검증 없음**: StepLink의 화면 OFF, background, pause/resume, process recreation은 아직 실기기에서 검증하지 않았다. NativeGpsTest의 검증 구조를 이식했지만 StepLink 자체의 결과로 간주하면 안 된다.
3. **Android backup privacy gap**: Manifest가 현재 `android:allowBackup=true`이고 `steplink.db` 제외 규칙이 없다. 상세 GPS가 OS backup 대상이 될 수 있으므로 release 전에 backup/data extraction 정책을 명시적으로 결정하고 검증해야 한다.
4. **행사 화면은 placeholder**: 행사 참가/운영 code 입력 UI 이후 실제 인증은 없다.
5. **Supabase 미연결**: migration은 draft이며 RLS와 함수가 실제 Supabase에서 실행·검증되지 않았다.
6. **secure storage 미구현**: event session token을 위한 Keystore 계층은 없다. `event_local_state.session_token_ciphertext`는 schema 자리일 뿐이다.
7. **sync worker 미구현**: `sync_queue` table만 있고 retry/backoff/latest-state upload 코드는 없다.
8. **설정 일부는 UI-only**: 음성 안내, 화면 켜짐 유지, 지도 표시 옵션은 localStorage에는 저장되지만 native/runtime 동작에 연결되지 않았다.
9. **지도 provider는 개발용**: 기본 `https://demotiles.maplibre.org/style.json`은 production provider가 아니며 오프라인 지도도 없다.
10. **MapLibre bundle warning**: lazy chunk로 격리했지만 minified chunk가 약 966 KB라 Vite size warning이 발생한다.
11. **web GPS fallback 없음**: 브라우저에서는 개인 운동 UI만 진행되고 실제 위치 기록은 하지 않는다. PWA fallback은 후속 구현이다.
12. **DB migration 없음**: `SQLiteOpenHelper.onUpgrade()`가 비어 있어 schema 변경 전 migration 설계가 필요하다.
13. **Capacitor 기본 test namespace 잔존**: `android/app/src/test`와 `androidTest`의 sample은 `com.getcapacitor.myapp` 경로다. 기능에는 관여하지 않지만 native compile이 가능해진 뒤 정리 또는 교체한다.

## 10. 다음 작업 우선순위

1. 일반 Windows Android Studio 또는 loopback 제한이 없는 환경에서 `assembleDebug`를 실행해 Java/Manifest compile을 먼저 확인한다.
2. compile 오류가 있으면 최소 범위로 수정하고 build → cap sync → assembleDebug 순으로 재검증한다.
3. 실제 Android 기기에서 `docs/DEVICE_SMOKE_TEST.md`의 화면 ON/OFF, background 복귀, pause/resume/end, native/UI sequence reconciliation을 수행한다.
4. release 전에 Android backup/data extraction rule을 설계해 `steplink.db`, token, 사진 metadata의 cloud backup 정책을 확정한다.
5. SQLite 상태 전이와 resume boundary, raw/filtered 누계에 native unit/instrumented test를 추가한다.
6. Phase 2에서 Supabase local 환경을 준비하고 migration/RLS를 role matrix로 검증한다.
7. code 인증용 rate-limited trusted endpoint, `unique(event_id, participant_identifier)` 기반 idempotent join/recovery를 구현한다.
8. Android Keystore 기반 event session/recovery token 저장과 앱 시작 resume selector를 구현한다.
9. GPS 수집과 분리된 30초 current-state upload, latest-wins queue, 중요 event idempotent retry를 구현한다.
10. 행사 lifecycle `DRAFT → OPEN → ACTIVE → ENDED`와 참가자/운영자 실제 화면을 연결한다.

## 11. 변경 금지사항

명시적 설계 변경 합의 없이 다음을 변경하지 않는다.

- `C:\Codex\NativeGpsTest`를 수정하거나 StepLink 프로젝트로 변환하지 않는다.
- native foreground service + SQLite canonical path를 WebView callback 중심 저장으로 바꾸지 않는다.
- raw GPS point를 3.5m/s 이상, accuracy 불량 등의 이유로 삭제하지 않는다.
- GPS 수집 주기와 server upload 주기를 하나로 결합하지 않는다.
- Capgo background-geolocation을 StepLink 핵심 engine으로 추가하지 않는다.
- 참가자에게 다른 참가자의 위치 조회 권한을 부여하지 않는다.
- plain 운영 코드, plain recovery/session token, Supabase service-role key를 앱이나 readable DB row에 저장하지 않는다.
- `event_access_secrets`를 일반 event/member SELECT에 노출하지 않는다.
- production에 MapLibre demo style 또는 OSM public tile을 그대로 사용하지 않는다.
- SQLite schema를 바꾸면서 `onUpgrade()` migration 없이 database version만 올리지 않는다.
- UI만 변경한 뒤 10분 이상 GPS 장기검증을 반복하지 않는다. GPS core 변경 때만 관련 회귀검증을 수행한다.
- `npm audit fix --force`를 실행하지 않는다.
- 실제 credential을 저장소에 추가하지 않는다. `.env.example`에는 public placeholder만 유지한다.
- 기능과 보고 버전을 따로 변경하지 않는다.
- commit 또는 push를 수행하지 않는다.

## 12. 실행 방법

PowerShell, 저장소 루트 기준:

```powershell
npm install --ignore-scripts
npm run dev
```

브라우저에서 개인 운동 UI를 확인할 수 있지만 web GPS 기록은 현재 지원하지 않는다.

검증 권장 순서:

```powershell
npm run test
npm run lint
npm run build
npm run cap:sync
```

Android compile/APK:

```powershell
cd android
.\gradlew.bat assembleDebug
```

성공 시 예상 APK:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

현재 Codex 관리 Windows 환경에서는 loopback 오류가 재현됐으므로 동일 오류를 반복 시도하지 말고 Android Studio 또는 정상 Windows terminal에서 실행한다.

## 13. 환경 설정

`.env.example`을 참고한다.

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_MAP_STYLE_URL=https://demotiles.maplibre.org/style.json
VITE_MAP_ATTRIBUTION=MapLibre demo tiles
```

현재 Supabase 값은 비어 있어도 Phase 1 build가 가능하다. production 지도 공급자를 정한 뒤 `VITE_MAP_STYLE_URL`과 attribution을 교체한다. service-role key는 환경변수 이름만으로도 client project에 추가하지 않는다.

## 14. 확인해야 할 문서와 코드

작업 시작 전 최소 확인 순서:

1. `HANDOFF.md`
2. `README.md`
3. `docs/architecture/PHASE_0_1.md`
4. `docs/NATIVE_GPS_PORT.md`
5. `docs/SECURITY_REVIEW.md`
6. `docs/DEVICE_SMOKE_TEST.md`
7. `src/domain/activity/useActivityTracker.ts`
8. `android/app/src/main/java/kr/co/steplink/app/StepLinkLocationService.java`
9. `android/app/src/main/java/kr/co/steplink/app/StepLinkDatabase.java`
10. `supabase/migrations/0001_phase0_schema.sql`

README의 “Phase 1 구현” 표현은 source 구현을 뜻한다. Android compile과 실기기 PASS까지 완료됐다는 뜻으로 해석하지 않는다.
