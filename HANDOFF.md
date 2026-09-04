# StepLink 인수인계

최종 갱신: 2026-09-04

저장소: `C:\Codex\StepLink`

branch / Phase 0·1 기준 commit: `main` / `0734feb`

origin: `https://github.com/park791014-web/StepLink.git`

앱 버전: `0.2.1` / Android Build 3

현재 Phase 2 변경은 working tree에 있고 commit/push하지 않았다. 이 문서는 기억보다 실제 source와 사용자가 실제 Supabase DB/Edge 로그로 확인한 E2E 결과를 우선한다.

## 1. Phase 2 완료 판정

**기능 및 실제 핵심 E2E 완료. 단, 대규모 load·다환경·이번 persistence 수정 후 browser/새 APK smoke는 후속 검증 항목이다.**

Phase 3 live 위치/dashboard/공지/도움/course/photo/report를 구현했다는 뜻은 아니다. GPS core는 이번 작업에서 변경하지 않았다.

## 2. 현재 정상 동작과 실제 확인

### Phase 1 Android

- Android Studio build/APK/install 성공.
- 약 0.41km 야외 보행과 화면 OFF 중 native GPS/SQLite 기록 지속.
- 화면 복귀 reconciliation, 거리·pace·예상 1km·평균속도·diagnostics 정상.

### Phase 2 Supabase E2E

실제 project `umiszktzbthuqjcuegkz`, region `ap-northeast-2`에서 Android + PC browser + DB/Edge 로그로 확인했다.

- Anonymous Sign-In ON.
- `STEPLINK_CODE_PEPPER` Edge secret 설정 완료. 값은 Git/문서에 없음.
- public URL/publishable key가 `.env.local`에 설정됐으며 파일은 gitignore 대상.
- remote migration: `phase0_schema`, `phase2_event_sessions`, `phase2_function_execute_hardening`.
- Edge 배포: `event-create`, `event-join`, `operator-join`, `event-session-validate`; `verify_jwt=true`.
- `Test2` 생성, 예시 참가/운영 code `5VNCF` / `5VNCFB`.
- event, access digest, OWNER membership, participant live-state 생성.
- Owner 1, Operator 2, Participant 5까지 연결.
- `DRAFT → OPEN → ACTIVE → ENDED`, `started_at`/`ended_at` 확인.
- OPEN/ACTIVE 참가 허용, ENDED 참가 차단.
- 같은 identifier/name recovery 시 새 participant row 없이 기존 row에 재연결하고 `last_recovered_at` 갱신.
- 종료 상태와 메시지 표시.

## 3. 확정 정책

- 참가 code: `0123456789ABCDEFGHJKMNPQRSTUVWXYZ`의 정확히 5문자. 0~9 허용, I/L/O 제외, trim/uppercase.
- 운영 code: 같은 5문자 prefix + `ABCDEFGHJKMNPQRSTUVWXYZ`의 server random suffix 1문자.
- Owner 직접 지정 또는 server random; 충돌 최종 권위는 digest unique constraint.
- DB에는 plain code/token 대신 `join-code`, `operator-code`, `event-session` 목적별 HMAC-SHA-256 digest만 저장.
- 상태: `DRAFT`(준비중), `OPEN`(참가 접수중), `ACTIVE`(진행중), `ENDED`(종료).
- 참가: DRAFT 불가, OPEN 가능, ACTIVE 가능, ENDED 불가.
- lifecycle 최종 전이는 실제 Owner만 수행.
- `participant_identifier`와 행사 code는 별도 필드·validation.
- 참가자는 다른 참가자 데이터/위치를 조회하지 않는다.
- Rich on the phone, minimal on the server. 상세 GPS canonical path는 native foreground service → SQLite.

## 4. 이번 0.2.1 해결 사항

### Web session persistence

기존 `persistSession:false`와 memory-only snapshot을 수정했다.

