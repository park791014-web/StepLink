# Phase 0/1 architecture

## 경계

```text
React UI
  └─ activity use-case / role-session model
       ├─ NativeGps Capacitor bridge
       │    └─ Android Foreground Service
       │         ├─ FusedLocationProviderClient
       │         └─ StepLink SQLite (canonical local record)
       ├─ MapProvider → MapLibre GL JS
       └─ Phase 2 EventGateway → Supabase (not connected yet)
```

React callback은 canonical GPS 저장 경로가 아니다. 서비스가 수신한 raw location은 먼저 `activity_points`에 저장되고, 활동 누계도 같은 transaction에서 갱신된다. UI는 마지막으로 본 `sequence` 이후 row만 5초마다 읽고, foreground 복귀 시 즉시 reconciliation한다.

## 도메인

- Role: `OWNER`, `OPERATOR`, `PARTICIPANT`
- Event: `DRAFT`, `OPEN`, `ACTIVE`, `ENDED`
- Activity: `READY`, `ACTIVE`, `PAUSED`, `COMPLETED`
- Participant status: `NORMAL`, `STALE_LOCATION`, `LONG_STOP`, `COURSE_DEVIATION`, `HELP_REQUEST`, `COMPLETED`, `OFFLINE`
- Course geometry는 `FREE`, `SIMPLE`, `DETAILED`와 JSON geometry로 분리해 이후 polygon finish zone을 수용한다.

세션 복원 순서는 개인 activity → participant event session → operator event session이다. Phase 1은 개인 activity의 native 복원을 구현했다. event session용 로컬 table과 공통 세션 discriminated union은 Phase 2 연결을 위해 준비되어 있다.

## 위치 데이터

모든 raw point에 timestamp, latitude, longitude, accuracy, speed, bearing, altitude, provider, mock 신호를 보존한다. `3.5m/s`는 `highSpeedCandidate` 분류 기준일 뿐 삭제 기준이 아니다. 분석용 거리에는 accuracy, jitter, teleport, 12m/s 이상 비현실적 도약을 별도 표시하고 원본 row는 유지한다.

프로파일은 NativeGpsTest와 같은 기본값을 따른다.

| Profile | Interval | Min interval | Distance | Accuracy |
| --- | ---: | ---: | ---: | --- |
| Accurate | 3s | 1.5s | 5m | high |
| Balanced | 5s | 2.5s | 10m | high |
| Battery Saver | 15s | 7.5s | 25m | balanced |

내부 수집 주기와 향후 서버 전송 주기(기본 30초)는 별개의 책임이다. 실패한 중요 서버 작업은 `sync_queue`에 idempotency key로 저장하고, live state는 `latest_wins_key` 기준 최신 상태만 보낼 수 있다.

## 화면 OFF와 process recreation

`StepLinkLocationService`는 exported가 아닌 location foreground service이며 `START_STICKY`를 사용한다. activity id/profile/service 상태를 app-private SharedPreferences에 보관해 OS가 service를 재생성할 때 null intent로 복원한다. WebView가 잠들어도 SQLite 저장은 계속된다. 사용자가 Android 설정에서 앱을 강제 종료한 경우는 OS 정책상 자동 복원을 보장하지 않는다.

## 지도

`MapProvider`가 style URL과 attribution을 공급한다. 기본값은 개발용 MapLibre demo style이며 production provider가 아니다. 네트워크가 없어 지도 타일이 보이지 않아도 native 기록·거리 계산·종료는 동작한다. 오프라인 지도 캐시는 후속 범위다.
