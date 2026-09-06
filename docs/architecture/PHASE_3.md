# Phase 3 live operations architecture

상태: v0.3.1 / Build 5 부분 실기기 검증 중. native event live upload는 PASS이며 Build 5 전체 완료 전이다.

## 장애 해석

실패 행사와 같은 시간대에 Android local 일반 걷기 0.49km/22:18이 기록됐다. 따라서 FusedLocation/FGS/SQLite 수집 자체가 멈춘 것이 아니다. server의 `participant_live_state.client_sequence=0`, `last_received_at=null`과 live RPC 미호출을 함께 보면 event live sender가 activity lifecycle에 연결되지 않은 것이 핵심 원인이었다.

이전 Build 5 초안은 event-only location source와 독립 거리/시간 snapshot으로 이를 우회했다. 최종 제품 정책은 행사도 개인 기록과 같은 GPS activity이므로 one-activity 구조로 보정한다.

## 최종 local data model

```text
                         event_activity_links
                        /  event/participant context
Fused location → activities ────────────────┐
                 └ activity_points          │
                   canonical local trail    │ current projection
                                            ▼
                                  event_live_snapshot
                                      current-only
                                            │ latest-wins, ~30s
                                            ▼
                              Supabase participant_live_state
                                      current-only
```

- `activities`: activity id, source(`PERSONAL|EVENT_AUTO`), type/status/profile, canonical metrics.
- `activity_points`: raw/filtered segment, sequence, timestamp와 위치를 보존하는 상세 local trail.
- `event_activity_links`: event id, participant id, activity id, event name, active/auto-created 여부, joined/ended timestamps.
- `event_live_snapshot`: canonical activity의 최신 point/metric을 복사한 server 전송 cache. 한 participant scope의 current row만 둔다.
- Supabase `participant_live_state`: 운영자가 보는 minimal current state. 상세 point append가 없다.

SQLite version은 5로 올렸지만 앱 release version은 unreleased Build 5인 `0.3.1 / 5`를 유지한다. Supabase migration은 추가하지 않았다.

## activity/event lifecycle

```text
Participant session ACTIVE
  ├─ active activity 있음 → 같은 activity에 event context attach
  └─ active activity 없음 → EVENT_AUTO activity 한 건 생성
            ↓
same FGS + same activity_points recording
            ↓
event/activity 화면 전환 = navigation only
            ↓
restart → active activity + active event context 재사용
            ↓
ENDED 또는 session clear
  ├─ EVENT_AUTO → context 종료 + activity COMPLETED, local 보존
  └─ 기존 PERSONAL → context만 종료, personal activity 계속
```

같은 event/participant link가 있으면 ensure를 다시 호출해도 activity를 새로 만들지 않는다. live sync configure도 active event/activity link가 없으면 native에서 거부한다. 행사 context가 active인 동안 사용자가 운동 화면에서 pause/end해 tracking을 끊지 못하도록 UI와 native 양쪽에서 막는다.

현재 완료 활동 목록 화면은 구현돼 있지 않다. 그러나 event name/source/link와 completed activity/points를 삭제하지 않으므로 후속 ‘내 기록’ UI가 행사명, 행사 참여·걷기, 거리·시간을 표시할 수 있다.

## live sender와 queue

- upload: ACTIVE Participant only, production 기본 30초.
- sampling: 기존 accurate/balanced/battery profile 그대로이며 upload interval과 독립.
- latest-wins: `live:{eventId}:{participantId}`.
- monotonic server write: incoming sequence가 stored보다 클 때만 current row 갱신.
- diagnostics: manager start, last location, last success, latest sequence, pending counts.
- transport diagnostics: API base, sanitized endpoint, method/direction, last HTTP status/error, send/receive success time. WebView는 `StepLink network`, native는 Logcat `StepLinkNetwork`로 기록한다.
- stop: ENDED, session clear, terminal event/scope failure.
- Android: native FGS sender 하나. Web preview만 foreground JS fallback.

HELP는 LIVE와 분리된 UUID idempotent queue다. stale scope HELP와 영구 4xx는 terminal, network/timeout/408/429/5xx는 exponential backoff다. encrypted event credential은 Android Keystore envelope에서만 읽으며 service-role key는 client에 없다.

앱 시작 session restore에서 transport failure는 session invalid와 구분한다. `Failed to fetch`/timeout/5xx는 encrypted snapshot을 보존한 채 5초에서 최대 60초까지 backoff하고 online/focus에서 즉시 재시도한다. native live POST exception도 queue row를 삭제하지 않고 backoff한다. 따라서 Wi-Fi·테더링·모바일 데이터 전환이 GPS/SQLite lifecycle이나 행사 session lifecycle을 파괴하지 않는다.

실제 base URL은 hosted HTTPS Supabase URL이며 Capacitor `server.url`, localhost/사설 API 주소, cleartext HTTP 의존은 없다. 2026-09-05 host 및 Supabase log 확인에서 REST/Auth/Edge CORS preflight와 최근 authenticated GET/Edge POST가 200이었다. 과거 `TypeError: Failed to fetch`는 HTTP status가 만들어지기 전 WebView transport exception이라 기존 로그만으로 당시 endpoint를 사후 특정할 수 없으며, 새 계측 포함 APK에서 재현 시 정확한 endpoint/exception을 판정한다.

