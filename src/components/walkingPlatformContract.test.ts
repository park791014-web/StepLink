import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('../../', import.meta.url)
const app = readFileSync(new URL('src/App.tsx', root), 'utf8')
const tracker = readFileSync(new URL('src/screens/TrackerScreen.tsx', root), 'utf8')
const routeMap = readFileSync(new URL('src/components/RouteMap.tsx', root), 'utf8')
const provider = readFileSync(new URL('src/infrastructure/map/mapProvider.ts', root), 'utf8')
const migration = readFileSync(new URL('supabase/migrations/20260905040250_phase3_anonymous_peer_locations.sql', root), 'utf8')
const mainActivity = readFileSync(new URL('android/app/src/main/java/kr/co/steplink/app/MainActivity.java', root), 'utf8')
const appUi = readFileSync(new URL('android/app/src/main/java/kr/co/steplink/app/AppUiPlugin.java', root), 'utf8')
const entry = readFileSync(new URL('src/screens/EventEntryScreen.tsx', root), 'utf8')
const operator = readFileSync(new URL('src/screens/EventOperatorScreen.tsx', root), 'utf8')
const personal = readFileSync(new URL('src/screens/PersonalSetupScreen.tsx', root), 'utf8')
const vercel = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8')) as { outputDirectory: string; rewrites: { source: string; destination: string }[] }

test('Vercel serves the Vite SPA and owner/operator deep links', () => {
  assert.equal(vercel.outputDirectory, 'dist')
  assert.deepEqual(vercel.rewrites, [{ source: '/(.*)', destination: '/index.html' }])
  assert.match(app, /path === '\/operator' \|\| path === '\/owner' \? 'operator' : 'home'/)
})

test('desktop operator participants use one scannable row per person', () => {
  const dashboard = readFileSync(new URL('src/screens/OperatorDashboard.tsx', root), 'utf8')
  const styles = readFileSync(new URL('src/styles.css', root), 'utf8')
  assert.match(dashboard, /participant-list-header[\s\S]*참가자[\s\S]*상태[\s\S]*거리[\s\S]*마지막 위치[\s\S]*정확도[\s\S]*조치/)
  assert.match(styles, /@media \(min-width: 1200px\)[\s\S]*grid-template-columns: 16px minmax\(72px, 1fr\) max-content 40px 58px 34px 48px/)
  assert.match(styles, /participant-row dl[\s\S]*display: contents/)
})

test('Android back unwinds the in-app stack and exits only from home', () => {
  assert.match(app, /navigationStack\.current\.push\(screenRef\.current\)/)
  assert.match(app, /const previous = navigationStack\.current\.pop\(\)/)
  assert.match(app, /screenRef\.current !== 'home'[\s\S]*else void exitNativeApp\(\)/)
  assert.match(mainActivity, /onBackPressed\(\)[\s\S]*steplink:back/)
})

test('entry screens use compact side-by-side heroes and a one-line end message', () => {
  assert.match(entry, /compact-page-hero[\s\S]*event-glyph/)
  assert.match(operator, /compact-page-hero[\s\S]*single-line-textarea[\s\S]*rows=\{1\}/)
  assert.match(personal, /personal-hero[\s\S]*FootIcon/)
})

