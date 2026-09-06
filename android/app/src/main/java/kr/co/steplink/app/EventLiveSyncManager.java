package kr.co.steplink.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.location.Location;
import android.util.Base64;
import android.util.Log;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

final class EventLiveSyncManager {
    static final long DEFAULT_INTERVAL_MS = 30_000;
    private static final String PREFS = "steplink_live_sync_config";
    private static final String ENABLED = "enabled";
    private static final String SUPABASE_URL = "supabaseUrl";
    private static final String ANON_KEY = "anonKey";
    private static final String EVENT_ID = "eventId";
    private static final String PARTICIPANT_ID = "participantId";
    private static final String LIVE_KEY = "liveKey";
    private static final String INTERVAL_MS = "intervalMs";
    private static final String LAST_SEQUENCE = "lastSequence";
    private static final String LAST_SEQUENCE_KEY = "lastSequenceKey";
    private static final String MANAGER_STARTED_AT = "managerStartedAt";
    private static final String LAST_LOCATION_AT = "lastLocationAt";
    private static final String LAST_SUCCESS_AT = "lastSuccessAt";
    private static final String LAST_RECEIVE_SUCCESS_AT = "lastReceiveSuccessAt";
    private static final String LAST_HTTP_STATUS = "lastHttpStatus";
    private static final String LAST_ERROR = "lastError";
    private static final String LAST_STAGE = "lastStage";
    private static final String LAST_ENDPOINT = "lastEndpoint";
    private static final String FAILED_ENDPOINT = "failedEndpoint";
    private static final String TAG = "StepLinkNetwork";
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 15_000;

    private final Context context;
    private final StepLinkDatabase db;
    private final Runnable disabledCallback;
    private ScheduledExecutorService executor;
    private String activityId;
    private boolean started;

    EventLiveSyncManager(Context context, StepLinkDatabase db) {
        this(context, db, () -> { });
    }

    EventLiveSyncManager(Context context, StepLinkDatabase db, Runnable disabledCallback) {
        this.context = context.getApplicationContext();
        this.db = db;
        this.disabledCallback = disabledCallback;
    }

    static void configure(Context context, String supabaseUrl, String anonKey, String eventId, String participantId, long requestedIntervalMs) throws Exception {
        URL parsed = new URL(supabaseUrl);
        boolean localDebug = BuildConfig.DEBUG && ("localhost".equals(parsed.getHost()) || "127.0.0.1".equals(parsed.getHost()));
        if (!("https".equals(parsed.getProtocol()) || localDebug) || !(parsed.getPath().isEmpty() || "/".equals(parsed.getPath()))) {
            throw new IllegalArgumentException("Supabase base URL is not allowed");
        }
        long minimum = BuildConfig.DEBUG ? 1_000 : 15_000;
        long interval = Math.max(minimum, Math.min(requestedIntervalMs, 5 * 60_000));
        String liveKey = "live:" + eventId + ":" + participantId;
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = preferences.edit()
            .putString(SUPABASE_URL, parsed.getProtocol() + "://" + parsed.getAuthority())
            .putString(ANON_KEY, anonKey)
            .putString(EVENT_ID, eventId)
            .putString(PARTICIPANT_ID, participantId)
            .putString(LIVE_KEY, liveKey)
            .putLong(INTERVAL_MS, interval)
            .putBoolean(ENABLED, true);
        if (!liveKey.equals(preferences.getString(LAST_SEQUENCE_KEY, null))) {
            editor.remove(LAST_SEQUENCE).putString(LAST_SEQUENCE_KEY, liveKey)
                .remove(LAST_SUCCESS_AT).remove(LAST_RECEIVE_SUCCESS_AT).remove(LAST_HTTP_STATUS)
                .remove(LAST_ERROR).remove(LAST_ENDPOINT).remove(FAILED_ENDPOINT);
        }
        editor.apply();
        StepLinkDatabase db = new StepLinkDatabase(context);
        db.scopeOperationalQueue(eventId, participantId, "session_scope_changed");
        db.event(null, "live_sync_configured", liveKey);
    }

