# Phase 3 sync queue

## 데이터 책임

- `activities/activity_points`: personal과 event-linked 활동 모두의 canonical local record.
- `event_activity_links`: activity와 event/participant context, active 여부, 자동 생성 여부, joined/ended 시각.
- `event_live_snapshot`: canonical activity의 최신 위치·거리·시간·sequence만 담는 current-only cache.
- `sync_queue`: 네트워크 실패를 견디는 전송 queue. GPS point 저장소가 아니다.
- Supabase `participant_live_state`: server-side current operational row. 상세 trail은 없다.

`StepLinkLocationService`는 하나의 `activity_id`에 Fused callback을 기록한다. `EventLiveSyncManager`는 그 activity의 최신 point/metric을 `event_live_snapshot`에 투영하고 기본 30초마다 전송한다. GPS sampling과 upload cadence는 독립이다.

ACTIVE 참가 시 React → `NativeGps.ensureEventActivity` → 기존 active activity 연결 또는 `EVENT_AUTO` 한 건 생성 → 같은 FGS 시작/복구 → live sync configure 순서다. `EventSyncQueuePlugin`은 active event/activity link가 없으면 live sync 구성을 거부한다. restore/re-render는 같은 event link를 재사용한다.

## queue 정책

- `LIVE_STATE`: `live:{eventId}:{participantId}` latest-wins. 복구 시 과거 30초 snapshot을 몰아서 보내지 않는다.
- `HELP_REQUEST`: UUID idempotency key. LIVE와 별도로 durable retry한다.
- scope가 다른 stale LIVE는 삭제, stale HELP는 `TERMINAL`과 diagnostic으로 보존한다.
- scope/event/validation/cooldown/auth 계열 영구 4xx는 terminal이다.
- network/timeout/408/429/5xx는 2초부터 최대 5분 exponential backoff다.
- native POST transport exception도 queue row를 보존하고 backoff한다. `StepLinkNetwork` Logcat 및 live diagnostics에 sanitized endpoint, HTTP status/exception, 마지막 송수신 성공을 남긴다.

Android sender는 매 tick 최신 encrypted event session을 확인한다. access/refresh token은 Keystore AES-GCM envelope에서만 읽는다. SharedPreferences에는 public Supabase URL/anon key, event/participant/activity scope와 비밀이 아닌 진단값만 둔다.

ENDED/session clear는 live queue/snapshot을 정리하고 event context를 종료한다. 자동 생성 activity는 완료·보존하고, 기존 personal activity는 계속한다. WebView hidden 시 feed polling은 쉬지만 native FGS sender는 같은 activity lifecycle에서 계속된다. force-stop/OEM kill/Doze의 정확한 cadence는 보장하지 않는다.

## 검증 상태

정적/단위 계약은 one activity 생성·재사용, canonical point 저장, snapshot projection, restore 무중복, navigation-only 전환, ENDED 보존, latest-wins와 HELP retry/terminal을 검사한다. 통합 지도는 이 queue가 아니라 local `activity_points`를 경로 source로 사용하며 peer RPC 실패가 GPS/SQLite/queue lifecycle을 중단시키지 않는다. `npm test` 55/55, lint/build는 PASS다. 최종 cap sync/Android compile 결과는 HANDOFF의 최신 기록을 따른다. 실기기 background/offline/recovery/ENDED 및 DB v4→v5 upgrade는 미검증이다.