test('operator UI omits event date and expected participant rows while retaining create data', () => {
  const session = readFileSync(new URL('src/screens/EventSessionScreen.tsx', root), 'utf8')
  assert.doesNotMatch(operator, />행사일 \*</)
  assert.doesNotMatch(operator, />예상 참가 인원 \*</)
  assert.match(operator, /eventDate: localDate\(\)/)
  assert.match(operator, /expectedParticipants: '100'/)
  assert.match(session, /\{participant && event\.status !== 'ACTIVE' && <section className="event-facts">/)
})

test('personal and ACTIVE participant walking use the same tracker screen', () => {
  assert.match(app, /unifiedParticipantWalk[\s\S]*navigate\('tracker'\)/)
  assert.match(app, /screen === 'tracker'[\s\S]*peerLocations=/)
  assert.match(tracker, /tracker-event-status-button/)
  assert.match(tracker, /tracker-event-overlay/)
  assert.match(tracker, /useState\(false\)[\s\S]*주변 참가자 확인/)
  assert.match(tracker, /peerLocations=\{showPeers \? peerLocations : \[\]\}/)
  assert.ok(tracker.indexOf('tracker-event-overlay') < tracker.indexOf('tracking-panel'))
  assert.doesNotMatch(tracker, /Native \{diagnostics|행사 화면 보기/)
})

test('walking map visual priority is small peers, red dot route, then directional self marker', () => {
  const peers = routeMap.indexOf("id: 'peer-locations'")
  const route = routeMap.indexOf("id: 'route'")
  const own = routeMap.indexOf("id: 'own-location'")
  assert.ok(peers >= 0 && peers < route && route < own)
  assert.match(routeMap, /'circle-color': '#3788e8'/)
  assert.match(routeMap, /'line-color': '#e45143'/)
  assert.match(routeMap, /'line-cap': 'round'/)
  assert.match(routeMap, /'line-width': 2\.5/)
  assert.match(routeMap, /'line-dasharray': \[0, 2\.4\]/)
  assert.match(routeMap, /'circle-radius': 3\.5/)
  assert.match(routeMap, /addImage\('own-navigation-pointer'/)
  assert.match(routeMap, /'icon-image': 'own-navigation-pointer'/)
  assert.match(routeMap, /lastReliableBearing/)
  assert.doesNotMatch(routeMap, /'text-field': '▲'/)
})

test('one icon cycles free, north-up and navigation while my-location preserves mode', () => {
  assert.match(routeMap, /type MapMode = 'FREE' \| 'NORTH_UP' \| 'NAVIGATION'/)
  assert.match(routeMap, /mode === 'FREE' \? 'NORTH_UP' : mode === 'NORTH_UP' \? 'NAVIGATION' : 'FREE'/)
  assert.match(routeMap, /pointerdown[\s\S]*pauseFollow/)
  assert.match(routeMap, /followRef\.current = false/)
  assert.match(routeMap, /setTimeout\(\(\) => \{ followRef\.current = true \}, 4000\)/)
  const pauseStart = routeMap.indexOf('const pauseFollow')
  const pauseHandler = routeMap.slice(pauseStart, routeMap.indexOf('const canvasContainer', pauseStart))
  assert.doesNotMatch(pauseHandler, /setMapMode|modeRef\.current =/)
  const centerStart = routeMap.indexOf('const centerOnCurrentLocation')
  const centerHandler = routeMap.slice(centerStart, routeMap.indexOf('\n  return (', centerStart))
  assert.match(centerHandler, /map\.easeTo\(\{ center:/)
  assert.doesNotMatch(centerHandler, /setMapMode|modeRef\.current =/)
  assert.match(routeMap, /point\.speed < 0\.8/)
  assert.match(routeMap, /point\.accuracy > 25/)
})

test('Android orientation is role-aware while tracker remains portrait-first', () => {
  const manifest = readFileSync(new URL('android/app/src/main/AndroidManifest.xml', root), 'utf8')
  const styles = readFileSync(new URL('src/styles.css', root), 'utf8')
  assert.doesNotMatch(manifest, /android:screenOrientation="portrait"/)
  assert.match(mainActivity, /window\.dispatchEvent\(new Event\('steplink:back'\)\)/)
  assert.match(appUi, /SCREEN_ORIENTATION_UNSPECIFIED/)
  assert.match(appUi, /SCREEN_ORIENTATION_PORTRAIT/)
  assert.match(app, /screen === 'operator'[\s\S]*setRoleOrientation\(flexible\)/)
  assert.match(styles, /\.tracker-screen \{ height: 100dvh; min-height: 100dvh; overflow: hidden;/)
  assert.match(styles, /grid-template-rows: minmax\(0, 1fr\) auto/)
  assert.match(styles, /\.tracker-content \.route-map \{ height: 100%; min-height: 0; \}/)
})

test('default map provider is OpenFreeMap and remains environment-overridable', () => {
  assert.match(provider, /https:\/\/tiles\.openfreemap\.org\/styles\/bright/)
  assert.match(provider, /VITE_MAP_STYLE_URL/)
  assert.match(provider, /OpenFreeMap © OpenMapTiles Data from OpenStreetMap/)
})

test('peer location RPC is ACTIVE-only, self-excluding and de-identified', () => {
  assert.match(migration, /security definer/)
  assert.match(migration, /event\.status = 'ACTIVE'/)
  assert.match(migration, /live\.participant_id <> caller\.id/)
  assert.match(migration, /round\(live\.latitude::numeric, 4\)/)
  assert.match(migration, /revoke all on function[\s\S]*from public, anon/)
  const output = migration.slice(migration.indexOf("jsonb_build_object("), migration.indexOf(") order by live.last_received_at"))
  assert.doesNotMatch(output, /display_name|participant_identifier|participant_id|user_id|distance_m/)
})
