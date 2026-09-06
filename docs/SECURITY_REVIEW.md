# Dependency and security review

검토일: 2026-09-05

## 배포된 경계와 credential

`@supabase/supabase-js` 2.114.0을 lockfile에 고정했다. client가 읽는 변수는 public `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`뿐이다. 실제 project `umiszktzbthuqjcuegkz`에는 Anonymous Sign-In과 server-only `STEPLINK_CODE_PEPPER`가 설정됐고 Edge Function 4개는 `verify_jwt=true`로 배포됐다. service-role key, pepper 값, 실제 `.env.local`은 source·문서·bundle에 넣지 않는다.

## 행사 코드

- 참가 코드: `0123456789ABCDEFGHJKMNPQRSTUVWXYZ`의 정확히 5문자. 숫자 0~9 허용, I/L/O 제외, trim/uppercase.
- 운영 코드: 같은 5문자 prefix + `ABCDEFGHJKMNPQRSTUVWXYZ`의 server random suffix.
- random은 Web Crypto와 rejection sampling을 사용한다.
- Owner 지정/random 모두 server-side HMAC과 digest unique constraint로 충돌을 판정한다.
- DB에는 `join-code`, `operator-code`, `event-session` purpose별 HMAC-SHA-256 digest만 저장한다.
- user/IP rate limit을 함께 적용하고 secret table의 client SELECT를 금지한다.

실제 E2E에서 생성, participant/operator join, recovery, lifecycle, ENDED 차단을 확인했다. 짧은 human-entry code는 여전히 낮은 보증 인증이므로 rate limit과 pepper 경계를 제거하지 않는다.

## session storage

Android는 Keystore AES-256-GCM key와 SQLite ciphertext를 사용한다. access/refresh/event token과 Owner code는 암호화 object 안에 있고 Keystore key나 plain token/code를 SQLite에 저장하지 않는다.

Web은 Supabase auth custom storage와 StepLink event snapshot에 encrypted IndexedDB를 사용한다.

- non-extractable AES-256-GCM CryptoKey를 IndexedDB에 structured clone으로 저장
- write마다 12-byte random IV
- record는 version/IV/ciphertext 중심
- access token, refresh token, event session token, Owner code의 plaintext localStorage 저장 금지
- corrupt/decryption/JSON failure 시 record 삭제와 재연결 안내
- storage unavailable이면 persistent하지 않은 memory-only 동작; localStorage fallback 금지

브라우저 저장소는 Android Keystore와 같은 하드웨어·OS 격리 수준이 아니다. 같은 origin에서 XSS가 실행되면 앱과 같은 권한으로 CryptoKey와 암호문을 사용할 수 있다. 따라서 CSP, dependency pinning, XSS 예방이 필수이며 암호화는 디스크·단순 storage inspection 위험을 줄이는 방어층으로만 본다. private/incognito와 browser 정책에서는 persistence가 실패할 수 있다.

Owner가 local encrypted state/Keystore를 완전히 잃으면 서버는 digest에서 plain code를 되돌릴 수 없고 anonymous Owner credential도 자동 복구할 수 없다. code rotation 또는 Owner account/recovery는 후속 설계다.

## RLS, stale session, SECURITY DEFINER

Participant recovery는 기존 row의 `user_id`를 새 Auth user로 옮긴다. 이전 session이 event SELECT에서 0행을 받는 것은 정상 stale 상태다. client는 `.maybeSingle()`과 domain error를 사용해 PostgREST 406 원문을 숨기고, 해당 client의 local event/auth session만 정리한다. 새 session의 remote 상태는 변경하지 않는다.

remote migration `phase2_function_execute_hardening`과 동일한 `0003_phase2_function_execute_hardening.sql`을 local에 추가했다.

- Edge-only internal 함수 4개는 anon/authenticated execute를 revoke하고 service role만 grant한다.
- `is_event_operator`, `is_message_operator`는 RLS helper라 authenticated execute가 의도됐다.
- `transition_event`는 authenticated callable이지만 함수 내부에서 `owner_user_id = auth.uid()`를 검사한다.
- SECURITY DEFINER 함수는 빈 `search_path`와 schema-qualified object를 유지한다.
- `event_access_secrets`, `code_verification_attempts`는 RLS enabled + client policy 없음 + privilege revoke가 의도된 server-only table이다. Advisor INFO를 없애려고 client policy를 추가하지 않는다.

