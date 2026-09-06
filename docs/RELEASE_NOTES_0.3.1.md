# StepLink v0.3.1 / Android Build 5

릴리스 준비일: 2026-09-06

## 주요 변경

- 개인 및 행사 걷기를 하나의 native activity/SQLite 기록 경로로 통합했다.
- ACTIVE 행사 current state를 약 30초 주기로 latest-wins 방식으로 업로드하며, 네트워크 단절 중에도 local GPS 기록을 유지한다.
- 운영자 dashboard, 상태/검색/filter, 공지, 도움 요청 및 익명 participant current-location 지도를 추가했다.
- 완료된 개인 및 `EVENT_AUTO` 활동을 최신순으로 조회하고 기존 요약 화면으로 다시 열 수 있다.
- MapLibre worker packaging과 Android live sender의 `ACCESS_NETWORK_STATE` 누락을 해결했다.
- 지도 모드, 내 위치 follow, 작은 방향 marker/peer marker, compact 행사 화면과 role별 responsive orientation을 적용했다.
- 참가자 anonymous peer는 기본 OFF인 `주변 참가자 확인` 토글로만 표시한다. 자기 위치는 마지막 신뢰 bearing을 유지하는 빨간 navigation pointer로 표시한다.
- Android 시스템 Back은 앱 내부 history를 먼저 이동하고 첫 화면에서만 종료하도록 연결했다.

## 검증 완료

- 자동 테스트 63/63, lint, production build, Capacitor sync PASS.
- SM-G998N: 지도/UI, Wi-Fi live upload, offline latest-wins 복구, process-death/force-stop 복구, 이동 중 screen-off sampling, ENDED 자동 완료, 완료 기록 재진입 PASS.
- anonymous peer RPC catalog/권한/negative fixture PASS.

## 공개 전 gate

- 최신 지도 peer toggle/navigation pointer와 `AppUiPlugin`/`MainActivity` Back 및 role별 orientation 변경을 Android Studio에서 1회 build/install하고 묶음 UI smoke한다. Codex Gradle은 관리 환경의 loopback 오류로 compile 전에 중단됐다.

## 알려진 제한

- SM-G998N은 SIM `ABSENT`라 Wi-Fi↔cellular transport 전환은 미검증/비차단이다.
- 실제 두 Android 기기의 anonymous peer 표시는 미검증/비차단이다.
- 기존 PERSONAL ACTIVE activity에 행사 context를 붙이는 실기기 무중복 경로는 미검증/비차단이다.
- OpenFreeMap public instance는 SLA가 없고 offline map은 제공하지 않는다.
- GPS 품질 filter로 제외된 segment는 경로에 공백으로 보일 수 있다.
- 200/300명은 mock simulation만 완료했으며 실제 remote 부하는 후속 검증한다.

## 공개 후 backlog

- cellular transport 및 두 기기 peer E2E.
- 실제 Supabase 200/300명 부하와 공유망 rate-limit tuning.
- production map provider/self-hosting, offline map, live-state retention/cleanup.
- 기존 personal activity attach 실기기 검증과 다양한 Android 제조사/브라우저 smoke.
- Phase 4 course, finish zone, LONG_STOP 및 결과 기능.

## 배포 경계

- remote에는 `0001`~`0004`와 anonymous peer migration만 적용됐다.
- `0005_phase3_operational_hardening.sql`, cron 및 수정 join Edge Functions는 날짜별 코드 예약과 서버 자동 종료를 위한 비차단 후속 hardening이며 v0.3.1 공개 핵심 흐름에는 필요하지 않다.
- 수정 `event-join`/`operator-join`은 `0005`의 `event_date`, `lookup_active`, `auto_close_at`을 전제로 한다. 단독 배포하지 말고 승인 후 `0005 → 수정 join Edge Functions → cron` 순서로 적용·검증한다.
- 이 준비 작업에서는 commit, push 및 remote Supabase 변경을 수행하지 않았다.