    static void disable(Context context, StepLinkDatabase db) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String liveKey = preferences.getString(LIVE_KEY, null);
        String eventId = preferences.getString(EVENT_ID, null);
        String participantId = preferences.getString(PARTICIPANT_ID, null);
        preferences.edit().putBoolean(ENABLED, false).remove(LAST_SEQUENCE).remove(LAST_SEQUENCE_KEY).remove(MANAGER_STARTED_AT).apply();
        if (liveKey != null) db.discardLatestSync(liveKey);
        if (eventId != null && participantId != null) db.clearEventLiveSnapshot(eventId, participantId);
        db.event(null, "live_sync_disabled", liveKey);
    }

    static boolean isEnabled(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ENABLED, false);
    }

    static JSONObject diagnostics(Context context, StepLinkDatabase db) throws Exception {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject result = new JSONObject();
        String eventId = preferences.getString(EVENT_ID, "");
        String participantId = preferences.getString(PARTICIPANT_ID, "");
        result.put("enabled", preferences.getBoolean(ENABLED, false));
        result.put("managerStartedAt", nullablePreference(preferences, MANAGER_STARTED_AT));
        result.put("lastLocationAt", nullablePreference(preferences, LAST_LOCATION_AT));
        result.put("lastSuccessAt", nullablePreference(preferences, LAST_SUCCESS_AT));
        result.put("lastSendSuccessAt", nullablePreference(preferences, LAST_SUCCESS_AT));
        result.put("lastReceiveSuccessAt", nullablePreference(preferences, LAST_RECEIVE_SUCCESS_AT));
        result.put("lastHttpStatus", preferences.contains(LAST_HTTP_STATUS) ? preferences.getInt(LAST_HTTP_STATUS, 0) : JSONObject.NULL);
        result.put("lastError", nullableStringPreference(preferences, LAST_ERROR));
        result.put("lastStage", nullableStringPreference(preferences, LAST_STAGE));
        result.put("lastEndpoint", nullableStringPreference(preferences, LAST_ENDPOINT));
        result.put("failedEndpoint", nullableStringPreference(preferences, FAILED_ENDPOINT));
        result.put("apiBaseUrl", preferences.getString(SUPABASE_URL, ""));
        result.put("lastClientSequence", preferences.getLong(LAST_SEQUENCE, 0));
        result.put("pendingLiveCount", db.pendingSyncCount("LIVE_STATE"));
        result.put("pendingHelpCount", db.pendingSyncCount("HELP_REQUEST"));
        JSONObject snapshot = eventId.isEmpty() || participantId.isEmpty() ? null : db.eventLiveSnapshot(eventId, participantId);
        if (snapshot != null) {
            result.put("latitude", snapshot.getDouble("latitude")); result.put("longitude", snapshot.getDouble("longitude"));
            result.put("accuracyM", snapshot.opt("accuracyM"));
            result.put("distanceM", snapshot.getDouble("distanceM")); result.put("elapsedTimeMs", snapshot.getLong("elapsedTimeMs"));
        }
        return result;
    }

    private static Object nullablePreference(SharedPreferences preferences, String key) {
        return preferences.contains(key) ? preferences.getLong(key, 0) : JSONObject.NULL;
    }

    private static Object nullableStringPreference(SharedPreferences preferences, String key) {
        return preferences.contains(key) ? preferences.getString(key, "") : JSONObject.NULL;
    }

    synchronized void start(String targetActivityId) {
        if (targetActivityId == null || targetActivityId.isEmpty()) {
            stop(); db.event(null, "live_sync_manager_missing_activity", "event context requires canonical activity"); return;
        }
        if (started && ((targetActivityId == null && activityId == null) || (targetActivityId != null && targetActivityId.equals(activityId))) && executor != null && !executor.isShutdown()) return;
        stop();
        activityId = targetActivityId;
        started = true;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(MANAGER_STARTED_AT, System.currentTimeMillis()).apply();
        db.event(activityId, "live_sync_manager_started", "canonical_activity");
        long interval = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(INTERVAL_MS, DEFAULT_INTERVAL_MS);
        executor = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "StepLinkEventLiveSync");
            thread.setPriority(Thread.MIN_PRIORITY);
            return thread;
        });
        executor.scheduleAtFixedRate(this::safeTick, 0, Math.max(1_000, interval), TimeUnit.MILLISECONDS);
    }

    synchronized void stop() {
        if (executor != null) executor.shutdownNow();
        executor = null;
        activityId = null;
        started = false;
    }

    void onLocation(Location location) {
        try {
            SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!preferences.getBoolean(ENABLED, false)) return;
            JSONObject stored = db.latestEventSession();
            if (stored == null || !"PARTICIPANT".equals(stored.optString("role")) || !"ACTIVE".equals(stored.optString("status"))) return;
            String eventId = stored.optString("eventId", "");
            String participantId = stored.optString("subjectId", "");
            if (!eventId.equals(preferences.getString(EVENT_ID, "")) || !participantId.equals(preferences.getString(PARTICIPANT_ID, ""))) return;
            if (activityId == null) return;
            long sequence = db.recordEventLiveProjection(eventId, participantId, activityId);
            preferences.edit().putLong(LAST_LOCATION_AT, System.currentTimeMillis()).apply();
            db.event(activityId, "live_sync_location_received", Long.toString(sequence));
        } catch (Exception error) {
            db.event(activityId, "live_sync_location_error", error.getClass().getSimpleName());
        }
    }

    private void safeTick() {
        try { tick(); }
        catch (Exception error) {
            SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String stage = preferences.getString(LAST_STAGE, "unknown");
            String detail = stage + ":" + error.getClass().getSimpleName();
            preferences.edit().putString(LAST_ERROR, detail).apply();
            db.event(activityId, "live_sync_error", detail);
            Log.e(TAG, "live sync failure at " + stage, error);
        }
    }

    private void tick() throws Exception {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        preferences.edit().putString(LAST_STAGE, "tick_started").apply();
        if (!preferences.getBoolean(ENABLED, false)) return;
        JSONObject stored = db.latestEventSession();
        if (stored == null || !"PARTICIPANT".equals(stored.optString("role"))) return;
        String eventId = stored.optString("eventId", "");
        String participantId = stored.optString("subjectId", "");
        if (!eventId.equals(preferences.getString(EVENT_ID, "")) || !participantId.equals(preferences.getString(PARTICIPANT_ID, ""))) return;
        if (!"ACTIVE".equals(stored.optString("status"))) {
            if ("ENDED".equals(stored.optString("status"))) { disable(context, db); disabledCallback.run(); }
            return;
        }

        String liveKey = "live:" + eventId + ":" + participantId;
        if (activityId == null) return;
        db.recordEventLiveProjection(eventId, participantId, activityId);
        JSONObject snapshot = db.eventLiveSnapshot(eventId, participantId);
        if (snapshot != null) {
            long sequence = snapshot.getLong("clientSequence");
            long previous = liveKey.equals(preferences.getString(LAST_SEQUENCE_KEY, null)) ? preferences.getLong(LAST_SEQUENCE, 0) : 0;
            if (sequence > previous) {
                preferences.edit().putString(LAST_STAGE, "queue_write").apply();
                snapshot.put("eventId", eventId); snapshot.put("participantId", participantId);
                db.enqueueLatestSync("LIVE_STATE", liveKey + ":" + sequence, liveKey, snapshot.toString());
                preferences.edit().putString(LAST_SEQUENCE_KEY, liveKey).putLong(LAST_SEQUENCE, sequence).apply();
            }
        }
        if (networkAvailable()) {
            preferences.edit().putString(LAST_STAGE, "queue_read").apply();
            flushLiveItems(stored, preferences);
        } else {
            String endpoint = diagnosticEndpoint(preferences.getString(SUPABASE_URL, "") + "/rest/v1/rpc/upsert_participant_live_state_v1");
            preferences.edit().remove(LAST_HTTP_STATUS).putString(LAST_ERROR, "NETWORK_UNAVAILABLE").putString(FAILED_ENDPOINT, endpoint).apply();
            Log.d(TAG, "network unavailable " + endpoint);
        }
    }

    private void flushLiveItems(JSONObject stored, SharedPreferences preferences) throws Exception {
        JSONArray items = db.readyLiveSyncItems(3);
        preferences.edit().putString(LAST_STAGE, items.length() == 0 ? "queue_empty" : "queue_ready").apply();
        for (int index = 0; index < items.length(); index++) {
            JSONObject item = items.getJSONObject(index);
            long id = item.getLong("id");
            JSONObject payload = item.getJSONObject("payload");
            if (!stored.optString("eventId").equals(payload.optString("eventId")) || !stored.optString("subjectId").equals(payload.optString("participantId"))) {
                db.completeSyncItem(id);
                continue;
            }
            preferences.edit().putString(LAST_STAGE, "credentials_decrypt").apply();
            JSONObject secrets = decryptSecrets(stored);
            String accessToken = secrets.optString("accessToken", "");
            String baseUrl = preferences.getString(SUPABASE_URL, "");
            String anonKey = preferences.getString(ANON_KEY, "");
            if (accessToken.isEmpty() || anonKey.isEmpty() || !issuerMatches(accessToken, baseUrl)) {
                block("credential_scope"); return;
            }
            preferences.edit().putString(LAST_STAGE, "credentials_valid").apply();
            HttpResult response;
            try {
                preferences.edit().putString(LAST_STAGE, "request_start").apply();
                response = postRpc(baseUrl, anonKey, accessToken, payload);
            } catch (Exception error) {
                int attempts = item.optInt("attemptCount", 0);
                db.retrySyncItem(id, System.currentTimeMillis() + retryDelayMs(attempts));
                db.event(activityId, "live_sync_transport_retry", error.getClass().getSimpleName());
                continue;
            }
            if (response.status == 401) {
                JSONObject reloaded = db.latestEventSession();
                JSONObject reloadedSecrets = decryptSecrets(reloaded);
                String reloadedAccessToken = reloadedSecrets.optString("accessToken", "");
                if (!reloadedAccessToken.equals(accessToken) && issuerMatches(reloadedAccessToken, baseUrl)) {
                    response = postRpc(baseUrl, anonKey, reloadedAccessToken, payload);
                } else {
                    String refreshedAccessToken = refreshSession(baseUrl, anonKey, reloaded, reloadedSecrets);
                    if (refreshedAccessToken != null) response = postRpc(baseUrl, anonKey, refreshedAccessToken, payload);
                }
            }
            if (response.success()) {
                db.completeSyncItem(id);
                preferences.edit().putLong(LAST_SUCCESS_AT, System.currentTimeMillis()).putString(LAST_STAGE, "request_succeeded").apply();
                db.event(activityId, "live_sync_sent", Long.toString(payload.optLong("clientSequence")));
            } else if (response.isTerminalLiveFailure()) {
                db.completeSyncItem(id); block("session_or_event_invalid"); return;
            } else {
                int attempts = item.optInt("attemptCount", 0);
                db.retrySyncItem(id, System.currentTimeMillis() + retryDelayMs(attempts));
            }
        }
    }

    private String refreshSession(String baseUrl, String anonKey, JSONObject stored, JSONObject secrets) throws Exception {
        String refreshToken = secrets.optString("refreshToken", "");
        if (refreshToken.isEmpty()) return null;
        JSONObject body = new JSONObject().put("refresh_token", refreshToken);
        HttpResult result = postJson(baseUrl + "/auth/v1/token?grant_type=refresh_token", anonKey, null, body);
        if (!result.success()) return null;
        JSONObject refreshed = new JSONObject(result.body);
        String accessToken = refreshed.optString("access_token", "");
        String nextRefreshToken = refreshed.optString("refresh_token", "");
        if (accessToken.isEmpty() || nextRefreshToken.isEmpty() || !issuerMatches(accessToken, baseUrl)) return null;
        secrets.put("accessToken", accessToken); secrets.put("refreshToken", nextRefreshToken);
        long expiresIn = refreshed.optLong("expires_in", 0);
        if (expiresIn > 0) secrets.put("expiresAt", System.currentTimeMillis() / 1000 + expiresIn);
        db.updateEventSessionCiphertext(stored.getString("eventId"), SecureEventSessionCrypto.encrypt(secrets.toString()));
        db.event(activityId, "live_sync_auth_refreshed", null);
        return accessToken;
    }

    private HttpResult postRpc(String baseUrl, String anonKey, String accessToken, JSONObject payload) throws Exception {
        JSONObject body = new JSONObject()
            .put("target_event", payload.getString("eventId"))
            .put("target_participant", payload.getString("participantId"))
            .put("target_latitude", payload.getDouble("latitude"))
            .put("target_longitude", payload.getDouble("longitude"))
            .put("target_accuracy_m", payload.isNull("accuracyM") ? JSONObject.NULL : payload.getDouble("accuracyM"))
            .put("target_distance_m", payload.optDouble("distanceM", 0))
            .put("target_elapsed_time_ms", payload.optLong("elapsedTimeMs", 0))
            .put("target_client_sequence", payload.getLong("clientSequence"));
        return postJson(baseUrl + "/rest/v1/rpc/upsert_participant_live_state_v1", anonKey, accessToken, body);
    }

    private HttpResult postJson(String endpoint, String anonKey, String accessToken, JSONObject body) throws Exception {
        String safeEndpoint = diagnosticEndpoint(endpoint);
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        preferences.edit().putString(LAST_ENDPOINT, safeEndpoint).apply();
        Log.d(TAG, "POST " + safeEndpoint);
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setRequestMethod("POST"); connection.setConnectTimeout(CONNECT_TIMEOUT_MS); connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json"); connection.setRequestProperty("apikey", anonKey);
            if (accessToken != null) connection.setRequestProperty("Authorization", "Bearer " + accessToken);
            byte[] encoded = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(encoded.length);
            try (OutputStream output = connection.getOutputStream()) { output.write(encoded); }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String responseBody = readLimited(stream);
            SharedPreferences.Editor result = preferences.edit().putInt(LAST_HTTP_STATUS, status);
            if (status >= 200 && status < 300) {
                result.putLong(LAST_RECEIVE_SUCCESS_AT, System.currentTimeMillis()).remove(LAST_ERROR).remove(FAILED_ENDPOINT);
                Log.d(TAG, "response " + status + " " + safeEndpoint);
            } else {
                result.putString(LAST_ERROR, "HTTP " + status).putString(FAILED_ENDPOINT, safeEndpoint);
                Log.w(TAG, "HTTP " + status + " " + safeEndpoint);
            }
            result.apply();
            return new HttpResult(status, responseBody);
        } catch (Exception error) {
            String detail = error.getClass().getSimpleName() + (error.getMessage() == null ? "" : ": " + error.getMessage());
            preferences.edit().remove(LAST_HTTP_STATUS).putString(LAST_ERROR, detail).putString(FAILED_ENDPOINT, safeEndpoint).apply();
            Log.w(TAG, "transport failure " + safeEndpoint + " " + detail);
            throw error;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String diagnosticEndpoint(String endpoint) {
        try {
            URL url = new URL(endpoint);
            return url.getProtocol() + "://" + url.getAuthority() + url.getPath();
        } catch (Exception ignored) { return endpoint.split("\\?")[0]; }
    }

    private JSONObject decryptSecrets(JSONObject stored) throws Exception {
        if (stored == null) throw new IllegalStateException("Missing event session");
        String ciphertext = stored.optString("ciphertext", "");
        if (ciphertext.isEmpty()) throw new IllegalStateException("Missing encrypted credentials");
        return new JSONObject(SecureEventSessionCrypto.decrypt(ciphertext));
    }

    private boolean networkAvailable() {
        ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        Network network = manager == null ? null : manager.getActiveNetwork();
        NetworkCapabilities capabilities = network == null || manager == null ? null : manager.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void block(String reason) {
        disable(context, db);
        db.event(activityId, "live_sync_blocked", reason);
        disabledCallback.run();
    }

    private static boolean issuerMatches(String accessToken, String baseUrl) {
        try {
            String[] parts = accessToken.split("\\.");
            if (parts.length < 2) return false;
            JSONObject claims = new JSONObject(new String(Base64.decode(parts[1], Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING), StandardCharsets.UTF_8));
            URL issuer = new URL(claims.getString("iss")); URL target = new URL(baseUrl);
            return issuer.getProtocol().equals(target.getProtocol()) && issuer.getHost().equals(target.getHost()) && effectivePort(issuer) == effectivePort(target);
        } catch (Exception ignored) { return false; }
    }

    private static int effectivePort(URL url) { return url.getPort() >= 0 ? url.getPort() : url.getDefaultPort(); }
    private static long retryDelayMs(int attempt) { return Math.min(5 * 60_000L, 2_000L << Math.max(0, Math.min(attempt, 7))); }

    private static String readLimited(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder value = new StringBuilder(); char[] buffer = new char[1024]; int read;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            while ((read = reader.read(buffer)) >= 0 && value.length() < 32_768) value.append(buffer, 0, Math.min(read, 32_768 - value.length()));
        }
        return value.toString();
    }

    private record HttpResult(int status, String body) {
        boolean success() { return status >= 200 && status < 300; }
        boolean isTerminalLiveFailure() {
            return (status >= 400 && status < 500 && status != 408 && status != 429)
                || body.contains("EVENT_NOT_ACTIVE") || body.contains("PARTICIPANT_SCOPE_DENIED") || body.contains("AUTH_REQUIRED")
                || body.contains("INVALID_LOCATION") || body.contains("INVALID_LIVE_STATE") || body.contains("INVALID_ACCURACY");
        }
    }
}