0003 전 Advisor의 internal function execute 경고는 해소됐다. 위 helper 경고와 server-only no-policy INFO는 설계상 남을 수 있으며, 경고 수를 0으로 만들기 위해 권한 경계를 약화하지 않는다.

## lifecycle polling과 부하

종료 전 foreground session은 5초 polling, focus/visibility 복귀 즉시 fetch, hidden skip, ENDED 뒤 stop이다. 200~300명이 모두 foreground면 평균 약 40~60 GET/s가 될 수 있다. 현재 Phase에서는 Realtime으로 무조건 전환하지 않으며 load simulation 뒤 polling/Realtime/Broadcast를 결정한다.

## Android backup, one-activity와 event location

Manifest `allowBackup=false`와 Android 11 이하/12+ backup exclusion rule을 유지한다. 사용자 증거상 실패 시점에도 로컬 일반 걷기 0.49km/22:18이 기록됐으므로 native GPS 수집 실패가 아니라 event live sender 미시작이 원인이었다.

최종 Build 5 source는 하나의 canonical activity/FGS만 사용한다. ACTIVE 행사 참가 시 기존 active activity에 event context를 붙이거나, 없으면 `EVENT_AUTO` activity 한 건을 만들고 같은 `activity_points`에 상세 trail을 저장한다. `event_live_snapshot`은 이 canonical record에서 최신 상태만 복사하며 독립 trail이나 metric authority가 아니다. 기존 request profile/filter/raw 저장과 `NativeGpsTest`는 수정하지 않았다.

`event_activity_links`에는 event/participant/activity 식별자와 lifecycle metadata만 있고 session token이나 code가 없다. 완료된 event activity/point는 local history 보존 대상이다. server에는 상세 point가 전송되지 않는다. 행사 화면과 운동 화면 전환은 단순 navigation이며 credential 또는 location 권한 경계를 바꾸지 않는다.

Native manager는 access/refresh/event-session token을 SharedPreferences나 로그에 기록하지 않는다. 기존 Android Keystore AES-256-GCM ciphertext를 공유 utility로 해독하고, Auth refresh로 회전한 token pair도 같은 envelope에 다시 암호화한다. SharedPreferences에는 public Supabase base URL, publishable·anon key, event/participant UUID와 cadence만 둔다. JWT `iss` origin과 configured Supabase origin이 다르면 송신을 차단한다. Native 코드에는 service-role key가 없다.

## Phase 3 current-state 보안 검토

`0004_phase3_live_operations.sql`은 remote에 적용됐다. 아래 항목은 source/migration contract와 기존 배포 사실을 구분하며, 이번 작업에서 실제 role-token negative test나 Advisor 재실행은 하지 않았다.

- participant live write는 direct table grant를 제거하고 `upsert_participant_live_state_v1`만 허용한다. 함수가 authenticated participant/event/ACTIVE를 확인하고 증가 sequence만 반영한다.
- participant live SELECT policy는 `participants.user_id = auth.uid()`인 자기 row로 한정한다. Operator/Owner는 기존 `is_event_operator(event_id)` 범위만 읽는다.
- 공지/도움 operational table의 직접 write grant를 제거하고 대상 범위를 검사하는 RPC를 사용한다.
- 네 RPC는 `SECURITY DEFINER`, `search_path=''`, schema-qualified object, public/anon revoke, authenticated explicit execute grant를 사용한다.
- 도움 요청은 UUID idempotency와 server 60초 cooldown을 사용한다.
- server에는 participant current row만 있고 상세 GPS trail append 경로가 없다.
- direct `participant_live_state` SELECT는 여전히 participant 자기 row만 허용한다. 별도 `get_participant_peer_locations_v1`만 ACTIVE event의 실제 participant에게 다른 참가자의 최근 current 좌표를 소수점 4자리로 반올림해 반환한다. 자기 row, 5분 이상 stale row, 이름·학번·participant id·상태·거리·trail은 제외한다.

0004 정적 migration contract test는 통과했다. 실제 role-token negative test, Security Advisor와 missing-index 결과는 별도 기록이 필요하다.

