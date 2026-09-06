# StepLink 0.3.1

StepLink는 개인 걷기·달리기 기록과 학교·단체 행사 운영을 결합한 Android 중심 GPS 활동 앱이다. 원칙은 **Rich on the phone, minimal on the server**다.

## 현재 구조

- 하나의 native tracking session이 개인·행사 활동을 모두 기록한다.
- `activities/activity_points`는 상세 GPS trail과 거리·시간의 local source of truth다.
- 행사 참여는 `event_activity_links`로 activity에 context를 붙인다.
- ACTIVE Participant에게 active activity가 없으면 `EVENT_AUTO` activity 한 건을 자동 생성하고, 있으면 그 activity에 연결한다.
- `event_live_snapshot`은 canonical activity에서 만든 current-only 전송 cache다.
- Supabase `participant_live_state`에는 위치, accuracy, 거리, 경과시간, 상태, sequence, 수신 시각 등 최신 운영 상태만 둔다. 상세 trail은 업로드하지 않는다.

행사 화면과 운동 정보 화면은 같은 activity의 다른 view다. 화면을 바꿔도 tracking/live sync는 계속된다. ENDED가 되면 event live와 context를 끝내고, 자동 생성한 행사 activity는 완료 상태로 local DB에 남긴다. 기존 personal activity에 context를 붙였던 경우에는 context만 끝내고 personal activity를 계속한다.

완료된 개인 및 `EVENT_AUTO` 활동은 홈/메뉴의 `활동 기록`에서 최신순으로 조회하며 날짜·활동 유형·거리·경과시간을 표시한다. 항목을 선택하면 저장된 point를 읽어 기존 요약 화면으로 다시 들어간다. 이 조회는 기존 SQLite row를 복제하거나 active activity를 만들지 않는다.

개인 걷기와 행사 걷기는 같은 추적 화면을 사용한다. 자기 current 위치는 빨간 점, local accepted 경로는 작은 빨간 도트다. ACTIVE 행사에서는 다른 참가자의 이름·학번·식별자를 노출하지 않는 익명 current 위치만 파란 점으로 표시한다. tracker 상단바의 `행사` 버튼은 지도 위 overlay로 행사 상태·공지·도움 요청을 열며 지도와 하단 기록 패널을 밀지 않는다. peer 좌표는 server에서 약 11m 정밀도로 낮추고 자기 자신과 5분보다 오래된 row를 제외한다. 상세 GPS trail은 계속 local-only다.

## Phase 3 상태

- 최신 Android 지도/행사 overlay 6개 항목은 모두 PASS다. 지도 배경·현재 위치·누적경로, 왼쪽 햄버거/중앙 상태/오른쪽 행사 버튼, overlay 고정 배치와 지도 조작 중 기록 지속을 확인했다.
- 누적경로 공백은 실제 필터 제외 segment에서 생긴다. GPS/filter 로직은 유지하고 후속 개선사항으로 남겼다. 최신 APK의 작은 빨간 도트 경로, 자유/정북/네비 순환 아이콘, 내 위치 아이콘과 전체 지도 UI는 SM-G998N 실기기 PASS다.
- 지도 모드와 follow 상태를 분리했다. 모든 모드는 기본적으로 현재 위치를 따라가며, 직접 조작하는 동안에는 모드를 바꾸지 않고 follow만 잠시 멈춘 뒤 재개한다. 내 위치 버튼은 zoom과 모드를 유지하며 즉시 follow를 복구한다.
- ACTIVE 참가자 지도는 `주변 참가자 확인`이 기본 OFF다. ON일 때만 기존 익명 peer RPC 결과를 작은 파란 점으로 표시하며 zoom·drag·rotate·pitch 및 지도 모드와 독립적으로 유지한다. 자기 위치는 신뢰 가능한 이동 bearing을 따르고 신호가 불안정하면 마지막 신뢰 방향을 유지하는 빨간 navigation pointer다.

