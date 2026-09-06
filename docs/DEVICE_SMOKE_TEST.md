# 실기기·Supabase E2E 검증 기록

## Phase 1 Android 확인

일반 Windows Android Studio에서 build/APK/install에 성공했고 약 0.41km 야외 보행을 기록했다. 화면 OFF 중 native 기록이 지속됐고 복귀 뒤 누적 거리, pace, 1km 예상시간, 평균속도, GPS diagnostics가 정상 표시됐다. 지도 배경은 표시되지 않았으며 원인은 미확정이다.

이후 장시간 개인 기록 약 1시간 29분/2.53km가 확인됐다. Phase 3 장애 재현과 같은 시간대에도 일반 걷기 0.49km/22:18 row가 존재했다. 이는 native 수집이 완전히 멈춘 증거가 아니라 event live sender가 canonical activity lifecycle에 연결되지 않은 증거로 해석한다. 최종 정책에서는 행사도 정상적인 local activity로 남되 별도 competing GPS session을 만들지 않고 event context로 구분한다.

이 초기 Phase 2 기록 시점에는 force-stop, 제조사별 강제 절전, 수 시간 장기 기록, 모든 OS/제조사 조합을 확인하지 않았다. Build 5 행사 force-stop recovery 결과는 아래 후속 기록을 따른다. Phase 2는 GPS core를 변경하지 않았으므로 GPS 장시간 회귀를 반복하지 않았다.

## Phase 2 실제 Supabase E2E

환경:

- project ref: `umiszktzbthuqjcuegkz`
- region: `ap-northeast-2`
- Android + PC browser + Supabase DB/Edge logs
- Anonymous Sign-In ON, Edge pepper 설정 완료, client public config 설정 완료
- migration: `phase0_schema`, `phase2_event_sessions`, `phase2_function_execute_hardening`
- Edge: `event-create`, `event-join`, `operator-join`, `event-session-validate`; `verify_jwt=true`
- 행사: `Test2`, 당시 예시 참가/운영 code `5VNCF` / `5VNCFB`

PASS:

- 행사, access digest, OWNER membership, DRAFT 생성
- DRAFT→OPEN→ACTIVE→ENDED와 `started_at`/`ended_at`
- Participant 5명, Owner 1명, Operator 2명 연결
- participant live-state 자동 생성
- OPEN과 ACTIVE에서 신규 Participant 참가
- 같은 identifier/name recovery 시 participant row 중복 없이 기존 row로 재연결
- recovery 뒤 `last_recovered_at` 갱신
- 운영 code로 별도 Operator 연결
- 종료 상태/메시지 표시
- ENDED 뒤 신규 참가 차단과 자연스러운 사용자 오류 표시

실 E2E에서 추가로 발견한 문제:

- Web refresh/restart 시 `persistSession: false`와 memory snapshot 때문에 자동 복귀 실패
- recovery 뒤 이전 session의 RLS 0행을 `.single()`이 PostgREST 406 기술 오류로 노출
- lifecycle polling 시점 차이로 client별 종료 표시가 수초 간격으로 도착
- Windows PowerShell UTF-8 BOM 때문에 첫 `.env.local` URL 변수 누락

위 네 항목은 0.2.1 source에서 encrypted IndexedDB persistence, `.maybeSingle()` stale 처리, foreground 5초/focus 즉시 polling, BOM 없는 env 작성 문서로 보정했다. 수정 후 실제 browser/새 APK 재검증은 아직 PASS로 표시하지 않는다.

## v0.2.1 / Build 3 최소 smoke test

