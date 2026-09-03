# NativeGpsTest 이식 기록

검토 원본: `C:\Codex\NativeGpsTest` (직접 수정하지 않음)

재사용한 검증 구조:

- `WalkLocationService`의 foreground location service와 `START_STICKY`
- `FusedLocationProviderClient` 및 Balanced 5s / 2.5s / 10m / high accuracy 설정
- 수신 즉시 `SQLiteOpenHelper`에 저장하는 canonical path
- Capacitor plugin을 `MainActivity`에서 명시 등록하는 방식
- native row id를 sequence로 사용한 WebView reconciliation
- `BatteryManager`, battery optimization, native/UI point count 진단
- foreground/background lifecycle diagnostic event

StepLink에서 확장한 부분:

- session point table을 `activities` + `activity_points` 중심 전체 local schema로 확장
- native start/pause/resume/end 상태 전이와 pause boundary 처리
- raw segment와 분석용 filtered segment를 동시에 저장
- walking/running/high-speed 분류는 보존하되 raw point는 삭제하지 않음
- activity 누계 거리·moving/stopped time을 native transaction에서 갱신
- 향후 사진, segment, event session, durable sync queue, settings table 추가
- foreground notification 문구와 package/app version을 StepLink로 일치

Capgo background-geolocation은 포함하지 않았다.
