package kr.co.steplink.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.location.Location;
import android.os.Build;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

final class StepLinkDatabase extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "steplink.db";
    private static final int DATABASE_VERSION = 5;

    StepLinkDatabase(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
        setWriteAheadLoggingEnabled(true);
    }

    @Override public void onConfigure(SQLiteDatabase db) {
        super.onConfigure(db);
        db.setForeignKeyConstraintsEnabled(true);
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE activities (" +
            "id TEXT PRIMARY KEY,event_id TEXT,activity_source TEXT NOT NULL DEFAULT 'PERSONAL',activity_type TEXT NOT NULL,status TEXT NOT NULL," +
            "profile TEXT NOT NULL,started_at INTEGER NOT NULL,resumed_at INTEGER NOT NULL,paused_at INTEGER,ended_at INTEGER," +
            "pause_duration_ms INTEGER NOT NULL DEFAULT 0,raw_distance_m REAL NOT NULL DEFAULT 0," +
            "filtered_distance_m REAL NOT NULL DEFAULT 0,moving_time_ms INTEGER NOT NULL DEFAULT 0," +
            "stopped_time_ms INTEGER NOT NULL DEFAULT 0,point_count INTEGER NOT NULL DEFAULT 0," +
            "created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE activity_points (" +
            "sequence INTEGER PRIMARY KEY AUTOINCREMENT,activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE," +
            "timestamp INTEGER NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL,accuracy REAL,speed REAL,bearing REAL," +
            "altitude REAL,provider TEXT,mock INTEGER NOT NULL DEFAULT 0,stored_at INTEGER NOT NULL," +
            "raw_segment_distance_m REAL NOT NULL DEFAULT 0,filtered_segment_distance_m REAL NOT NULL DEFAULT 0," +
            "classification TEXT NOT NULL,accepted_for_metrics INTEGER NOT NULL DEFAULT 0,filter_reason TEXT)");
        db.execSQL("CREATE INDEX activity_points_activity_sequence ON activity_points(activity_id,sequence)");
        db.execSQL("CREATE INDEX activity_points_activity_timestamp ON activity_points(activity_id,timestamp)");
        createEventActivityLinksTable(db);
        db.execSQL("CREATE TABLE photos (id TEXT PRIMARY KEY,activity_id TEXT REFERENCES activities(id),event_id TEXT," +
            "local_uri TEXT NOT NULL,image_hash TEXT,verification_id TEXT,captured_at INTEGER NOT NULL,created_at INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE photo_metadata (photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE," +
            "latitude REAL,longitude REAL,accuracy REAL,activity_distance_m REAL,activity_elapsed_ms INTEGER," +
            "event_name TEXT,participant_local_id TEXT,stamp_asset_id TEXT)");
        db.execSQL("CREATE TABLE segments (id TEXT PRIMARY KEY,activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE," +
            "segment_index INTEGER NOT NULL,distance_m REAL NOT NULL,duration_ms INTEGER NOT NULL,started_at INTEGER,ended_at INTEGER," +
            "UNIQUE(activity_id,segment_index))");
        db.execSQL("CREATE TABLE event_local_state (event_id TEXT PRIMARY KEY,role TEXT NOT NULL,status TEXT NOT NULL," +
            "participant_local_id TEXT,subject_id TEXT,event_name TEXT,session_token_ciphertext TEXT,token_kind TEXT," +
            "last_server_sync_at INTEGER,payload_json TEXT,saved_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)");
        createEventLiveSnapshotTable(db);
        db.execSQL("CREATE TABLE sync_queue (id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE," +
            "latest_wins_key TEXT,payload_json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'PENDING',attempt_count INTEGER NOT NULL DEFAULT 0," +
            "next_attempt_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)");
        db.execSQL("CREATE INDEX sync_queue_ready ON sync_queue(state,next_attempt_at,created_at)");
        db.execSQL("CREATE TABLE settings (key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE diagnostic_events (id INTEGER PRIMARY KEY AUTOINCREMENT,activity_id TEXT,name TEXT NOT NULL," +
            "detail TEXT,timestamp INTEGER NOT NULL)");
        db.execSQL("CREATE INDEX diagnostics_activity_time ON diagnostic_events(activity_id,timestamp)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE event_local_state ADD COLUMN subject_id TEXT");
            db.execSQL("ALTER TABLE event_local_state ADD COLUMN event_name TEXT");
            db.execSQL("ALTER TABLE event_local_state ADD COLUMN token_kind TEXT");
            db.execSQL("ALTER TABLE event_local_state ADD COLUMN saved_at INTEGER");
            db.execSQL("UPDATE event_local_state SET saved_at=COALESCE(updated_at,?) WHERE saved_at IS NULL", new Object[]{System.currentTimeMillis()});
        }
        if (oldVersion < 3) createEventLiveSnapshotTable(db);
        if (oldVersion == 3) {
            db.execSQL("ALTER TABLE event_live_snapshot ADD COLUMN distance_m REAL NOT NULL DEFAULT 0");
            db.execSQL("ALTER TABLE event_live_snapshot ADD COLUMN elapsed_time_ms INTEGER NOT NULL DEFAULT 0");
            db.execSQL("ALTER TABLE event_live_snapshot ADD COLUMN started_at INTEGER");
            db.execSQL("UPDATE event_live_snapshot SET started_at=location_timestamp WHERE started_at IS NULL");
        }
        if (oldVersion < 5) {
            db.execSQL("ALTER TABLE activities ADD COLUMN activity_source TEXT NOT NULL DEFAULT 'PERSONAL'");
            createEventActivityLinksTable(db);
            if (oldVersion >= 3) db.execSQL("ALTER TABLE event_live_snapshot ADD COLUMN activity_id TEXT");
        }
    }

    private static void createEventActivityLinksTable(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS event_activity_links (" +
            "event_id TEXT NOT NULL,participant_id TEXT NOT NULL,activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE," +
            "event_name TEXT NOT NULL,context_active INTEGER NOT NULL DEFAULT 1,created_activity INTEGER NOT NULL DEFAULT 0," +
            "joined_at INTEGER NOT NULL,ended_at INTEGER,updated_at INTEGER NOT NULL,PRIMARY KEY(event_id,participant_id))");
        db.execSQL("CREATE INDEX IF NOT EXISTS event_activity_links_activity ON event_activity_links(activity_id,context_active)");
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS event_activity_one_active_context ON event_activity_links(activity_id) WHERE context_active=1");
    }

    private static void createEventLiveSnapshotTable(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS event_live_snapshot (" +
            "scope_key TEXT PRIMARY KEY,event_id TEXT NOT NULL,participant_id TEXT NOT NULL,activity_id TEXT,client_sequence INTEGER NOT NULL," +
            "latitude REAL NOT NULL,longitude REAL NOT NULL,accuracy_m REAL,location_timestamp INTEGER NOT NULL," +
            "distance_m REAL NOT NULL DEFAULT 0,elapsed_time_ms INTEGER NOT NULL DEFAULT 0,started_at INTEGER NOT NULL," +
            "created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)");
    }

    synchronized void saveEventSession(String eventId, String eventName, String role, String status, String subjectId,
                                       String ciphertext, String tokenKind, String payloadJson) {
        long now = System.currentTimeMillis();
        ContentValues values = new ContentValues();
        values.put("event_id", eventId); values.put("event_name", eventName); values.put("role", role); values.put("status", status);
        values.put("subject_id", subjectId); values.put("participant_local_id", "PARTICIPANT".equals(role) ? subjectId : null);
        values.put("session_token_ciphertext", ciphertext); values.put("token_kind", tokenKind);
        values.put("payload_json", payloadJson); values.put("saved_at", now); values.put("updated_at", now);
        getWritableDatabase().insertWithOnConflict("event_local_state", null, values, SQLiteDatabase.CONFLICT_REPLACE);
        scopeOperationalQueue(eventId, "PARTICIPANT".equals(role) ? subjectId : null, "session_scope_changed");
    }

    synchronized JSONObject latestEventSession() throws Exception {
        try (Cursor cursor = getReadableDatabase().query("event_local_state", null, null, null, null, null, "saved_at DESC,updated_at DESC", "1")) {
            if (!cursor.moveToFirst()) return null;
            JSONObject value = new JSONObject();
            value.put("eventId", string(cursor, "event_id")); value.put("eventName", nullableString(cursor, "event_name"));
            value.put("role", string(cursor, "role")); value.put("status", string(cursor, "status"));
            value.put("subjectId", nullableString(cursor, "subject_id")); value.put("ciphertext", nullableString(cursor, "session_token_ciphertext"));
            value.put("tokenKind", nullableString(cursor, "token_kind")); value.put("metadata", parseJson(nullableString(cursor, "payload_json")));
            value.put("savedAt", nullableNumber(cursor, "saved_at")); value.put("updatedAt", number(cursor, "updated_at"));
            return value;
        }
    }

    synchronized void updateEventSession(String eventId, String eventName, String status, String payloadJson) {
        ContentValues values = new ContentValues();
        if (eventName != null) values.put("event_name", eventName);
        if (status != null) values.put("status", status);
        if (payloadJson != null) values.put("payload_json", payloadJson);
        values.put("updated_at", System.currentTimeMillis());
        getWritableDatabase().update("event_local_state", values, "event_id=?", new String[]{eventId});
    }

    synchronized void updateEventSessionCiphertext(String eventId, String ciphertext) {
        ContentValues values = new ContentValues();
        values.put("session_token_ciphertext", ciphertext);
        values.put("updated_at", System.currentTimeMillis());
        getWritableDatabase().update("event_local_state", values, "event_id=?", new String[]{eventId});
    }

    synchronized void clearEventSession(String eventId) {
        scopeOperationalQueue(null, null, "session_cleared");
        if (eventId == null) getWritableDatabase().delete("event_local_state", null, null);
        else getWritableDatabase().delete("event_local_state", "event_id=?", new String[]{eventId});
    }

    synchronized JSONObject startActivity(String id, String type, String profile) throws Exception {
        return startActivity(id, type, profile, "PERSONAL");
    }

    private JSONObject startActivity(String id, String type, String profile, String source) throws Exception {
        long now = System.currentTimeMillis();
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues insert = new ContentValues();
            insert.put("id", id); insert.put("activity_source", source); insert.put("activity_type", type); insert.put("status", "ACTIVE"); insert.put("profile", profile);
            insert.put("started_at", now); insert.put("resumed_at", now); insert.put("created_at", now); insert.put("updated_at", now);
            long result = db.insertWithOnConflict("activities", null, insert, SQLiteDatabase.CONFLICT_IGNORE);
            if (result == -1) {
                ContentValues update = new ContentValues();
                update.put("status", "ACTIVE"); update.put("profile", profile); update.put("resumed_at", now); update.putNull("paused_at"); update.put("updated_at", now);
                db.update("activities", update, "id=? AND status!='COMPLETED'", new String[]{id});
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        event(id, "activity_started", profile);
        return activity(id);
    }

    synchronized JSONObject ensureEventActivity(String eventId, String participantId, String eventName, String type, String profile) throws Exception {
        long now = System.currentTimeMillis();
        String activityId = null;
        boolean created = false;
        boolean createdForEvent = false;
        long joinedAt = now;

        try (Cursor link = getReadableDatabase().query("event_activity_links",
            new String[]{"activity_id","created_activity","joined_at"}, "event_id=? AND participant_id=?",
            new String[]{eventId, participantId}, null, null, null)) {
            if (link.moveToFirst() && !"COMPLETED".equals(statusOf(link.getString(0)))) {
                activityId = link.getString(0); createdForEvent = link.getInt(1) != 0; joinedAt = link.getLong(2);
            }
        }

        if (activityId == null) {
            JSONObject current = activeActivity();
            if (current != null) {
                String currentId = current.getString("id");
                boolean previousWasEventCreated = false;
                try (Cursor previous = getReadableDatabase().query("event_activity_links", new String[]{"created_activity"},
                    "activity_id=? AND context_active=1", new String[]{currentId}, null, null, null)) {
                    previousWasEventCreated = previous.moveToFirst() && previous.getInt(0) != 0;
                }
                getWritableDatabase().execSQL("UPDATE event_activity_links SET context_active=0,ended_at=?,updated_at=? WHERE activity_id=? AND context_active=1",
                    new Object[]{now, now, currentId});
                if (previousWasEventCreated) { endActivity(currentId); current = null; }
            }
            if (current == null) {
                activityId = UUID.randomUUID().toString();
                startActivity(activityId, type, profile, "EVENT_AUTO");
                created = true; createdForEvent = true;
            } else activityId = current.getString("id");
        }

        if ("PAUSED".equals(statusOf(activityId))) resumeActivity(activityId, profile);
        getWritableDatabase().execSQL("UPDATE event_activity_links SET context_active=0,ended_at=?,updated_at=? WHERE activity_id=? AND context_active=1 AND NOT (event_id=? AND participant_id=?)",
            new Object[]{now, now, activityId, eventId, participantId});
        ContentValues link = new ContentValues();
        link.put("event_id", eventId); link.put("participant_id", participantId); link.put("activity_id", activityId);
        link.put("event_name", eventName); link.put("context_active", 1); link.put("created_activity", createdForEvent ? 1 : 0);
        link.put("joined_at", joinedAt); link.putNull("ended_at"); link.put("updated_at", now);
        getWritableDatabase().insertWithOnConflict("event_activity_links", null, link, SQLiteDatabase.CONFLICT_REPLACE);
        ContentValues activityContext = new ContentValues(); activityContext.put("event_id", eventId); activityContext.put("updated_at", now);
        getWritableDatabase().update("activities", activityContext, "id=?", new String[]{activityId});
        event(activityId, "event_context_attached", eventId + ":" + participantId);
        JSONObject result = new JSONObject(); result.put("activity", activity(activityId)); result.put("created", created);
        return result;
    }

    synchronized JSONObject endEventActivityContext(String eventId, String participantId) throws Exception {
        long now = System.currentTimeMillis();
        String activityId = null;
        boolean createdForEvent = false;
        try (Cursor link = getReadableDatabase().query("event_activity_links", new String[]{"activity_id","created_activity"},
            "event_id=? AND participant_id=? AND context_active=1", new String[]{eventId, participantId}, null, null, null)) {
            if (link.moveToFirst()) { activityId = link.getString(0); createdForEvent = link.getInt(1) != 0; }
        }
        JSONObject result = new JSONObject();
        if (activityId == null) { result.put("activity", JSONObject.NULL); result.put("endedActivity", false); return result; }
        getWritableDatabase().execSQL("UPDATE event_activity_links SET context_active=0,ended_at=?,updated_at=? WHERE event_id=? AND participant_id=?",
            new Object[]{now, now, eventId, participantId});
        event(activityId, "event_context_ended", eventId + ":" + participantId);
        boolean endedActivity = createdForEvent && !"COMPLETED".equals(statusOf(activityId));
        JSONObject activity = endedActivity ? endActivity(activityId) : activity(activityId);
        result.put("activity", activity); result.put("endedActivity", endedActivity); return result;
    }

    synchronized boolean isEventContextActive(String activityId) {
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT EXISTS(SELECT 1 FROM event_activity_links WHERE activity_id=? AND context_active=1)", new String[]{activityId})) {
            cursor.moveToFirst(); return cursor.getInt(0) != 0;
        }
    }

    synchronized String activeEventActivityId(String eventId, String participantId) {
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT l.activity_id FROM event_activity_links l JOIN activities a ON a.id=l.activity_id " +
                "WHERE l.event_id=? AND l.participant_id=? AND l.context_active=1 AND a.status='ACTIVE' LIMIT 1",
            new String[]{eventId, participantId})) {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        }
    }

    synchronized JSONObject resumeActivity(String id, String profile) throws Exception {
        long now = System.currentTimeMillis();
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try (Cursor cursor = db.query("activities", new String[]{"paused_at","pause_duration_ms"}, "id=? AND status='PAUSED'", new String[]{id}, null, null, null)) {
            if (!cursor.moveToFirst()) throw new IllegalStateException("Paused activity not found");
            long pausedAt = cursor.isNull(0) ? now : cursor.getLong(0);
            long accumulated = cursor.getLong(1) + Math.max(0, now - pausedAt);
            ContentValues values = new ContentValues();
            values.put("status", "ACTIVE"); values.put("profile", profile); values.put("resumed_at", now);
            values.putNull("paused_at"); values.put("pause_duration_ms", accumulated); values.put("updated_at", now);
            db.update("activities", values, "id=?", new String[]{id});
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        event(id, "activity_resumed", profile);
        return activity(id);
    }

    synchronized JSONObject pauseActivity(String id) throws Exception {
        long now = System.currentTimeMillis();
        ContentValues values = new ContentValues();
        values.put("status", "PAUSED"); values.put("paused_at", now); values.put("updated_at", now);
        int changed = getWritableDatabase().update("activities", values, "id=? AND status='ACTIVE'", new String[]{id});
        if (changed == 0 && !"PAUSED".equals(statusOf(id))) throw new IllegalStateException("Active activity not found");
        event(id, "activity_paused", null);
        return activity(id);
    }

    synchronized JSONObject endActivity(String id) throws Exception {
        long now = System.currentTimeMillis();
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try (Cursor cursor = db.query("activities", new String[]{"status","paused_at","pause_duration_ms"}, "id=?", new String[]{id}, null, null, null)) {
            if (!cursor.moveToFirst()) throw new IllegalStateException("Activity not found");
            long pauseDuration = cursor.getLong(2);
            if ("PAUSED".equals(cursor.getString(0)) && !cursor.isNull(1)) pauseDuration += Math.max(0, now - cursor.getLong(1));
            ContentValues values = new ContentValues();
            values.put("status", "COMPLETED"); values.put("ended_at", now); values.putNull("paused_at");
            values.put("pause_duration_ms", pauseDuration); values.put("updated_at", now);
            db.update("activities", values, "id=?", new String[]{id});
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        event(id, "activity_ended", null);
        return activity(id);
    }

    synchronized long insertLocation(String activityId, Location location) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            long resumedAt = 0;
            try (Cursor activity = db.query("activities", new String[]{"resumed_at","status"}, "id=?", new String[]{activityId}, null, null, null)) {
                if (!activity.moveToFirst() || !"ACTIVE".equals(activity.getString(1))) return -1;
                resumedAt = activity.getLong(0);
            }
            double rawSegment = 0, filteredSegment = 0;
            long elapsedMs = 0;
            String reason = null;
            boolean accepted = true;
            double impliedSpeed = location.hasSpeed() ? location.getSpeed() : 0;
            try (Cursor previous = db.query("activity_points", new String[]{"timestamp","latitude","longitude","accuracy"}, "activity_id=?", new String[]{activityId}, null, null, "sequence DESC", "1")) {
                if (previous.moveToFirst()) {
                    long previousTimestamp = previous.getLong(0);
                    elapsedMs = Math.max(0, location.getTime() - previousTimestamp);
                    if (previousTimestamp < resumedAt) {
                        accepted = false; reason = "resume-boundary"; elapsedMs = 0;
                    } else {
                        float[] distance = new float[1];
                        Location.distanceBetween(previous.getDouble(1), previous.getDouble(2), location.getLatitude(), location.getLongitude(), distance);
                        rawSegment = distance[0];
                        if (elapsedMs > 0) impliedSpeed = rawSegment / (elapsedMs / 1000d);
                        double accuracy = location.hasAccuracy() ? location.getAccuracy() : 999;
                        double previousAccuracy = previous.isNull(3) ? 999 : previous.getDouble(3);
                        double jitterFloor = Math.max(3, Math.min(accuracy, previousAccuracy) * 0.15);
                        if (accuracy > 50) { accepted = false; reason = "accuracy>50m"; }
                        else if (elapsedMs <= 0) { accepted = false; reason = "non-positive-time"; }
                        else if (rawSegment < jitterFloor) { accepted = false; reason = "jitter"; }
                        else if (rawSegment > 250 && elapsedMs < 60_000) { accepted = false; reason = "teleport"; }
                        else if (impliedSpeed > 12) { accepted = false; reason = "implausible-speed"; }
                        if (accepted) filteredSegment = rawSegment;
                    }
                }
            }
            String classification = impliedSpeed > 3.5 ? "highSpeedCandidate" : impliedSpeed > 2.2 ? "runningCandidate" : impliedSpeed >= 0 ? "walkingCandidate" : "unknown";
            ContentValues point = new ContentValues();
            point.put("activity_id", activityId); point.put("timestamp", location.getTime()); point.put("latitude", location.getLatitude()); point.put("longitude", location.getLongitude());
            if (location.hasAccuracy()) point.put("accuracy", location.getAccuracy()); if (location.hasSpeed()) point.put("speed", location.getSpeed());
            if (location.hasBearing()) point.put("bearing", location.getBearing()); if (location.hasAltitude()) point.put("altitude", location.getAltitude());
            point.put("provider", location.getProvider()); point.put("mock", isMock(location) ? 1 : 0); point.put("stored_at", System.currentTimeMillis());
            point.put("raw_segment_distance_m", rawSegment); point.put("filtered_segment_distance_m", filteredSegment); point.put("classification", classification);
            point.put("accepted_for_metrics", accepted ? 1 : 0); if (reason != null) point.put("filter_reason", reason);
            long sequence = db.insertOrThrow("activity_points", null, point);
            long metricTime = elapsedMs > 120_000 ? 0 : elapsedMs;
            boolean moving = accepted && (filteredSegment >= 3 || impliedSpeed >= 0.5);
            db.execSQL("UPDATE activities SET raw_distance_m=raw_distance_m+?,filtered_distance_m=filtered_distance_m+?," +
                    (moving ? "moving_time_ms=moving_time_ms+?" : "stopped_time_ms=stopped_time_ms+?") +
                    ",point_count=point_count+1,updated_at=? WHERE id=?",
                new Object[]{rawSegment, filteredSegment, metricTime, System.currentTimeMillis(), activityId});
            db.setTransactionSuccessful();
            return sequence;
        } finally { db.endTransaction(); }
    }

    synchronized JSONObject activity(String id) throws Exception {
        try (Cursor cursor = getReadableDatabase().query("activities", null, "id=?", new String[]{id}, null, null, null)) {
            if (!cursor.moveToFirst()) throw new IllegalStateException("Activity not found");
            JSONObject value = activityJson(cursor); appendEventContext(value); return value;
        }
    }

    synchronized JSONObject activeActivity() throws Exception {
        try (Cursor cursor = getReadableDatabase().query("activities", null, "status IN ('ACTIVE','PAUSED')", null, null, null, "updated_at DESC", "1")) {
            if (!cursor.moveToFirst()) return null;
            JSONObject value = activityJson(cursor); appendEventContext(value); return value;
        }
    }

    synchronized JSONArray completedActivities(int requestedLimit) throws Exception {
        JSONArray result = new JSONArray();
        int limit = Math.max(1, Math.min(requestedLimit, 500));
        try (Cursor cursor = getReadableDatabase().query("activities", null, "status='COMPLETED'", null, null, null,
            "COALESCE(ended_at,updated_at) DESC", Integer.toString(limit))) {
            while (cursor.moveToNext()) {
                JSONObject value = activityJson(cursor);
                appendEventContext(value);
                result.put(value);
            }
        }
        return result;
    }

    private void appendEventContext(JSONObject activity) throws Exception {
        try (Cursor cursor = getReadableDatabase().query("event_activity_links", null, "activity_id=?", new String[]{activity.getString("id")},
            null, null, "context_active DESC,joined_at DESC", "1")) {
            if (!cursor.moveToFirst()) { activity.put("eventContext", JSONObject.NULL); return; }
            JSONObject context = new JSONObject();
            context.put("eventId", string(cursor, "event_id")); context.put("participantId", string(cursor, "participant_id"));
            context.put("eventName", string(cursor, "event_name")); context.put("active", number(cursor, "context_active") != 0);
            context.put("createdActivity", number(cursor, "created_activity") != 0); context.put("joinedAt", number(cursor, "joined_at"));
            context.put("endedAt", nullableNumber(cursor, "ended_at")); activity.put("eventContext", context);
        }
    }

    synchronized JSONArray points(String activityId, long afterSequence) throws Exception {
        JSONArray result = new JSONArray();
        try (Cursor cursor = getReadableDatabase().query("activity_points", null, "activity_id=? AND sequence>?", new String[]{activityId, Long.toString(afterSequence)}, null, null, "sequence ASC")) {
            while (cursor.moveToNext()) {
                JSONObject point = new JSONObject();
                point.put("activityId", string(cursor,"activity_id")); point.put("sequence", number(cursor,"sequence")); point.put("timestamp", number(cursor,"timestamp"));
                point.put("latitude", decimal(cursor,"latitude")); point.put("longitude", decimal(cursor,"longitude"));
                nullableDecimal(point,"accuracy",cursor); nullableDecimal(point,"speed",cursor); nullableDecimal(point,"bearing",cursor); nullableDecimal(point,"altitude",cursor);
                point.put("provider", nullableString(cursor,"provider")); point.put("mock", number(cursor,"mock") != 0); point.put("storedAt", number(cursor,"stored_at"));
                point.put("rawSegmentDistanceM", decimal(cursor,"raw_segment_distance_m")); point.put("filteredSegmentDistanceM", decimal(cursor,"filtered_segment_distance_m"));
                point.put("classification", string(cursor,"classification")); point.put("acceptedForMetrics", number(cursor,"accepted_for_metrics") != 0);
                point.put("filterReason", nullableString(cursor,"filter_reason")); result.put(point);
            }
        }
        return result;
    }

    synchronized JSONObject pointStatus(String activityId) throws Exception {
        JSONObject result = new JSONObject();
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT COUNT(*),COALESCE(MAX(sequence),0),MAX(timestamp) FROM activity_points WHERE activity_id=?", new String[]{activityId})) {
            cursor.moveToFirst(); result.put("nativePointCount", cursor.getLong(0)); result.put("lastSequence", cursor.getLong(1));
            result.put("nativeLastTimestamp", cursor.isNull(2) ? JSONObject.NULL : cursor.getLong(2));
        }
        return result;
    }

    synchronized void enqueueLatestSync(String kind, String idempotencyKey, String latestWinsKey, String payloadJson) {
        long now = System.currentTimeMillis();
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("sync_queue", "latest_wins_key=?", new String[]{latestWinsKey});
            ContentValues values = syncValues(kind, idempotencyKey, latestWinsKey, payloadJson, now);
            db.insertOrThrow("sync_queue", null, values);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    synchronized void enqueueDurableSync(String kind, String idempotencyKey, String payloadJson) {
        long now = System.currentTimeMillis();
        getWritableDatabase().insertWithOnConflict("sync_queue", null,
            syncValues(kind, idempotencyKey, null, payloadJson, now), SQLiteDatabase.CONFLICT_IGNORE);
    }

    synchronized JSONArray readySyncItems(int limit) throws Exception {
        JSONArray result = new JSONArray();
        long now = System.currentTimeMillis();
        try (Cursor cursor = getReadableDatabase().query("sync_queue", null,
            "state='PENDING' AND (next_attempt_at IS NULL OR next_attempt_at<=?)", new String[]{Long.toString(now)},
            null, null, "created_at ASC", Integer.toString(Math.max(1, Math.min(limit, 50))))) {
            while (cursor.moveToNext()) {
                JSONObject item = new JSONObject();
                item.put("id", number(cursor, "id")); item.put("kind", string(cursor, "kind"));
                item.put("idempotencyKey", string(cursor, "idempotency_key"));
                item.put("latestWinsKey", nullableString(cursor, "latest_wins_key"));
                item.put("payload", parseJson(nullableString(cursor, "payload_json")));
                item.put("attemptCount", number(cursor, "attempt_count")); result.put(item);
            }
        }
        return result;
    }

    synchronized JSONArray readyLiveSyncItems(int limit) throws Exception {
        JSONArray result = new JSONArray();
        long now = System.currentTimeMillis();
        try (Cursor cursor = getReadableDatabase().query("sync_queue", null,
            "kind='LIVE_STATE' AND state='PENDING' AND (next_attempt_at IS NULL OR next_attempt_at<=?)", new String[]{Long.toString(now)},
            null, null, "created_at ASC", Integer.toString(Math.max(1, Math.min(limit, 10))))) {
            while (cursor.moveToNext()) {
                JSONObject item = new JSONObject();
                item.put("id", number(cursor, "id")); item.put("kind", string(cursor, "kind"));
                item.put("idempotencyKey", string(cursor, "idempotency_key"));
                item.put("latestWinsKey", nullableString(cursor, "latest_wins_key"));
                item.put("payload", parseJson(nullableString(cursor, "payload_json")));
                item.put("attemptCount", number(cursor, "attempt_count")); result.put(item);
            }
        }
        return result;
    }

    synchronized JSONObject latestLiveSnapshot(String activityId) throws Exception {
        JSONObject snapshot = new JSONObject();
        try (Cursor activity = getReadableDatabase().query("activities",
            new String[]{"status","filtered_distance_m","moving_time_ms","stopped_time_ms","started_at"},
            "id=?", new String[]{activityId}, null, null, null)) {
            if (!activity.moveToFirst() || !"ACTIVE".equals(activity.getString(0))) return null;
            snapshot.put("distanceM", activity.getDouble(1));
            snapshot.put("elapsedTimeMs", activity.getLong(2) + activity.getLong(3));
            snapshot.put("startedAt", activity.getLong(4));
        }
        try (Cursor point = getReadableDatabase().query("activity_points",
            new String[]{"sequence","latitude","longitude","accuracy","timestamp"}, "activity_id=?", new String[]{activityId},
            null, null, "sequence DESC", "1")) {
            if (!point.moveToFirst()) return null;
            snapshot.put("clientSequence", point.getLong(0)); snapshot.put("latitude", point.getDouble(1)); snapshot.put("longitude", point.getDouble(2));
            snapshot.put("accuracyM", point.isNull(3) ? JSONObject.NULL : point.getDouble(3));
            snapshot.put("locationTimestamp", point.getLong(4));
        }
        return snapshot;
    }

    synchronized long recordEventLiveProjection(String eventId, String participantId, String activityId) throws Exception {
        String scopeKey = "live:" + eventId + ":" + participantId;
        long now = System.currentTimeMillis();
        JSONObject canonical = latestLiveSnapshot(activityId);
        if (canonical == null) return -1;
        long createdAt = now;
        try (Cursor cursor = getReadableDatabase().query("event_live_snapshot", new String[]{"created_at"},
            "scope_key=?", new String[]{scopeKey}, null, null, null)) {
            if (cursor.moveToFirst()) createdAt = cursor.getLong(0);
        }
        ContentValues values = new ContentValues();
        values.put("scope_key", scopeKey); values.put("event_id", eventId); values.put("participant_id", participantId); values.put("activity_id", activityId);
        values.put("client_sequence", canonical.getLong("clientSequence")); values.put("latitude", canonical.getDouble("latitude")); values.put("longitude", canonical.getDouble("longitude"));
        if (canonical.isNull("accuracyM")) values.putNull("accuracy_m"); else values.put("accuracy_m", canonical.getDouble("accuracyM"));
        values.put("location_timestamp", canonical.getLong("locationTimestamp")); values.put("distance_m", canonical.getDouble("distanceM"));
        values.put("elapsed_time_ms", canonical.getLong("elapsedTimeMs")); values.put("started_at", canonical.getLong("startedAt"));
        values.put("created_at", createdAt); values.put("updated_at", now);
        getWritableDatabase().insertWithOnConflict("event_live_snapshot", null, values, SQLiteDatabase.CONFLICT_REPLACE);
        return canonical.getLong("clientSequence");
    }

    synchronized JSONObject eventLiveSnapshot(String eventId, String participantId) throws Exception {
        String scopeKey = "live:" + eventId + ":" + participantId;
        JSONObject snapshot = new JSONObject();
        try (Cursor point = getReadableDatabase().query("event_live_snapshot",
            new String[]{"activity_id","client_sequence","latitude","longitude","accuracy_m","location_timestamp","distance_m","elapsed_time_ms"},
            "scope_key=?", new String[]{scopeKey}, null, null, null)) {
            if (!point.moveToFirst()) return null;
            snapshot.put("activityId", point.isNull(0) ? JSONObject.NULL : point.getString(0));
            snapshot.put("clientSequence", point.getLong(1)); snapshot.put("latitude", point.getDouble(2)); snapshot.put("longitude", point.getDouble(3));
            snapshot.put("accuracyM", point.isNull(4) ? JSONObject.NULL : point.getDouble(4)); snapshot.put("locationTimestamp", point.getLong(5));
            snapshot.put("distanceM", point.getDouble(6)); snapshot.put("elapsedTimeMs", point.getLong(7));
        }
        return snapshot;
    }

    synchronized void clearEventLiveSnapshot(String eventId, String participantId) {
        getWritableDatabase().delete("event_live_snapshot", "event_id=? AND participant_id=?", new String[]{eventId, participantId});
    }

    synchronized void completeSyncItem(long id) { getWritableDatabase().delete("sync_queue", "id=?", new String[]{Long.toString(id)}); }

    synchronized void retrySyncItem(long id, long nextAttemptAt) {
        getWritableDatabase().execSQL("UPDATE sync_queue SET state=?,attempt_count=attempt_count+1,next_attempt_at=?,updated_at=? WHERE id=?",
            new Object[]{"PENDING", nextAttemptAt, System.currentTimeMillis(), id});
    }

    synchronized void terminalSyncItem(long id, String reason) {
        getWritableDatabase().execSQL("UPDATE sync_queue SET state='TERMINAL',next_attempt_at=NULL,updated_at=? WHERE id=?",
            new Object[]{System.currentTimeMillis(), id});
        event(null, "sync_queue_terminal", id + ":" + reason);
    }

    synchronized void scopeOperationalQueue(String eventId, String participantId, String reason) {
        SQLiteDatabase db = getWritableDatabase();
        JSONArray staleLive = new JSONArray();
        JSONArray staleHelp = new JSONArray();
        try (Cursor cursor = db.query("sync_queue", new String[]{"id","kind","payload_json"},
            "state='PENDING' AND kind IN ('LIVE_STATE','HELP_REQUEST')", null, null, null, null)) {
            while (cursor.moveToNext()) {
                long id = cursor.getLong(0);
                String kind = cursor.getString(1);
                Object parsed = parseJson(cursor.getString(2));
                JSONObject payload = parsed instanceof JSONObject ? (JSONObject) parsed : new JSONObject();
                boolean matches = eventId != null && participantId != null && eventId.equals(payload.optString("eventId")) && participantId.equals(payload.optString("participantId"));
                if (matches) continue;
                if ("LIVE_STATE".equals(kind)) staleLive.put(id); else staleHelp.put(id);
            }
        }
        for (int index = 0; index < staleLive.length(); index++) completeSyncItem(staleLive.optLong(index));
        for (int index = 0; index < staleHelp.length(); index++) terminalSyncItem(staleHelp.optLong(index), reason);
    }

    synchronized int pendingSyncCount(String kind) {
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM sync_queue WHERE state='PENDING' AND kind=?", new String[]{kind})) {
            cursor.moveToFirst(); return cursor.getInt(0);
        }
    }

    synchronized void discardLatestSync(String latestWinsKey) {
        getWritableDatabase().delete("sync_queue", "latest_wins_key=?", new String[]{latestWinsKey});
    }

    private static ContentValues syncValues(String kind, String idempotencyKey, String latestWinsKey, String payloadJson, long now) {
        ContentValues values = new ContentValues(); values.put("kind", kind); values.put("idempotency_key", idempotencyKey);
        if (latestWinsKey != null) values.put("latest_wins_key", latestWinsKey); values.put("payload_json", payloadJson);
        values.put("state", "PENDING"); values.put("attempt_count", 0); values.putNull("next_attempt_at");
        values.put("created_at", now); values.put("updated_at", now); return values;
    }

    synchronized void event(String activityId, String name, String detail) {
        ContentValues values = new ContentValues();
        if (activityId != null) values.put("activity_id", activityId); values.put("name", name); if (detail != null) values.put("detail", detail);
        values.put("timestamp", System.currentTimeMillis()); getWritableDatabase().insert("diagnostic_events", null, values);
    }

    private String statusOf(String id) {
        try (Cursor cursor = getReadableDatabase().query("activities", new String[]{"status"}, "id=?", new String[]{id}, null, null, null)) {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        }
    }

    private static JSONObject activityJson(Cursor cursor) throws Exception {
        JSONObject value = new JSONObject();
        value.put("id", string(cursor,"id")); value.put("eventId", nullableString(cursor,"event_id")); value.put("source", string(cursor,"activity_source")); value.put("type", string(cursor,"activity_type"));
        value.put("status", string(cursor,"status")); value.put("profile", string(cursor,"profile")); value.put("startedAt", number(cursor,"started_at"));
        value.put("pausedAt", nullableNumber(cursor,"paused_at")); value.put("endedAt", nullableNumber(cursor,"ended_at")); value.put("pauseDurationMs", number(cursor,"pause_duration_ms"));
        value.put("rawDistanceM", decimal(cursor,"raw_distance_m")); value.put("filteredDistanceM", decimal(cursor,"filtered_distance_m"));
        value.put("movingTimeMs", number(cursor,"moving_time_ms")); value.put("stoppedTimeMs", number(cursor,"stopped_time_ms")); value.put("pointCount", number(cursor,"point_count"));
        return value;
    }

    private static String string(Cursor cursor,String name){ return cursor.getString(cursor.getColumnIndexOrThrow(name)); }
    private static String nullableString(Cursor cursor,String name){ int index=cursor.getColumnIndexOrThrow(name); return cursor.isNull(index)?null:cursor.getString(index); }
    private static long number(Cursor cursor,String name){ return cursor.getLong(cursor.getColumnIndexOrThrow(name)); }
    private static Object nullableNumber(Cursor cursor,String name){ int index=cursor.getColumnIndexOrThrow(name); return cursor.isNull(index)?JSONObject.NULL:cursor.getLong(index); }
    private static double decimal(Cursor cursor,String name){ return cursor.getDouble(cursor.getColumnIndexOrThrow(name)); }
    private static Object parseJson(String value) { if (value == null || value.isEmpty()) return JSONObject.NULL; try { return new JSONObject(value); } catch (Exception ignored) { return JSONObject.NULL; } }
    private static void nullableDecimal(JSONObject object,String name,Cursor cursor)throws Exception{int index=cursor.getColumnIndexOrThrow(name);object.put(name,cursor.isNull(index)?JSONObject.NULL:cursor.getDouble(index));}
    @SuppressWarnings("deprecation") private static boolean isMock(Location location){if(Build.VERSION.SDK_INT>=31)return location.isMock();if(Build.VERSION.SDK_INT>=18)return location.isFromMockProvider();return false;}
}