1. Android Studio에서 Build 3 APK를 build/install하고 설정의 version을 확인한다.
2. 기존 activity/point가 유지되고 개인 운동·diagnostics가 열리는지만 짧게 확인한다.
3. 작은 portrait에서 시작 예정과 종료 예정 input을 각각 눌러 우측 overflow가 없는지 확인한다.
4. Owner가 행사를 만들고 code가 표시되는지, 앱 재실행 뒤 code와 session이 복원되는지 확인한다.
5. 일반 PC browser에서 Participant join → refresh → browser 완전 종료/재시작 뒤 code 없이 복원되는지 확인한다.
6. Operator와 Owner도 각각 refresh/restart 복원을 확인한다.
7. Owner code가 Web encrypted storage restore 뒤 다시 표시되는지 확인한다.
8. private/incognito 또는 storage 차단 환경에서 지속 저장 불가 안내가 보이고 평문 localStorage가 생기지 않는지 확인한다.
9. 같은 참가자를 새 browser session에서 recovery한 뒤 새 session은 유지되고 이전 browser는 기술 오류 대신 “다른 기기 또는 브라우저에서 다시 연결” 안내 후 local session이 정리되는지 확인한다.
10. Owner가 ENDED로 바꾼 뒤 foreground client들이 약 5초 이내 또는 focus 복귀 즉시 종료 상태를 받는지 확인한다.
11. `01A7K`/`01A7KP`, 0/1 허용, I/L/O 거부, lowercase canonicalization을 확인한다.
12. Supabase 미설정 build에서 유효 입력 후 버튼이 무반응이 아니라 설정 안내를 표시하는지 확인한다.

## 미검증·후속

- 200~300명 실제 remote load와 학교 공유망 rate limit(mock simulation만 완료)
- 장시간 행사
- 여러 Android 제조사 및 모든 browser
- Owner local credential 완전 분실 복구
- SQLite v1→v2 upgrade/Keystore failure 실기기 검증
- 소형 Android 일정 overflow 수정 후 재확인
- 지도 배경 미표시 원인
- Phase 3 remote E2E와 Phase 4 course/finish/photo/report

## v0.3.1 / Build 5 행사 live sender 최소 smoke test

사용자 Android Studio에서 Build 4 compile/APK는 성공했다. 문제 재현과 같은 시간대에 로컬 일반 걷기 `0.49 km / 22:18` 기록이 있어 native GPS 수집은 동작했다. 반면 행사 live row는 sequence 0/null이고 upsert 호출이 없었으므로 Build 5는 one-activity와 event live projection 연결을 우선 재검증한다. remote에는 0001~0004와 익명 peer RPC가 적용됐고 0005/cron/수정 Edge는 미적용이다.

1. Android Studio에서 Build 5를 compile/install하고 설정의 Version 0.3.1 / Build 5를 확인한다.
2. 테스트 전 SQLite `activities`, `activity_points`, `event_activity_links`의 마지막 id/개수를 기록한다. 개인 “걷기 시작”은 누르지 않는다.
3. 기존 remote 0004 범위에서 Owner가 행사를 ACTIVE로 만들고 Participant로 입장한다.
4. 위치 권한 안내가 필요하면 승인한다. 별도 시작 버튼 없이 `EVENT_AUTO` activity 한 건과 active event link가 생기고 FGS/자기 지도/전송 상태가 시작되는지 확인한다.
5. 30~60초 안에 `participant_live_state.client_sequence > 0`, `last_received_at` non-null, live upsert RPC 호출이 생기는지 확인한다.
6. 행사 화면↔운동 정보 화면을 오가며 activity id, point sequence, FGS와 live sync가 끊기거나 바뀌지 않는지 확인한다.
7. 앱 process를 재시작하고 같은 activity id + active event context가 복구되며 중복 activity가 생기지 않는지 확인한다.
8. 별도 사전 personal activity가 진행 중인 경우에도 같은 테스트를 반복해 새 activity 없이 context만 붙는지 확인한다.
9. 화면 OFF/앱 전환 2~3분 및 Wi-Fi off/on 약 1분 후 point/server sequence가 이어지고 과거 snapshot을 몰아서 보내지 않는지 확인한다.
10. Owner가 ENDED로 전환한다. 2분 동안 server sequence가 멈추고 event context가 inactive가 되며, 자동 생성 activity는 COMPLETED로 local point와 함께 보존되는지 확인한다. 기존 personal activity에 연결한 경우에는 activity가 계속 ACTIVE인지 확인한다.

