# 실기기·Supabase E2E 검증 기록

## Phase 1 Android 확인

일반 Windows Android Studio에서 build/APK/install에 성공했고 약 0.41km 야외 보행을 기록했다. 화면 OFF 중 native 기록이 지속됐고 복귀 뒤 누적 거리, pace, 1km 예상시간, 평균속도, GPS diagnostics가 정상 표시됐다. 지도 배경은 표시되지 않았으며 원인은 미확정이다.

force-stop, 제조사별 강제 절전, 수 시간 장기 기록, 모든 OS/제조사 조합은 확인하지 않았다. Phase 2는 GPS core를 변경하지 않았으므로 이번 작업에서 GPS 장시간 회귀를 반복하지 않는다.

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

- 200~300명 load simulation과 학교 공유망 rate limit
- 장시간 행사
- 여러 Android 제조사 및 모든 browser
- Owner local credential 완전 분실 복구
- SQLite v1→v2 upgrade/Keystore failure 실기기 검증
- 소형 Android 일정 overflow 수정 후 재확인
- 지도 배경 미표시 원인
- Phase 3 live-location, 공지/도움, course/finish/photo/report
