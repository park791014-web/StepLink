import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('../../../', import.meta.url)
const manager = readFileSync(new URL('android/app/src/main/java/kr/co/steplink/app/EventLiveSyncManager.java', root), 'utf8')
const service = readFileSync(new URL('android/app/src/main/java/kr/co/steplink/app/StepLinkLocationService.java', root), 'utf8')
const manifest = readFileSync(new URL('android/app/src/main/AndroidManifest.xml', root), 'utf8')
const crypto = readFileSync(new URL('android/app/src/main/java/kr/co/steplink/app/SecureEventSessionCrypto.java', root), 'utf8')
const plugin = readFileSync(new URL('android/app/src/main/java/kr/co/steplink/app/EventSyncQueuePlugin.java', root), 'utf8')
const database = readFileSync(new URL('android/app/src/main/java/kr/co/steplink/app/StepLinkDatabase.java', root), 'utf8')
const app = readFileSync(new URL('src/App.tsx', root), 'utf8')
const phase3Operations = readFileSync(new URL('src/domain/live/usePhase3Operations.ts', root), 'utf8')
const trackerScreen = readFileSync(new URL('src/screens/TrackerScreen.tsx', root), 'utf8')
const secureSessionPlugin = readFileSync(new URL('android/app/src/main/java/kr/co/steplink/app/SecureEventSessionPlugin.java', root), 'utf8')
const eventSessionHook = readFileSync(new URL('src/domain/event/useEventSession.ts', root), 'utf8')