- Web Supabase auth는 async custom storage adapter와 `persistSession:true` 사용.
- StepLink event snapshot도 동일한 encrypted IndexedDB 계층 사용.
- AES-256-GCM, 매 write random 12-byte IV.
- `extractable=false` CryptoKey를 IndexedDB에 보관.
- access/refresh/event session token과 Owner code는 ciphertext 안에 저장.
- plain localStorage fallback 금지. storage unavailable이면 탭 memory-only.
- corrupt/decryption/JSON failure는 record를 정리하고 재연결 안내.

Participant/Operator/Owner는 같은 restore path를 사용한다. Owner code도 secure envelope에서 재표시된다. 코드는 server DB에서 복원하는 것이 아니다.

Android `SecureEventSessionPlugin`과 Keystore Java는 변경하지 않았다. 기존 plugin이 JS `secrets` object 전체를 암호화하므로 새 `ownerCodes`도 ciphertext에 포함된다.

### recovery 이전 session 406

event refresh를 `.single()`에서 `.maybeSingle()`로 바꿨다. RLS 결과가 0행이면 PostgREST 원문 대신 domain stale error를 만들고 다음을 수행한다.

- “이 참가자 세션이 다른 기기 또는 브라우저에서 다시 연결되었습니다.” 안내.
- 이전 client의 encrypted event snapshot 삭제.
- 이전 client의 local Supabase Auth session 정리.
- 새로 recovery된 다른 client의 session/DB row는 건드리지 않음.
- polling 무한 406 반복 중단.

### lifecycle 전달 지연

- foreground 종료 전 session: 5초 interval.
- visibility/focus 복귀: 즉시 fetch.
- hidden: interval fetch skip.
- ENDED: polling stop.

200~300명 전원이 foreground면 이론상 평균 40~60 GET/s다. Realtime은 이번 Phase에서 도입하지 않았으며 load simulation 후 결정한다.

### 기타

- `supabaseClient.ts` 포함 source의 mojibake를 검색했으며 현재 사용자 문구는 정상 UTF-8이다.
- `.env.local` 첫 줄 BOM으로 Vite URL 변수가 누락될 수 있는 Windows PowerShell 5.1 문제와 BOM 없는 작성법을 README에 기록했다.
- UI 상태명을 자연스러운 한국어로 표시한다. 내부 enum은 유지한다.
- 버전 `0.2.1`, Android `versionCode 3`, `versionName 0.2.1`, 설정 화면 Build 3으로 통일했다.

## 5. migration과 Advisor

local 최종 파일:

1. `supabase/migrations/0001_phase0_schema.sql`
2. `supabase/migrations/0002_phase2_event_sessions.sql`
3. `supabase/migrations/0003_phase2_function_execute_hardening.sql`

0003은 remote에 이미 적용된 내용을 local에 그대로 반영한 것이다. internal Edge-only 함수 4개의 anon/authenticated execute를 revoke하고 service role만 명시적으로 grant한다. 이번 작업에서 remote에 다시 적용하지 않았다.

의도된 remaining Advisor 항목:

- `is_event_operator`, `is_message_operator`: authenticated RLS helper.
- `transition_event`: authenticated callable이나 내부 Owner 검사.
- `event_access_secrets`, `code_verification_attempts`: RLS enabled + policy 없음이 의도된 server-only table.

Advisor 숫자를 0으로 만들기 위해 이 권한·policy를 깨뜨리지 않는다.

## 6. UI overflow 상태

시작/종료 예정 input에는 `minmax(0,1fr)`, grid item/input `min-width:0`, input `max-width:100%`, 520px 이하 한 열을 적용했다. 코드 재검토 결과 유지되어 있으며 화면 전체 `overflow:hidden`으로 숨기지 않는다. 작은 Android 실기기 재확인은 아직 하지 않았다.

## 7. 자동 검증