## 상태, polling, UI

2026-09-05 Android 지도/행사 overlay 6개 항목은 최신 APK에서 모두 PASS했다. worker의 내부 `maplibre-gl-shared.mjs` 누락은 `?worker&url` 의존성 번들링으로 해결했다. 상단은 왼쪽 햄버거, 중앙 활동 상태, 오른쪽 행사 버튼이며 overlay는 지도/기록 패널을 밀지 않는다. tracker는 `100dvh` 한 페이지 안에서 하단 정보 높이를 먼저 확보하고 지도에 남은 높이를 배정한다. Android MainActivity는 portrait로 고정한다.

누적경로 공백은 단순 렌더링 색상 문제가 아니다. current activity 920 points 중 metric filter 제외가 451개(49%), 최대 연속 제외 40개였고 `accuracy>50m` 356개가 주원인이었다. 지도는 accepted segment만 `MultiLineString`으로 만들기 때문에 해당 구간이 실제로 비어 보인다. GPS/filter/segment 생성 정책은 유지하며 2.5px round-cap dash `[0, 2.4]`로 작은 빨간 도트를 만든다.

Android Studio 재설치 후 384×853 WebView에서 document scroll과 viewport가 모두 853px이고 지도는 450px, 하단 panel은 화면 bottom 853px에 맞았다. manifest portrait 적용도 `ROTATION_0`으로 확인했으며 사용자 시각 검증도 PASS했다.

지도 camera state는 `FREE`, `NORTH_UP`, `NAVIGATION`이다. 단일 아이콘이 순환하며 모든 모드에서 기본적으로 현재 위치를 따른다. pointer/wheel gesture 중에는 현재 모드를 유지하고 follow만 4초간 일시 중지한다. NORTH_UP은 bearing 0, NAVIGATION은 accepted point의 유효 bearing을 speed ≥0.8m/s와 accuracy ≤25m 조건에서만 사용하고 그렇지 않으면 0으로 fallback한다. 내 위치 버튼은 현재 zoom과 mode를 유지하면서 즉시 center/follow를 복구한다.

- dashboard: 7.5초 polling
- participant feed: 15초 polling
- event lifecycle: foreground 5초, focus/visibility 복귀 즉시
- stale: 90초
- offline: 5분
- help cooldown: server 60초

Participant의 개인·행사 걷기는 같은 tracker/map이다. 자기 위치는 빨간 점, accepted local 경로는 작은 빨간 도트다. ACTIVE 행사에서만 별도 participant peer RPC로 받은 익명 current 위치를 파란 점으로 표시한다. tracker 상단바의 `행사` 버튼을 누르면 행사명과 공지/도움 요청이 지도 위 absolute overlay로 열리므로 지도와 하단 기록 패널을 밀지 않는다. main dashboard의 native/UI/recovery point 수 같은 개발 통계는 숨긴다. Operator/Owner는 권한 있는 event의 current rows를 목록·검색·학년·반·상태 filter와 MapLibre cluster로 본다. 공지는 ALL/GRADE/CLASS/PARTICIPANT/SELECTION 단방향이고, 도움은 INJURY/LOST/COMPANION/OTHER 및 `OPEN → ACKNOWLEDGED → RESOLVED`다.

MapLibre는 lazy chunk이고 기본 provider는 OpenFreeMap Bright다. 첫 Build 5 Android 설치본의 worker 의존 asset 누락은 `?worker&url` 번들링으로 해결했고 Android WebView 지도 UI 실기기 검증까지 PASS했다. public instance는 API key 없이 사용할 수 있으나 SLA가 없어 규모 확대 시 provider/self-hosting 결정을 다시 해야 한다. offline map은 미구현이다.

## 개인정보와 미래 확장

현재 participant-to-participant 정책은 `ANONYMOUS_CURRENT`다. `get_participant_peer_locations_v1`은 호출자가 해당 event의 실제 participant이고 event가 ACTIVE일 때만 동작한다. 자기 row를 제외하고 최근 5분의 current 위·경도를 소수점 4자리로 반올림하며 이름·학번·participant id·거리·상태·trail을 반환하지 않는다. direct `participant_live_state` SELECT의 self-only RLS는 그대로다. ENDED 또는 session scope 상실 시 feed가 비고 live upload도 중단된다.

## Supabase 상태

적용된 `0001`~`0004`는 수정하지 않았다. `20260905040250_phase3_anonymous_peer_locations.sql`은 remote에 단독 적용했고 catalog·execute 권한·rollback-only scope/필드 test를 통과했다. 이 객체들이 현재 v0.3.1 앱의 live/message/help/peer와 manual lifecycle 호출을 충족한다. local의 `0005_phase3_operational_hardening.sql`은 행사일 단위 code digest 예약과 server-owned auto-close 함수/trigger를 준비하는 비차단 후속 hardening이다. cron과 수정 join Edge Function도 미배포다. 수정 join 함수는 `0005`의 새 컬럼을 직접 사용하므로 단독 배포할 수 없으며, 승인 후 `0005 → 수정 join Edge Functions → cron` 순서로 적용한다.