`20260905040250_phase3_anonymous_peer_locations.sql`은 2026-09-05 remote에 단독 적용했다. 함수는 `SECURITY DEFINER`, 빈 `search_path`, schema-qualified object를 사용하고 public/anon execute를 revoke한 뒤 authenticated에만 명시적으로 grant한다. 함수 내부에서 `auth.uid()`, participant/event 일치, ACTIVE 상태를 다시 검사하므로 client validation이나 direct table grant를 신뢰하지 않는다. Remote rollback-only authenticated-role/claim fixture에서 정상 caller 1개 peer, 비참가·타 행사 0개, self/5분 초과/타 행사 제외, DB 4자리 rounding, `latitude/longitude/lastReceivedAt` 3개 key만 반환을 확인했다. anon role 호출은 PostgreSQL 42501로 거부됐고 fixture 잔존은 0건이다.

Security Advisor는 이 RPC에 `authenticated_security_definer_function_executable` WARN을 보고한다. authenticated client 호출이 기능상 의도됐고 내부 authorization negative test가 통과했으므로 현재는 의도된 경고로 기록한다. 실제 client JWT와 두 기기를 이용한 E2E는 별도 남는다.

## 0005 operational hardening 보안 검토

새 `0005_phase3_operational_hardening.sql`은 remote 미적용이다. 적용된 0001~0004 history를 수정하지 않는다.

- code digest unique 범위를 `event_date` 단위로 바꾸되 plain code를 추가하지 않는다.
- ENDED는 active lookup에서 제외하지만 같은 날짜 digest 예약은 유지한다.
- 전역 active unique 제약을 두지 않고 code-only join은 Asia/Seoul 기준 현재까지의 가장 최근 `event_date`를 선택해 다음 날짜 재사용 정책과 조회 결정성을 함께 유지한다.
- event row와 secret row의 날짜 일치를 composite foreign key로 고정한다.
- auto-close trigger/function은 schema-qualified object와 빈 `search_path`를 사용하고 public/anon/authenticated execute를 revoke한다. scheduler가 호출할 함수만 service role에 grant한다.
- `supabase/cron/phase3-auto-close.sql`은 검토 후 별도로 실행할 activation 파일이며 현재 remote scheduler는 없다.
- local contract test는 daily reservation, ENDED lookup 해제, deadline 계산, idempotent close와 grant를 검사한다. 실제 PostgreSQL parse/apply/Advisor 결과가 아니다.

stale operational queue도 권한 경계의 일부다. session scope가 다른 HELP는 terminal 처리해 이전 event token으로 무한 재시도하지 않으며, 영구 4xx와 네트워크/5xx retry를 분리한다. terminal 원인은 local diagnostic에만 남기고 사용자 UI에는 raw endpoint/fetch 오류를 노출하지 않는다.

## 남은 위험

- recovery는 code + participant identifier + 이름을 아는 사용자를 신뢰하는 낮은 보증 방식이다.
- 200/300명 mock simulation만 완료; 실제 DB/API load와 reverse-proxy IP/shared-network rate limit 튜닝 미실시.
- 수정 후 browser refresh/완전 재시작, private mode, 다양한 browser compatibility 실검증 필요.
- Android Keystore/DB upgrade와 소형화면 일정 overflow 재확인 필요.
- Build 5 one-activity auto-create/restore/ENDED 보존과 native live projection은 실기기 PASS다. 기존 PERSONAL ACTIVE activity에 event context만 붙이는 무중복 경로는 미검증/비차단이다.
- 완료 activity 목록은 native SQLite의 `COMPLETED` row를 최신순·읽기 전용으로 조회하고 저장된 point로 기존 요약 화면을 연다. SM-G998N에서 조회/요약 재진입 전후 ID 무중복과 대상 EVENT_AUTO 1건을 확인했으며 이 동작이 새 activity를 만들지 않았다.
- OpenFreeMap public instance의 SLA 부재에 대한 운영 provider/self-hosting 결정, live current-state retention/cleanup, 사진 검증은 후속 security gate다.
- 최근 알려진 audit은 moderate 3건, high/critical 0건이며 moderate는 개발용 Capacitor CLI 하위 의존성 경로다. `npm audit fix --force`는 실행하지 않는다.
