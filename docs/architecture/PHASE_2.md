# Phase 2 행사 세션 아키텍처

갱신 기준: 2026-09-04 working tree와 사용자가 실제 Supabase DB/Edge 로그로 확인한 E2E 결과.

## 완료 판정

Phase 2는 **기능 및 실제 핵심 E2E 완료, 대규모 load·다환경·수정 후 browser persistence smoke는 후속 검증** 상태다. Phase 3 기능은 포함하지 않는다.

실제 Supabase project `umiszktzbthuqjcuegkz`, region `ap-northeast-2`에 Anonymous Sign-In과 `STEPLINK_CODE_PEPPER` Edge secret이 설정됐다. `phase0_schema`, `phase2_event_sessions`, `phase2_function_execute_hardening` migration과 `event-create`, `event-join`, `operator-join`, `event-session-validate`가 배포됐고 Edge Function은 `verify_jwt=true`로 사용 중이다. secret 값과 service-role key는 client와 문서에 없다.

## 책임 경계

```text
React screens / useEventSession
  ├─ EventGateway
  │    ├─ Supabase anonymous Auth
  │    ├─ Edge Functions: code 검증, join/recovery, session 검증
  │    └─ transition_event RPC: Owner-only lifecycle
  └─ SecureEventSession
       ├─ Android: Keystore AES-256-GCM + SQLite ciphertext
       └─ Web: non-extractable WebCrypto AES-GCM key + IndexedDB ciphertext
```

React component는 code 검증용 table을 직접 조회하지 않는다. Edge runtime만 Supabase server secret과 `STEPLINK_CODE_PEPPER`를 읽는다.

## 행사 코드와 lifecycle

참가 코드는 `0123456789ABCDEFGHJKMNPQRSTUVWXYZ`에서 고른 정확히 5문자다. 숫자 0~9는 허용하고 I/L/O는 제외한다. 입력은 trim 후 uppercase한다. Owner가 직접 지정하거나 비워 두면 Edge가 Web Crypto rejection sampling으로 생성한다. 운영 코드는 참가 코드의 동일한 5문자 prefix + `ABCDEFGHJKMNPQRSTUVWXYZ`의 random suffix 1문자다.

직접 지정/자동 생성 모두 목적별 HMAC-SHA-256 digest와 DB unique constraint로 충돌을 server-side 확인한다. plain code는 생성 응답에만 포함되고 DB에는 저장하지 않는다. Owner 기기에서는 현장 재표시를 위해 Android Keystore 또는 Web encrypted session envelope 안에 보관한다.

내부 상태와 참가 정책:

| DB/domain | 사용자 표시 | 참가 |
| --- | --- | --- |
| `DRAFT` | 준비중 | 불가 |
| `OPEN` | 참가 접수중 | 가능 |
| `ACTIVE` | 진행중 | 가능 |
| `ENDED` | 종료 | 불가 |

상태 전이는 Owner만 `DRAFT → OPEN → ACTIVE → ENDED` 순서로 실행한다. ACTIVE 중 참가는 지각 참가·늦은 앱 실행·recovery를 위해 의도적으로 허용한다. 별도 접수 마감 기능은 이번 Phase에 없다.

## 참가와 recovery

학교 기본 `participant_identifier`는 5자리 숫자지만 server/DB는 일반 행사를 위해 길이 1~80 문자열로 다룬다. 행사 코드 validation과 학번 validation은 별도다.

같은 `(event_id, participant_identifier)`와 정규화한 같은 이름으로 다시 join하면 기존 participant row의 `user_id`와 session digest를 새 anonymous Auth user로 재연결하고 `last_recovered_at`을 갱신한다. 이름 불일치, BLOCKED participant, 같은 Auth user의 다른 participant 연결은 차단한다. 실제 E2E에서 row 중복 없이 recovery되는 것을 확인했다.

recovery 후 이전 client는 RLS상 event가 0행이 될 수 있다. client는 `.maybeSingle()`로 이를 정상 stale 상태로 처리하고 `EVENT_SESSION_REBOUND` 안내를 표시한 뒤 그 client의 local event snapshot과 local Auth session만 정리한다. 새로 연결된 다른 client의 session에는 영향을 주지 않는다. 이 수정은 unit test를 통과했으며 실제 다중 browser 재확인은 smoke 항목이다.

## Web session persistence

Supabase JS에는 Web에서만 `persistSession: true`와 async custom storage adapter를 제공한다. adapter와 StepLink event snapshot은 같은 origin의 IndexedDB를 사용하되 값은 모두 WebCrypto AES-GCM ciphertext다.

- AES-256-GCM, 매 write마다 12-byte random IV
- `extractable=false`인 `CryptoKey`를 IndexedDB structured clone으로 보관
- access token, refresh token, event session token, Owner human-readable code를 plaintext localStorage에 저장하지 않음
- corrupt ciphertext/JSON은 폐기하고 재연결 안내
- IndexedDB/WebCrypto가 차단되면 plaintext fallback 없이 탭 메모리만 사용

