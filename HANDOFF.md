# StepLink HANDOFF

갱신일: 2026-09-06

기준: `main` / `29c26d0` 이후 미커밋 working tree

버전: `0.3.1` / Android Build 5
Supabase: `umiszktzbthuqjcuegkz` (`ap-northeast-2`)

## 현재 정상 동작·확인 사실

- GPS canonical path는 `FusedLocationProviderClient → Android Foreground Service → native SQLite activities/activity_points → sequence reconciliation → React UI`다.
- Android Studio에서 Build 5 `assembleDebug`와 Java compile이 성공했고(72 tasks, 29 executed), SM-G998N에 `0.3.1 / 5`가 설치·실행됐다. Codex 명령행 Gradle의 loopback 오류는 앱 소스/JDK/Windows loopback 문제가 아니라 Codex가 시작한 Gradle single-use daemon 경계에서만 재현된다.
- Build 5 실기기에서 진행 중 `EVENT_AUTO` activity가 복구됐고 native point/sequence, 거리·시간, SQLite WAL이 계속 증가했다. Wi-Fi와 모바일 데이터를 끈 동안에도 같은 PID와 FGS/GPS/SQLite 기록이 유지됐으며 WebView는 네트워크 불안정 안내만 표시했다. Wi-Fi 복구 후 5초 polling HTTP response는 앱 재시작 없이 재개됐다.
- 행사 장애와 같은 시간대에 로컬 일반 걷기 0.49km/22:18이 있었다. native 수집 전체가 멈춘 것이 아니라 event live upload가 `sequence=0`, `last_received_at=null`에서 시작되지 않은 문제로 범위를 좁혔다. 원인은 Manifest의 `ACCESS_NETWORK_STATE` 누락으로 `ConnectivityManager.getActiveNetwork()`에서 HTTP 이전 `SecurityException`이 발생한 것이었고, 권한 추가 후 정상화됐다.
- Phase 2 remote 행사 생성, 참가/운영 연결, recovery, `DRAFT → OPEN → ACTIVE → ENDED`는 확인됐다.
- remote에는 `0001`~`0004`와 `phase3_anonymous_peer_locations`가 적용됐다. `0005_phase3_operational_hardening.sql`, cron, 수정 Edge Function은 미배포다.
- 실제 client API base는 `https://umiszktzbthuqjcuegkz.supabase.co`다. localhost/사설 IP/server URL override는 없고 Android `INTERNET` 권한이 있다. API는 HTTPS이며 cleartext 설정은 원인이 아니다.
- 2026-09-05 host 확인에서 Auth health, REST/Auth/Edge CORS preflight는 200이었고 인증 없는 Edge POST는 서버 로그에 도달해 401을 반환했다. 같은 날 실제 Edge `event-session-validate` POST와 REST 행사/dashboard GET도 200 로그가 확인됐다. DNS/TLS/CORS/server bind의 상시 장애 증거는 없다.

## 확정 정책과 현재 구현