네트워크 송수신은 다음 순서로 별도 확인한다.

1. 온라인 상태에서 참가/복원 후 WebView console `StepLink network response`와 Logcat `StepLinkNetwork`의 endpoint/status를 확인한다.
2. Participant ACTIVE에서 `/rest/v1/rpc/upsert_participant_live_state_v1` POST 2xx와 native `lastSuccessAt`, `lastReceiveSuccessAt`, `lastHttpStatus`를 확인한다.
3. Operator에서 `/rest/v1/events`, `/participants`, `/participant_live_state`, `/help_requests` GET 2xx와 목록 갱신을 확인한다.
4. 비행기 모드 또는 Wi-Fi/테더링 해제로 60초 유지한다. local `activity_points`는 증가하고 LIVE latest-wins pending row는 보존되며 저장된 행사 세션이 삭제되지 않아야 한다.
5. 네트워크를 복구한다. online/focus 또는 최대 60초 backoff 안에 session validate/GET/POST가 재개되고 과거 위치를 몰아서 보내지 않고 최신 sequence만 반영되는지 확인한다.
6. 실패가 남으면 raw token/key를 복사하지 말고 method, sanitized endpoint, HTTP status 또는 exception class/message, 발생 시각만 수집한다.

이 10단계는 약 10분의 핵심 smoke다. 장시간 GPS 회귀는 하지 않는다. 완료 기록 목록은 SM-G998N에서 행사 `12345` EVENT_AUTO 항목 1건, native 27,492.64m/UI 27.49km, 완료 정보, 기존 SummaryScreen 재진입과 조회 중 무중복을 확인해 PASS했다. 이전 행사 HELP queue가 남은 설치라면 새 session 저장 후 `PARTICIPANT_SCOPE_DENIED`가 반복되지 않고 terminal diagnostic 한 건으로 정리되는지도 함께 본다.

## Phase 3 확장 E2E

1. 낮은 sequence RPC가 최신 좌표를 덮지 않고 `accepted=false`인지 확인한다.
2. 90초/5분 기준으로 위치 오래됨/위치 확인 안 됨과 상대 시간이 바뀌는지 확인한다.
3. PC/tablet/phone portrait/landscape에서 map-first UI, 검색·학년·반·상태 필터와 가로 overflow를 확인한다.
4. 개인 걷기에서 OpenFreeMap 배경, 빨간 자기 위치, 빨간 도트 local 경로가 보이는지 확인한다. 행사 걷기에서는 여기에 파란 익명 peer current 점이 추가되고 개인 걷기에는 peer 점이 없는지 확인한다.
5. Android phone portrait에서 같은 tracker의 핵심 수치와 행사명·공지/도움 overlay가 가로 overflow 없이 보이는지 확인한다.
6. Operator 지도 background와 cluster/individual 전환을 확인하고 style/network/CORS/WebGL/worker 오류를 기록한다.
7. 전체/학년/반/개별/선택 공지가 대상 Participant에게만 15초 안팎으로 보이는지 확인한다.
8. 도움 요청 후 Operator ACK와 “운영자가 확인했습니다”를 확인하고 60초 cooldown/순방향 전이를 검증한다.
9. Participant A token으로 B의 raw participants/live/help SELECT는 0행/거부이고, peer RPC는 B의 이름·학번·id 없이 rounded current point만 반환하는지 확인한다.
10. Owner가 ENDED로 바꾸면 peer point와 live upload가 중단되는지 확인한다.
11. Operator가 권한 없는 event current state를 읽거나 도움 상태를 바꾸지 못하는지 확인한다.
12. 적용된 익명 peer RPC를 실제 Participant JWT/두 기기로 재검증하고, 0005는 별도 검토·승인·적용 후 날짜 단위 code 예약과 auto-close cron을 별도 test event로 확인한다.
13. Supabase Security Advisor와 함수 execute/catalog grant를 기록한다.