Participant는 자기 live/help/message만 읽고 다른 participant current state를 읽지 못한다. Operator/Owner는 권한 event만 읽는다. 실제 role-token negative test와 Security Advisor는 배포 후 별도 수행해야 한다.

## 검증 경계

VERIFIED:

- `npm test` 63/63.
- `npm run lint`, `npm run build`, `npm run cap:sync`.
- static contracts: activity 자동 생성/재사용, canonical point path, current projection, navigation-only, restore 무중복, ENDED local 보존, HELP retry/terminal.
- Build 5 Android Studio Java compile/APK/install/launch, event-linked activity 복구와 native GPS/SQLite 증가, 완전 단절 중 local 지속, Wi-Fi 복구 후 Web polling 재개.
- Build 5 native event live upload: ADB 복구 후 최신 APK 설치, 행사 `12345` session 유지, `upsert_participant_live_state_v1` 반복 200, native `lastStage=request_succeeded`/`lastHttpStatus=200`/`pendingLiveCount=0`/`lastError=null`, remote 위·경도·`last_received_at` 및 `client_sequence=644`, `distance_m=6577.61`, `elapsed_time_ms=4412115` 갱신.
- SM-G998N 지도 UI 전체: OpenFreeMap, current/도트 경로, 자유 gesture, 모드 순환/아이콘, 내 위치, portrait 한 화면, 행사 overlay와 live upload 회귀 없음.
- SM-G998N background/foreground 유지: 화면을 약 2분 30초 Doze 상태로 둔 동안 동일 PID와 foreground location service가 유지됐다. 복귀 후 동일 행사/activity context, point count 1076→1086, sequence 1305→1314, RPC HTTP 200와 remote sequence 1314를 확인했다. 정지 screen-off 구간의 location callback 부재 때문에 이동 중 screen-off sampling은 이 결과에 포함하지 않는다.
- SM-G998N process-death recovery: 앱 UID로 PID 14063만 kill하고 수동 재실행한 뒤 PID 24593, 동일 activity ID와 `WALK / EVENT_AUTO / ACTIVE`, 동일 행사 context를 확인했다. point 1472→1477, sequence 1700→1705, 거리 22,646.97m→22,688.76m로 이어졌고 SQLite activities/active activity/대상 row/active event link 개수는 모두 불변이었다. RPC HTTP 200와 remote sequence 1705도 확인했다. `force-stop recovery`는 미검증이다.
- SM-G998N 비파괴 화면 왕복: ACTIVE Participant의 `걷기 → 메인 메뉴 → 설정 → 걷기` 실제 경로에서 동일 activity/event context와 native live manager가 유지됐고 30초 cadence RPC가 반복 HTTP 200이었다. 정지 상태라 point/sequence 1479/1707은 증가하지 않았으므로 이동 sampling 검증과 구분한다.
- SM-G998N force-stop recovery: `am force-stop` 뒤 package `stopped=true`, PID/FGS 부재와 8초간 비자동재기동을 확인했다. MAIN/LAUNCHER cold launch 뒤 동일 activity/event context, point 1489→1492, sequence 1717→1720, 거리 22,824.60m→22,842.45m, elapsed 30,339,889ms→30,420,849ms, 불변인 activity/link count를 확인했다. FGS/native live manager, RPC HTTP 200, 성공 직후 `request_succeeded`/`pendingLiveCount=0`/`lastError=null`, remote sequence 1720도 복구됐다.

CODE-LEVEL ONLY:

- SQLite v4→v5 upgrade, one-activity lifecycle, background sender connection, event/activity view switch.
- 통합 tracker의 local path/self marker/anonymous peer marker 및 OpenFreeMap provider.
- 0004/0005 contract와 remote 익명 peer RPC catalog·권한·scope/필드 검증.

NOT VERIFIED / NON-BLOCKING UNLESS NOTED:

- 이동 중 screen-off sampling, ENDED 실기기 흐름과 offline latest-wins 복구는 모두 PASS다.
- `[미검증 / 비차단]` Wi-Fi↔모바일 데이터/테더링 transport 전환 내구성. 일반 Wi-Fi 반복 200과 단절 후 Wi-Fi Web polling 복구와는 별도다.
- `[미검증 / 비차단]` 기존 personal attach 무중복과 실제 두 기기 anonymous peer E2E.
- 완료 활동 `listCompletedActivities` native API와 최신순 목록/기존 Summary 재진입은 구현·자동 검증 및 SM-G998N 실기기 PASS다. 대상 EVENT_AUTO ID와 27,492.64m, 완료 상태, 조회 전후 무중복을 확인했다. remote 0005/Cron/Edge와 실제 200/300 API load는 후속 검증이다.

최신 Android Back/role별 orientation 네이티브 변경은 공개 전 Android Studio compile/install gate다. Codex CLI Gradle은 2026-09-06 loopback 연결 오류로 Java compile 전에 중단됐다.

따라서 실기기 smoke 전 Phase 3 완료로 판정하지 않는다.