- 개인 활동이 기본이다. 행사 참여는 별도 GPS 세션이 아니라 한 canonical activity에 `event_activity_links` context를 붙인다.
- ACTIVE Participant에게 진행 중 activity가 있으면 같은 activity를 연결하고, 없으면 `source=EVENT_AUTO` 활동 한 건을 자동 생성한다. 별도 시작 버튼은 없다.
- `activities/activity_points`가 개인·행사 활동의 상세 local source of truth다. 완료 활동은 native `listCompletedActivities`가 최신순·읽기 전용으로 조회하며, 홈/메뉴의 `활동 기록`에서 개인 및 `EVENT_AUTO` 기록을 함께 보고 기존 요약 화면으로 다시 들어갈 수 있다.
- `event_live_snapshot`은 canonical activity의 최신 위치/거리/시간/sequence를 복사하는 current-only cache다. 독립 거리·시간 또는 trail 저장소가 아니다.
- Supabase `participant_live_state`도 participant별 current row만 유지한다. 상세 trail은 server로 보내지 않는다.
- 행사 화면과 운동 정보 화면은 같은 activity의 view switch다. 전환은 tracking/live sync를 중단하지 않는다. active event context 중 수동 pause/end는 막는다.
- ENDED/session clear 시 live sync와 event context를 끝낸다. `EVENT_AUTO` 활동은 COMPLETED로 보존한다. 기존 personal activity에 연결한 경우 context만 분리하고 personal 활동은 계속한다.
- live upload는 ACTIVE Participant only, 기본 30초, latest-wins key `live:{eventId}:{participantId}`다. HELP는 별도 UUID idempotent queue와 retry/terminal 정책을 유지한다.
- stale 90초, offline 5분, dashboard 7.5초 polling, participant feed 15초 polling이다.
- 개인 걷기와 행사 걷기는 같은 `TrackerScreen`과 local GPS 경로를 사용한다. 행사 중에도 지도 상세 경로는 local `activity_points`만 사용하고 server trail을 만들지 않는다.
- 행사 상태 진입은 tracker 상단바의 `행사` 버튼이다. 행사명·공지·도움 요청은 지도 위 absolute overlay로 열리며 지도와 하단 기록 패널의 높이/배치를 변경하지 않는다.
- ACTIVE Participant는 자기 위치를 빨간 점, accepted local 경로를 작은 빨간 도트, 다른 참가자의 익명 current 위치를 파란 점으로 본다. peer RPC는 자기 자신을 제외하고 5분 이내 current row의 위·경도만 소수점 4자리로 낮춰 반환하며 이름·학번·participant id·거리·trail을 반환하지 않는다.
- 기본 지도는 OpenFreeMap Bright이다. provider는 env로 교체 가능하고 attribution을 항상 표시한다. public instance는 API key 없이 사용할 수 있지만 SLA가 없으므로 운영 규모 확대 전 provider/self-hosting 결정을 다시 검토한다. offline map은 미구현이다.
- 행사 코드와 날짜 예약/auto-close/RLS/Keystore/pepper/service-role 금지 정책은 기존 Build 5 변경을 유지한다.
- Supabase JS의 모든 Auth/REST/RPC/Edge 요청은 query value와 credential을 제외한 endpoint, method, direction, HTTP status, elapsed time 및 transport exception을 `StepLink network ...` console log로 남긴다. native sender는 Logcat tag `StepLinkNetwork`와 live-sync diagnostics에 base URL, endpoint, status, 마지막 오류와 송수신 성공 시각을 남긴다.
- 일시적 `Failed to fetch`/timeout/5xx 중 앱 시작 restore는 encrypted 행사 세션을 삭제하지 않고 5초~60초 backoff 및 online/focus에서 재시도한다. 복구되면 행사 화면으로 돌아간다. 무효 session/scope만 기존처럼 정리한다.
- native live POST의 transport exception도 durable latest-wins row를 유지하고 exponential backoff 대상으로 기록한다. GPS point/metrics는 네트워크 요청보다 먼저 SQLite에 저장되며 이 변경은 sampling/storage path를 수정하지 않았다.

## 검증 상태

2026-09-05 지도/행사 overlay 재검증: 6개 항목 모두 PASS. 지도 배경, 현재 위치와 누적경로, 왼쪽 햄버거/중앙 활동 상태/오른쪽 행사 버튼, 행사 overlay, overlay 전후 고정 레이아웃, 지도 조작 중 거리·시간 증가를 최신 APK에서 확인했다. worker 내부 `maplibre-gl-shared.mjs` 누락은 `?worker&url` 번들링으로 해결됐다. native live upload PASS도 유지한다.

누적경로의 일부 공백은 후속 개선사항이다. 실기기 current activity 920 points 중 451개가 `acceptedForMetrics=false`였고 최대 40개 연속 제외됐다. 사유는 `accuracy>50m` 356, `implausible-speed` 61, `teleport` 13, `jitter` 12, `non-positive-time` 9였다. `routeSourceData`가 제외된 segment를 그리지 않으므로 단순 선 스타일 문제가 아니라 실제 표시 GeoJSON의 공백이다. GPS sampling/filter 및 route segment 선택 로직은 이번에 변경하지 않았다.