- 같은 시간대 로컬 걷기 6.35km 증가는 native GPS 수집이 살아 있었음을 보여 준다. server `sequence=0`/null 원인은 Manifest의 `ACCESS_NETWORK_STATE` 누락으로 `ConnectivityManager.getActiveNetwork()`에서 HTTP 이전 `SecurityException`이 발생한 것이었다. 권한 추가 후 최신 APK 실기기 검증에서 행사 `12345`의 live RPC 반복 200, native `request_succeeded`/pending 0, remote 위·경도·수신 시각과 sequence 644 갱신을 확인해 native event live upload는 PASS다.
- 현재 source는 v0.3.1 / Build 5이며 one-activity 보정을 포함한다.
- remote에는 migration `0001`~`0004`와 `phase3_anonymous_peer_locations`가 적용됐다. 이것이 현재 v0.3.1 앱이 호출하는 live/message/help/peer 및 manual lifecycle RPC를 제공한다. `0005`, cron, 수정 join Edge Function은 날짜별 코드 예약과 서버 자동 종료를 위한 비차단 후속 hardening이다. 수정 join 함수는 `0005`의 새 컬럼을 전제로 하므로 단독 배포하지 않는다.
- 기본 live upload 30초, dashboard 7.5초 polling, participant feed 15초 polling, stale 90초, offline 5분이다.
- latest-wins LIVE와 idempotent HELP queue는 분리하며, permanent 4xx는 terminal, network/408/429/5xx는 backoff retry한다.
- API base는 hosted HTTPS Supabase URL이며 localhost/사설 IP를 사용하지 않는다. WebView Auth/REST/RPC/Edge와 native live POST는 credential/query value를 제외한 endpoint·status·transport 오류를 console/Logcat에 남긴다. 일시적 네트워크 실패는 저장된 행사 세션과 local GPS activity를 삭제하지 않고 연결 복구 뒤 재시도한다.
- 기본 MapLibre style은 OpenFreeMap Bright이고 attribution을 표시한다. `VITE_MAP_STYLE_URL`/`VITE_MAP_ATTRIBUTION`으로 provider를 교체할 수 있다. public instance는 API key 없이 사용할 수 있지만 SLA는 없으며 offline map은 미구현이다.
- 익명 peer RPC는 remote catalog·권한과 rollback-only 범위/필드 negative test를 통과했다. 실제 두 Android 기기의 파란 peer 점 E2E는 아직 미검증이다.

행사 코드는 참가 코드 `0123456789ABCDEFGHJKMNPQRSTUVWXYZ` 5문자, 운영 코드는 같은 prefix + `ABCDEFGHJKMNPQRSTUVWXYZ` suffix다. 입력은 trim/uppercase하고 DB에는 purpose별 HMAC-SHA-256 digest만 둔다.

## 실행과 검증

```powershell
npm install --ignore-scripts
npm test
npm run lint
npm run build
npm run cap:sync
cd android
.\gradlew.bat --no-daemon compileDebugJavaWithJavac
```

현재 source 결과는 test 63/63, lint, build, cap sync PASS다. 완료 활동 목록도 SM-G998N에서 행사 `12345` EVENT_AUTO 기록 1건, 27,492.64m, 완료 표시, 기존 SummaryScreen 재진입과 무중복을 확인해 PASS다. 기존 personal activity attach 무중복과 실제 두 기기 peer E2E, SIM이 없는 기기의 Wi-Fi↔cellular 전환은 `미검증 / 비차단`이며 공개 후 backlog다. 최신 지도 토글/pointer와 role별 orientation 및 Android Back 변경은 Codex 환경의 Gradle loopback 오류로 compile 진입 전 중단되어 Android Studio Build/Run 1회 확인이 공개 전 남은 gate다.

client `.env.local`에는 public `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`만 둔다. service-role key와 `STEPLINK_CODE_PEPPER`를 client/APK/source에 넣지 않는다.

## Owner/Operator 웹 배포

Vercel production build는 `npm run build`로 생성되는 `dist/`를 배포한다. `/operator`와 `/owner`는 행사 생성·운영 진입 화면으로 바로 연결되고, 저장된 유효한 Owner/Operator 세션이 있으면 기존 행사 운영 화면을 복원한다. `vercel.json`의 SPA fallback으로 해당 URL을 직접 열거나 새로고침해도 `index.html`이 제공된다.

Vercel Project Settings에는 `VITE_SUPABASE_URL`과 `VITE_SUPABASE_ANON_KEY`를 Production 환경변수로 등록한다. 두 값은 브라우저에 포함되는 public client 설정이므로 service-role key와 `STEPLINK_CODE_PEPPER`를 절대 등록하지 않는다. 지도 provider를 바꿀 때만 `VITE_MAP_STYLE_URL`, `VITE_MAP_ATTRIBUTION`을 선택적으로 설정한다. 자세한 절차는 [Vercel 배포 준비](docs/VERCEL_DEPLOYMENT.md)를 따른다.

## 문서

- [인수인계](HANDOFF.md)
- [Phase 3 아키텍처](docs/architecture/PHASE_3.md)
- [sync queue](docs/SYNC_QUEUE.md)
- [기기·E2E smoke](docs/DEVICE_SMOKE_TEST.md)
- [Supabase 역할 행렬](docs/SUPABASE_ROLE_MATRIX.md)
- [보안 검토](docs/SECURITY_REVIEW.md)
- [Build 5 릴리스 노트](docs/RELEASE_NOTES_0.3.1.md)
- [Phase 3 load simulation](docs/PHASE3_LOAD_TEST.md)
- [지도 provider](docs/MAP_PROVIDER.md)
- [Vercel 배포 준비](docs/VERCEL_DEPLOYMENT.md)