test('Android canonical activity FGS hosts the separate 30-second live uploader', () => {
  assert.match(manager, /DEFAULT_INTERVAL_MS = 30_000/)
  assert.match(manager, /scheduleAtFixedRate/)
  assert.match(service, /new EventLiveSyncManager\(this, db, /)
  assert.match(service, /liveSyncManager\.start\(activityId\)/)
  assert.match(plugin, /requestEventSyncRefresh\(getContext\(\), true\)/)
  assert.match(service, /EventLiveSyncManager\.isEnabled\(this\)/)
})

test('ACTIVE event with no existing activity creates one event-linked canonical activity', () => {
  assert.match(database, /ensureEventActivity/)
  assert.match(database, /startActivity\(activityId, type, profile, "EVENT_AUTO"\)/)
  assert.match(database, /CREATE TABLE IF NOT EXISTS event_activity_links/)
  assert.match(database, /PRIMARY KEY\(event_id,participant_id\)/)
  assert.match(app, /ensureEventActivity: tracker\.ensureEventActivity/)
  assert.ok(phase3Operations.indexOf('await ensureEventActivity(currentSession)') < phase3Operations.indexOf('await eventSyncQueue.configureLiveSync({'))
  assert.match(plugin, /activeEventActivityId\(eventId, participantId\) == null/)
})

test('compatible active personal activity attaches context without a duplicate activity', () => {
  assert.match(database, /JSONObject current = activeActivity\(\)/)
  assert.match(database, /else activityId = current\.getString\("id"\)/)
  assert.match(database, /CREATE UNIQUE INDEX IF NOT EXISTS event_activity_one_active_context/)
})

test('event-linked tracking writes canonical activity points', () => {
  assert.match(service, /db\.insertLocation\(activityId, location\)/)
  assert.match(database, /CREATE TABLE activity_points/)
  assert.doesNotMatch(service, /insertEventLocation|eventActivityPoints/)
})

test('event live snapshot is a current-only projection of canonical activity state', () => {
  assert.match(database, /CREATE TABLE IF NOT EXISTS event_live_snapshot/)
  assert.match(database, /activity_id TEXT/)
  assert.match(database, /distance_m REAL NOT NULL DEFAULT 0,elapsed_time_ms INTEGER NOT NULL DEFAULT 0/)
  assert.match(database, /latestLiveSnapshot\(activityId\)/)
  assert.match(manager, /recordEventLiveProjection/)
  assert.match(manager, /eventLiveSnapshot\(eventId, participantId\)/)
  assert.match(service, /liveSyncManager\.onLocation\(location\)/)
  assert.doesNotMatch(database, /CREATE TABLE event_live_points/)
})

test('ACTIVE participant event uses the canonical walking screen without changing tracking', () => {
  assert.match(app, /unifiedParticipantWalk[\s\S]*navigate\('tracker'\)/)
  assert.match(app, /peerLocations=\{activeParticipantEvent \? phase3\.peerLocations : undefined\}/)
  assert.match(trackerScreen, /tracker-event-status-button/)
  assert.match(trackerScreen, /tracker-event-overlay/)
  assert.doesNotMatch(trackerScreen, /행사 화면 보기|showEvent/)
})

test('restore keeps the same active activity and event context', () => {
  assert.match(database, /appendEventContext\(value\)/)
  assert.match(database, /if \(link\.moveToFirst\(\) && !"COMPLETED"\.equals\(statusOf\(link\.getString\(0\)\)\)\)/)
  assert.match(database, /activityId = link\.getString\(0\)/)
})

test('event end detaches context and preserves an event-created activity as completed history', () => {
  assert.match(database, /endEventActivityContext/)
  assert.match(database, /createdForEvent && !"COMPLETED"\.equals/)
  assert.match(database, /endedActivity \? endActivity\(activityId\) : activity\(activityId\)/)
  assert.match(secureSessionPlugin, /endParticipantContext/)
})

test('native live sync only flushes latest live-state queue items', () => {
  assert.match(manager, /readyLiveSyncItems/)
  assert.match(manager, /live:" \+ eventId \+ ":" \+ participantId/)
  assert.match(manager, /target_client_sequence/)
  assert.doesNotMatch(manager, /readySyncItems\(/)
})

test('native transport failures retain the queue and expose safe diagnostics', () => {
  assert.match(manager, /live_sync_transport_retry/)
  assert.match(manager, /db\.retrySyncItem\(id, System\.currentTimeMillis\(\) \+ retryDelayMs\(attempts\)\)/)
  assert.match(manager, /LAST_HTTP_STATUS/)
  assert.match(manager, /FAILED_ENDPOINT/)
  assert.match(manager, /StepLinkNetwork/)
  assert.match(manager, /LAST_STAGE/)
  assert.match(manager, /live sync failure at/)
  assert.match(manifest, /android\.permission\.ACCESS_NETWORK_STATE/)
})

test('transient session restore failure is retried before destructive cleanup', () => {
  assert.match(eventSessionHook, /if \(isTransientNetworkFailure\(caught\)\)[\s\S]*?return[\s\S]*?await clearSecureEventSession\(\)/)
  assert.match(eventSessionHook, /window\.addEventListener\('online', retryAfterNetworkChange\)/)
  assert.match(eventSessionHook, /Math\.min\(retryDelayMs \* 2, 60_000\)/)
})

test('ENDED and terminal scope failures disable native live sync', () => {
  assert.match(manager, /"ENDED"\.equals[\s\S]*disable\(context, db\)/)
  assert.match(manager, /isTerminalLiveFailure/)
  assert.match(plugin, /disableLiveSync/)
  assert.match(secureSessionPlugin, /clear\(PluginCall call\)[\s\S]*EventLiveSyncManager\.disable\(getContext\(\), db\)/)
})

test('native credentials remain in the existing Android Keystore envelope', () => {
  assert.match(crypto, /AndroidKeyStore/)
  assert.match(crypto, /AES\/GCM\/NoPadding/)
  assert.match(manager, /SecureEventSessionCrypto\.decrypt/)
  assert.doesNotMatch(manager, /putString\([^\n]*(accessToken|refreshToken|eventSessionToken)/)
  assert.doesNotMatch(service, /supabase|Authorization|Bearer/i)
})

test('GPS sampling profile values remain independent from live sync cadence', () => {
  assert.match(service, /interval = 5_000, minimum = 2_500, delay = 5_000/)
  assert.match(service, /"accurate"\.equals\(profile\).*interval = 3_000/)
  assert.match(service, /"battery"\.equals\(profile\).*interval = 15_000/)
})