후속 UI 정리 source는 전체 56/56 test, lint, build, cap sync PASS 후 Android Studio에서 SM-G998N에 재설치했다. 실행 WebView는 384×853 portrait, document `scrollHeight=clientHeight=853`, 지도 384×450, 하단 panel bottom 853으로 한 페이지에 맞았다. 사용자 시각 검증에서도 portrait 고정, 한 화면 배치, 하단 여백 감소/지도 확대, 빨간 경로와 현재 위치 구분, 기존 지도/행사 기능 유지를 PASS했다.

현재 UI source는 중복 `이동 거리` 라벨을 제거하고, 경로를 작은 빨간 도트로 표시한다. 지도 모드와 follow를 분리해 모든 모드가 기본적으로 현재 위치를 따라가며 gesture 중에는 모드를 유지한 채 follow만 4초간 멈춘다. 내 위치 버튼은 zoom/모드를 유지하고 즉시 follow를 복구한다. 네비 bearing은 accepted point, speed ≥0.8m/s, accuracy ≤25m 조건에서만 쓰고 그 외 정북 fallback이다. GPS/filter/segment/live 로직은 변경하지 않았다.

최신 release-prep UI는 Android Back stack, compact 참가/운영/개인운동 header, OWNER/OPERATOR role별 회전, 진행 중 OWNER 행사 복귀, 운영 landscape 약 20:80 목록/지도, 참가자 찾아가기와 attribution 좌측 상단을 포함한다. ACTIVE 참가자의 `주변 참가자 확인`은 기본 OFF이며 ON일 때 기존 anonymous peer 위치를 zoom/gesture/mode와 독립적인 작은 파란 circle layer로 표시한다. 자기 위치는 신뢰 bearing을 따르고 불안정할 때 마지막 방향을 유지하는 빨간 navigation pointer다. 운영 화면의 `행사일`/`예상 참가 인원`은 표시만 제거했고 생성 데이터는 유지한다. source test 63/63, lint/build/cap sync는 PASS다. 이 최신 native/UI 묶음은 아직 Android Studio 재빌드·실기기 확인 전이다.

### VERIFIED