| 명령 | 결과 | 비고 |
| --- | --- | --- |
| `npm run test` | PASS | 11/11 |
| `npm run lint` | PASS | 오류·경고 없음 |
| `npm run build` | PASS | TypeScript + Vite; 기존 MapLibre 966kB chunk 경고 |
| `npm run cap:sync` | PASS | Build 3 web assets Android 동기화 |
| Android compile | 미실행 | Java/Keystore/GPS native logic 미변경, 이전 관리 환경 loopback 한계 |

테스트 범위에는 기존 activity/event policy와 다음 targeted test가 포함된다.

- encrypted storage Participant/Operator/Owner round-trip.
- persistent record에 plain auth/event token 및 Owner code가 없는지 확인.
- corrupt ciphertext 실패와 remove.
- RLS 0행이 PostgREST 406 원문이 아닌 stale domain error가 되는지 확인.

브라우저 integration automation은 현재 없으므로 refresh/완전 재시작을 PASS라고 쓰지 않는다. GPS 장시간 테스트는 수행하지 않는다.

## 8. 알려진 문제와 위험

1. 수정 후 일반 browser refresh/완전 종료·재시작 및 세 역할 restore 실검증이 필요하다.
2. WebCrypto/IndexedDB는 Android Keystore와 동일 수준이 아니며 same-origin XSS를 막지 못한다.
3. private/incognito, storage quota/차단, 다양한 browser compatibility 추가검증이 필요하다.
4. Owner가 모든 local secure state를 잃으면 기존 plain code와 anonymous Owner credential을 서버에서 복구할 수 없다.
5. participant recovery는 code/id/name 기반의 낮은 보증 인증이다.
6. 200~300명 load simulation, 장시간 행사, 여러 Android 제조사 미검증.
7. 작은 Android 화면의 종료시간 overflow 수정 후 device recheck가 남았다.
8. Android Keystore/SQLite v1→v2 upgrade 실기기 검증이 남았다.
9. 지도 background 미표시 원인은 미확정이다.
10. MapLibre lazy chunk size warning이 남는다.

## 9. 변경 금지사항

- `NativeGpsPlugin`, `StepLinkLocationService`, FusedLocationProviderClient, raw GPS filter/storage, SQLite GPS canonical path, sampling profile 수정 금지.
- raw GPS point 삭제 정책 추가 금지.
- `event_access_secrets`/`code_verification_attempts` client policy 또는 SELECT 노출 금지.
- plain code/token, service-role key, pepper를 localStorage/readable DB/client 문서에 저장 금지.
- remote DB reset, migration reset/reapply, test row 삭제, pepper rotation, Edge secret/Auth 설정 변경 금지.
- destructive SQLite migration 금지.
- `npm audit fix --force`, commit, push 금지.

## 10. 실행·검증

```powershell
npm run test
npm run lint
npm run build
npm run cap:sync
```

Android compile이 필요하면 일반 Windows Android Studio에서 Build 3 APK를 만든다. 이번 JS/session 변경은 Android Java/GPS core를 바꾸지 않았다.

## 11. Phase 3 이후 방향

- phone 개인운동/참가자 UI portrait-first, 주요 화면 세로 고정 검토.
- 운영 dashboard는 tablet/PC landscape 허용.
- offline map은 사용자 선택, 용량 표시, Wi-Fi only; 자동 대용량 다운로드 금지.
- 운동 누적 기록 화면과 지도 background 원인 분석.
- live-location, 공지/도움요청, course/finish/photo/report.

## 12. 다음 APK/browser 최소 smoke

1. Version 0.2.1 / Build 3 확인.
2. Owner/Participant/Operator 각각 join/create → refresh → browser 재시작 restore.
3. Owner code 재표시.
4. 새 session recovery 후 이전 browser의 자연스러운 stale 안내와 새 session 유지.
5. lifecycle 변경이 foreground에서 약 5초 이내, focus 복귀 즉시 반영.
6. 작은 Android portrait에서 시작/종료 예정 input overflow 없음.
7. 기존 개인 activity 보존과 GPS 화면 짧은 진입 확인.