desktop 1280×720과 mobile 360×800 browser에서는 OpenFreeMap 배경·attribution·반응형 배치를 확인했다. Android WebView의 빨간 자기 위치, 빨간 도트 local 경로와 지도 조작 UI도 PASS다. 파란 익명 peer 점은 실제 두 기기에서 아직 미검증이다. 최신 test/lint/build/cap/compile 결과는 HANDOFF를 따른다. Build 5 native event live upload, one-activity ENDED 보존, offline latest-wins, 이동 중 screen-off와 복구 흐름은 PASS다. cellular transport와 두 기기 peer E2E는 미검증/비차단이다.

### 2026-09-05 Build 5 부분 실기기 결과

후속 사용자 지도/overlay 재검증 결과: 1 PASS(지도 배경), 2 PASS(현재 위치/누적경로), 3 PASS(왼쪽 햄버거/중앙 걷기·기록 중/오른쪽 행사), 4 PASS(overlay), 5 PASS(레이아웃 유지), 6 PASS(지도 조작 중 거리·시간 증가). native live PASS도 유지한다.

지도 worker asset 문제는 해결됐다. 누적경로가 일부 끊겨 보이는 것은 실기기 point 집계상 단순 스타일 문제가 아니다. 920 points 중 451개가 metric filter에서 제외됐고 최대 40개 연속 제외됐다. `accuracy>50m`가 356개로 가장 많으며 표시 GeoJSON도 해당 segment를 생략한다. GPS/filter/segment 선택 로직은 유지하고 후속 개선사항으로 기록한다.

UI 정리 APK는 SM-G998N에서 portrait 고정, 한 화면 지도/기록/버튼, 하단 여백 감소와 지도 확대, 빨간 경로/현재 위치 구분, 기존 기능 유지까지 사용자 PASS를 받았다.

최신 APK는 `이동 거리` 라벨 제거, 2.5px round red dots, 자유/정북/네비 순환 아이콘 버튼, 모드를 보존하는 내 위치 버튼을 포함한다. 네비 heading은 accepted point + speed 0.8m/s 이상 + accuracy 25m 이하일 때만 사용한다. test 57/57, lint/build/cap sync 및 SM-G998N 전체 지도 UI 실기기 검증 PASS다. 자유 gesture, 모드 순환/아이콘, 내 위치 복귀, 도트 경로, 레이아웃과 기존 행사/지도/live upload 회귀 없음이 확인됐다.

최신 source는 지도 모드와 follow를 분리한다. gesture 중 모드를 유지하면서 follow만 잠시 멈추고, 내 위치 버튼으로 즉시 복귀한다. 이 변경과 Android Back/role별 orientation은 최신 Android Studio 설치본에서 묶음 UI smoke가 필요하다.