- `npm test`: 63/63 PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS. Android WebView에서 발견한 누락 worker를 Vite asset URL로 명시한 뒤 `maplibre-gl-worker-*.mjs`가 dist/Capacitor asset에 생성된다. MapLibre chunk size warning은 남는다.
- `npm run cap:sync`: PASS.
- remote `get_participant_peer_locations_v1`: migration 적용, catalog 권한 확인, rollback-only authenticated fixture 6개와 anon execute 거부 PASS. 테스트 event/participant 잔존 0건.
- local contract에서 one activity 생성/재사용, canonical point path, snapshot projection, navigation-only 전환, restore 재사용, ENDED 보존, HELP retry/terminal을 검사한다.
- Build 5 Android Studio Java compile/APK/install/launch와 시작 crash 없음.
- Build 5의 event-linked canonical activity 복구, native point/sequence 증가, 단절 중 SQLite 지속, Web polling 네트워크 복구.
- Build 5 native event live upload 실기기 PASS. ADB 복구 후 최신 APK 설치와 행사 `12345` session 유지를 확인했고, `upsert_participant_live_state_v1`이 반복 `response 200`을 반환했다. native 진단은 `lastStage=request_succeeded`, `lastHttpStatus=200`, `pendingLiveCount=0`, `lastError=null`이었다. remote `participant_live_state`는 위·경도와 `last_received_at`이 갱신됐고 `client_sequence=644`, `distance_m=6577.61`, `elapsed_time_ms=4412115`였다.
- SM-G998N 지도 UI: background/current marker/red-dot route, 자유 gesture, 자유→정북→네비 순환과 아이콘, 내 위치 복귀, portrait 한 화면 레이아웃, 행사 overlay 및 기록 지속 PASS.
- 2026-09-06 SM-G998N background/foreground 유지 PASS. 행사 `12345`를 홈으로 보내고 화면을 Doze 상태로 약 2분 30초 유지하는 동안 PID와 foreground `StepLinkLocationService`가 유지됐다. 복귀 후 동일 `EVENT_AUTO` activity ID와 ACTIVE context가 유지됐고 point count는 1076→1086, native/live sequence는 1305→1314로 증가했다. 이어진 RPC는 HTTP 200, native 진단은 `request_succeeded`/`pendingLiveCount=0`/`lastError=null`, remote row도 sequence 1314로 갱신됐다. 화면이 꺼진 정지 구간에는 새 location callback이 없어 POST가 없었으며, 이 결과를 이동 중 screen-off sampling 검증으로 확대 해석하지 않는다.
- 2026-09-06 앱 process-death 복구 PASS. `force-stop`이 아니라 앱 UID로 PID 14063만 kill한 뒤 수동 재실행해 PID 24593을 확인했다. 동일 activity `8256c922-dcf6-4622-817a-6e9d9fc4b1c7`, `WALK / EVENT_AUTO / ACTIVE`, 행사 `12345`와 동일 event context가 복구됐다. point count 1472→1477, live sequence 1700→1705, 거리 22,646.97m→22,688.76m로 이어졌고, SQLite는 activities 15→15, ACTIVE/PAUSED 1→1, 대상 activity row 1→1, active event link 1→1이었다. RPC HTTP 200, `request_succeeded`/`pendingLiveCount=0`/`lastError=null`, remote sequence 1705를 확인했다. 이는 `force-stop recovery` 검증이 아니다.
- 2026-09-06 비파괴 화면 왕복 PASS. ACTIVE Participant는 별도 행사 화면 대신 통합 걷기 화면과 행사 overlay를 사용하므로 실제 UI 경로 `걷기 → 메인 메뉴 → 설정 → 걷기`를 왕복했다. 동일 activity ID, `EVENT_AUTO / ACTIVE`, 행사 `12345` active context와 native live manager가 유지됐고 복귀 후 30초 cadence RPC가 반복 HTTP 200이었다. `lastHttpStatus=200`, `pendingLiveCount=0`, `lastError=null`을 확인했다. 기기가 정지해 point/sequence 1479/1707이 증가하지 않았으므로 이동 sampling 검증으로 확대하지 않는다.
- 2026-09-06 `am force-stop` recovery PASS. force-stop 전 activity `8256c922-dcf6-4622-817a-6e9d9fc4b1c7`, 행사 `12345`, `WALK / EVENT_AUTO / ACTIVE`, point 1489, sequence 1717, 거리 22,824.60m, elapsed 30,339,889ms였다. force-stop 2초·8초 뒤 모두 PID와 foreground service가 없고 package `stopped=true`여서 자동 재기동되지 않았다. MAIN/LAUNCHER cold launch 후 새 PID 29235, `stopped=false`, 동일 activity/event context, point 1492, sequence 1720, 거리 22,842.45m, elapsed 30,420,849ms와 foreground service/native live manager 복구를 확인했다. activities 15→15, ACTIVE/PAUSED 1→1, 대상 row 1→1, active event link 1→1로 중복이 없었다. RPC HTTP 200, 성공 직후 진단 `request_succeeded`/`lastHttpStatus=200`/`pendingLiveCount=0`/`lastError=null`, remote sequence 1720 갱신을 확인했다.

### CODE-LEVEL ONLY

- SQLite DB v5의 `activity_source`, `event_activity_links`, `event_live_snapshot.activity_id` upgrade.
- ACTIVE 자동 activity ensure/FGS/live sync, 기존 activity attach, restart restore, ENDED/clear 정리.
- event/activity 화면 전환과 event context 표시.
- unified 걷기 화면, local path/self marker/anonymous peer marker와 `get_participant_peer_locations_v1` contract.
- `0004` RLS/monotonic live RPC와 미배포 `0005` hardening은 migration contract 수준.

### NOT VERIFIED