Participant, Operator, Owner 모두 같은 restore path를 사용한다. Owner code는 encrypted envelope에 포함돼 재시작 후 다시 표시될 수 있다. local secure state를 완전히 잃으면 서버에는 digest만 있으므로 기존 plain code와 Owner credential을 복원할 수 없다.

Web 방어 수준은 Android Keystore와 같지 않다. 같은 origin에 XSS가 있으면 실행 중인 앱 권한으로 IndexedDB/WebCrypto를 사용할 수 있으므로 CSP, dependency 통제와 XSS 예방이 핵심이다. private/incognito, quota, browser 정책으로 persistent storage가 불가능할 수 있다.

## Android session

Android는 기존 `SecureEventSessionPlugin`, Keystore 별칭 `steplink_event_session_key_v1`, AES-256-GCM, SQLite `event_local_state` 구조를 유지한다. Java/Keystore 구현은 이번 0.2.1 수정에서 변경하지 않았다. JS가 Owner code를 기존 암호화 secrets object에 포함하므로 code도 ciphertext 안에 저장된다. GPS core와 SQLite canonical GPS path는 변경하지 않았다.

## lifecycle polling

foreground의 OPEN/ACTIVE를 포함한 종료 전 session은 5초마다 event row를 조회한다. visibility/focus 복귀 시 즉시 조회하고 hidden 상태에서는 interval fetch를 건너뛰며 `ENDED` 확인 뒤 polling을 중단한다. Realtime은 사용하지 않는다.

200~300명이 모두 foreground라면 이론상 평균 약 40~60 GET/s다. 실제 interval 시작점은 client별로 분산되지만 load simulation 전에는 충분하다고 단정하지 않는다. Realtime/Broadcast 채택 여부와 interval 조정은 Phase 3 load test 뒤 결정한다.

## migration과 Advisor

remote 적용 순서는 다음과 같으며 local에도 같은 세 파일이 있다.

1. `0001_phase0_schema.sql`
2. `0002_phase2_event_sessions.sql`
3. `0003_phase2_function_execute_hardening.sql`

0003은 Advisor에서 발견한 public SECURITY DEFINER execute 노출을 보정한다. `consume_code_rate_limit_internal`, `create_event_internal`, `join_event_internal`, `join_operator_internal`의 anon/authenticated 직접 실행을 revoke하고 service role만 유지한다. remote에는 이미 적용됐으며 이 local 파일을 다시 remote에 적용하지 않는다.

`is_event_operator`, `is_message_operator`, `transition_event`의 authenticated execute/Advisor warning은 RLS helper와 Owner lifecycle을 위한 의도된 설계다. 함수 내부 authorization과 빈 `search_path`를 유지한다. `event_access_secrets`, `code_verification_attempts`의 RLS enabled + no policy INFO도 server-only table을 client에서 막기 위한 의도다.

## UI와 환경 파일

일정 입력은 `minmax(0, 1fr)`, `min-width: 0`, `max-width: 100%`, 520px 이하 1열을 적용했다. 소형 Android 재확인은 아직 필요하다.

Windows PowerShell 5.1 `Set-Content -Encoding UTF8`의 BOM 때문에 첫 `VITE_SUPABASE_URL`이 누락될 수 있다. `.env.local`은 UTF-8 without BOM 또는 값이 ASCII뿐이면 ASCII로 작성한다. 실제 `.env.local`은 gitignore하며 credential을 문서화하지 않는다.

## 실제 E2E 결과

행사 `Test2`와 예시 코드 `5VNCF` / `5VNCFB`로 다음을 확인했다.

- 행사/event secret/OWNER membership 생성, 최초 DRAFT
- DRAFT→OPEN, OPEN→ACTIVE, ACTIVE→ENDED 및 timestamp 기록
- Participant 5명, Owner 1명, Operator 2명
- participant live-state 자동 생성
- Participant recovery 중복 방지와 `last_recovered_at` 갱신
- 별도 Operator join
- OPEN 및 ACTIVE 신규 참가
- 종료 메시지 표시와 ENDED 신규 참가 차단

미검증: 200~300명 load, 장시간 행사, 다제조사·모든 browser, 수정 후 refresh/완전 재시작 restore, Owner local credential 완전 분실 복구, 소형 Android 일정 overflow 재확인.

## Phase 2 이후 방향

- phone 개인운동/참가자 UI portrait-first 및 주요 화면 세로 고정 검토
- 운영 dashboard의 tablet/PC landscape
- 사용자 선택 offline map, 사전 용량 표시, Wi-Fi only, 자동 대용량 다운로드 금지
- 운동 누적 기록 화면
- 지도 background 미표시 원인 분석
- Phase 3 live-location, 공지/도움요청, course/finish/photo/report