- SM-G998N ADB `device`, Android Studio Java compile/assemble/install, `0.3.1 / 5` 실행과 시작 crash 없음은 확인했다.
- 진행 중 `EVENT_AUTO` activity는 복구됐고 native sequence와 point count, 거리·시간, SQLite WAL이 증가했다. Wi-Fi/모바일 데이터 단절 중에도 같은 PID와 local 기록이 유지됐다.
- 단절 시 사용자 안내가 표시됐고 Wi-Fi 복구 후 5초 Web polling HTTP response가 앱 재시작 없이 재개됐다. Wi-Fi↔모바일 데이터/테더링 transport 교체는 `미검증 / 비차단`으로 보류하며 PASS로 기록하지 않는다.
- 첫 설치 APK의 MapLibre worker asset 누락은 `RouteMap` Vite worker 번들링으로 해결됐고 최신 Android WebView 지도 시각 검증까지 PASS했다.
- native event live upload는 PASS다. 원인은 Manifest의 `ACCESS_NETWORK_STATE` 누락으로 `ConnectivityManager.getActiveNetwork()`에서 HTTP 이전 `SecurityException`이 발생한 것이었다. 권한 추가 후 ADB 복구·최신 APK 설치·행사 `12345` session 유지를 확인했고, `upsert_participant_live_state_v1` 반복 `response 200`, native `lastStage=request_succeeded`, `lastHttpStatus=200`, `pendingLiveCount=0`, `lastError=null`을 확인했다. remote row는 위·경도와 `last_received_at`이 갱신됐고 `client_sequence=644`, `distance_m=6577.61`, `elapsed_time_ms=4412115`였다. 이 정상 Wi-Fi live upload 항목은 회귀 실패가 없는 한 반복하지 않는다.
- 2026-09-06 background/foreground 유지 PASS. 홈 이동 후 화면을 약 2분 30초 Doze 상태로 둔 동안 앱 PID와 foreground location service가 유지됐다. 복귀 후 행사 `12345`, 동일 `EVENT_AUTO` activity ID와 ACTIVE 상태가 유지됐고 point count 1076→1086, sequence 1305→1314, RPC HTTP 200, `lastStage=request_succeeded`, `pendingLiveCount=0`, `lastError=null`, remote sequence 1314를 확인했다. 정지한 screen-off 구간에는 새 location callback/POST가 없었으므로 이동 중 screen-off sampling은 별도 미검증이다.
- 2026-09-06 process-death recovery PASS. 앱 UID `kill -9`로 PID 14063을 종료하고 수동 재실행해 새 PID 24593을 확인했다. 동일 activity ID, `WALK / EVENT_AUTO / ACTIVE`, 행사 `12345`와 event ID가 복구됐다. point 1472→1477, live sequence 1700→1705, 거리 22,646.97m→22,688.76m로 이어졌으며 activities 15→15, ACTIVE/PAUSED 1→1, 대상 row 1→1, active event link 1→1로 중복 생성이 없었다. RPC HTTP 200, `request_succeeded`, `pendingLiveCount=0`, `lastError=null`, remote sequence 1705를 확인했다. 앱 `force-stop`은 수행하지 않았으므로 force-stop recovery PASS가 아니다.
- 2026-09-06 비파괴 화면 왕복 PASS. ACTIVE Participant의 실제 UI 구조에 따라 `걷기 → 메인 메뉴 → 설정 → 걷기`를 왕복했다. 동일 activity ID, `EVENT_AUTO / ACTIVE`, 행사 `12345` active context, native live manager가 유지됐고 복귀 후 30초 cadence RPC가 반복 HTTP 200이었다. `lastHttpStatus=200`, `pendingLiveCount=0`, `lastError=null`이었다. 정지 상태에서 point/sequence가 1479/1707로 유지된 것은 이동 중 sampling 검증에 포함하지 않는다.
- 2026-09-06 force-stop recovery PASS. `am force-stop kr.co.steplink.app` 뒤 2초·8초 모두 PID/foreground service가 없고 package `stopped=true`여서 자동 재기동되지 않았다. MAIN/LAUNCHER cold launch 뒤 PID 29235와 foreground service가 시작되고 동일 activity ID, `WALK / EVENT_AUTO / ACTIVE`, 행사 `12345` event context가 복구됐다. point 1489→1492, sequence 1717→1720, 거리 22,824.60m→22,842.45m, elapsed 30,339,889ms→30,420,849ms로 이어졌다. activities 15→15, ACTIVE/PAUSED 1→1, 대상 row 1→1, active event link 1→1이었다. RPC HTTP 200, 성공 직후 `request_succeeded`/`lastHttpStatus=200`/`pendingLiveCount=0`/`lastError=null`, remote sequence 1720을 확인했다.