- `[미검증 / 비차단]` Wi-Fi↔테더링↔모바일 데이터 전환 내구성. 일반 Wi-Fi native live upload 반복 200과 완전 단절 중 local 기록/Wi-Fi 복구 Web polling은 확인했지만 transport 교체 자체는 수행하지 않았다.
- `[미검증 / 비차단]` 실기기에서 기존 personal activity attach 시 무중복.
- `[미검증 / 비차단]` 실제 두 Android 기기의 anonymous peer E2E.
- 완료 activity 목록/요약 재진입은 구현 및 59개 자동 검증과 SM-G998N 실기기 검증을 통과했다. 행사 `12345`의 `EVENT_AUTO` 완료 activity `8256c922-dcf6-4622-817a-6e9d9fc4b1c7`가 정확히 1건 노출됐고 native 거리 `27,492.642554998398m`, UI `27.49 km`, 완료 정보와 기존 SummaryScreen 재진입을 확인했다. 목록 진입 전부터 있던 PERSONAL activity는 동일 ID를 유지했으며 목록/요약 동작으로 새 activity가 생성되지 않았다.
- remote `0005`/cron/Edge 적용, Security Advisor, role-token negative test, 실제 200/300명 API load.
- Android 실기기 다중 Participant 익명 peer 표시. DB authenticated-role/claim fixture 검증은 통과했지만 실제 두 기기 E2E는 아직이다.
- `[공개 전 gate]` 최신 `AppUiPlugin`/`MainActivity` Back 및 role별 orientation 변경의 Android compile/install. 2026-09-06 Codex `:app:assembleDebug` 1회는 `Unable to establish loopback connection`으로 Java compile 전에 중단됐으며 재시도하지 않았다. Android Studio Build/Run으로 확인해야 한다.

## 알려진 문제·다음 작업

1. 완료 activity 목록은 Build 5 실기기 PASS다. 조회 전후 activity ID unique와 대상 EVENT_AUTO 1건을 확인했다.
2. 기존 personal activity attach 무중복과 실제 두 기기 peer E2E는 공개 후 backlog로 둔다.
3. 실패가 재현된 단계에서만 Chrome WebView console의 `StepLink network transport failure`와 Logcat `StepLinkNetwork`의 method/endpoint/status/exception을 수집하고 관련 최소 수정 여부를 판단한다.
4. 실제 두 Android Participant로 익명 peer 표시와 self/stale exclusion을 검증한다.
5. Wi-Fi↔모바일 데이터/테더링 transport 전환은 미검증 비차단 상태로 보류한다.
6. 완료 activity 목록/상세는 구현·실기기 PASS다. 최신 네이티브 UI 변경의 Android Studio build/install 확인만 공개 전 gate로 남는다.
7. 최신 UI의 Back stack, compact 운영 화면, role별 orientation 및 map follow는 Android Studio 설치본에서 묶음 smoke한다.
8. OpenFreeMap public instance는 무상·키 없음이지만 SLA가 없다. 실제 행사 규모/운영 보증에 맞춘 유료 provider 또는 self-hosting 전환 기준, live retention/cleanup, LONG_STOP/course/finish는 후속 결정이다.
9. remote `0005`/cron/수정 join Edge는 v0.3.1 공개 핵심 흐름의 런타임 의존성이 아니므로 비차단 backlog다. 현재 배포된 join 함수와 `0001`~`0004`+peer RPC만으로 생성/참가/운영 연결, manual lifecycle, live/help/message/peer가 동작한다. 단, 작업트리의 수정 `event-join`/`operator-join`은 `0005`가 추가하는 `event_date`, `lookup_active`, `auto_close_at`을 조회하므로 단독 배포하면 안 된다. 후속 적용 순서는 `0005 → 수정 join Edge Functions → cron`이며 각각 사용자 승인과 검증이 필요하다.

## 변경 금지사항

- GPS sampling/filter/raw point/sequence reconciliation/`NativeGpsTest`를 이유 없이 변경하지 않는다.
- 두 개의 competing personal/event GPS session을 만들지 않는다.
- `event_live_snapshot`이나 server를 상세 trail 저장소로 확장하지 않는다.
- Participant peer 출력에 이름·학번·participant id·상세 trail·정밀한 좌표를 추가하지 않는다. ACTIVE-only·self-exclusion·current-only 경계를 완화하지 않는다.
- service-role key, pepper, plain token/code를 client·DB 평문에 저장하지 않는다.
- 적용된 `0001`~`0004`와 peer migration 수정, destructive DB reset, 기존 test event 삭제, commit/push/승인 없는 remote 배포를 하지 않는다.

## 실행·검증

```powershell
npm test
npm run lint
npm run build
npm run cap:sync
cd android
.\gradlew.bat --no-daemon compileDebugJavaWithJavac
```

환경 변수는 public `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`만 client에 둔다. 실기기 절차는 [docs/DEVICE_SMOKE_TEST.md](docs/DEVICE_SMOKE_TEST.md)를 따른다.
