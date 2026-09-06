# Map provider policy

`src/infrastructure/map/mapProvider.ts`가 style URL/attribution/production 여부를 공급한다. 기본값은 `https://tiles.openfreemap.org/styles/bright`인 OpenFreeMap Bright이며 `VITE_MAP_STYLE_URL`과 `VITE_MAP_ATTRIBUTION`으로 교체할 수 있다. style 자체 attribution control을 사용해 OpenFreeMap/OpenMapTiles/OpenStreetMap 표시를 중복 없이 유지한다.

개인·행사 걷기는 같은 `RouteMap`을 사용한다. 자기 최신 local 위치는 가장 위의 빨간 점, `acceptedForMetrics`인 local segment만 노란 선, ACTIVE 행사 peer current 위치는 아래쪽 파란 점으로 그린다. peer 데이터는 상세 trail이 아니며 이름·학번·participant id가 없는 좌표 배열이다. 지도 source는 한 번 만들고 `setData`로 갱신해 polling마다 map을 재생성하지 않는다. Operator dashboard는 별도의 GeoJSON clustering을 유지해 200~300 individual DOM marker를 만들지 않는다.

MapLibre는 lazy chunk이며 Vite optimizeDeps에서 제외해 과거 `maplibre-gl-worker.mjs` dev prebundle warning 경로를 피한다. load/WebGL/style/network/CORS 실패는 raw `TypeError: Failed to fetch` 대신 사용자용 한국어 안내로 표시하고 상세 origin은 개발 로그에만 남긴다. 지도 네트워크 실패와 무관하게 native GPS, SQLite 저장, local 거리·시간·경로 계산은 계속된다.

OpenFreeMap 공식 안내상 public instance는 API key·등록·명시된 request/view 한도 없이 상업적으로 사용할 수 있고 attribution이 필요하다. 그러나 서비스는 as-is이며 SLA/지원 보장이 없고 중단될 수 있다. 규모가 커지거나 운영 보증이 필요해지면 sponsored/향후 Pro, self-hosting 또는 별도 상용 provider를 선택해야 한다. OSMF public tile server를 직접 production backend로 사용하지 않으며 부산 전체 지도팩 강제 포함과 자동 offline download도 하지 않는다.

검토 근거: [OpenFreeMap](https://openfreemap.org/), [Quick Start](https://openfreemap.org/quick_start/), [Terms of Service](https://openfreemap.org/tos/), [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/).

2026-09-05 local desktop 1280×720과 mobile 360×800 browser에서 OpenFreeMap 배경, 단일 attribution, 반응형 배치를 확인했다. style 안의 미국 road-shield filter 3개에서 `null` 관련 non-fatal MapLibre warning이 있었지만 배경 렌더링은 성공했다. Android WebView 실기기 배경·WebGL·현재 위치·local 경로·peer 표시는 아직 재검증 전이다.
