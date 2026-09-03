package kr.co.steplink.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.location.Location;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;

final class StepLinkDatabase extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "steplink.db";
    private static final int DATABASE_VERSION = 1;

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
            "id TEXT PRIMARY KEY,event_id TEXT,activity_type TEXT NOT NULL,status TEXT NOT NULL," +
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
        db.execSQL("CREATE TABLE photos (id TEXT PRIMARY KEY,activity_id TEXT REFERENCES activities(id),event_id TEXT," +
            "local_uri TEXT NOT NULL,image_hash TEXT,verification_id TEXT,captured_at INTEGER NOT NULL,created_at INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE photo_metadata (photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE," +
            "latitude REAL,longitude REAL,accuracy REAL,activity_distance_m REAL,activity_elapsed_ms INTEGER," +
            "event_name TEXT,participant_local_id TEXT,stamp_asset_id TEXT)");
        db.execSQL("CREATE TABLE segments (id TEXT PRIMARY KEY,activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE," +
            "segment_index INTEGER NOT NULL,distance_m REAL NOT NULL,duration_ms INTEGER NOT NULL,started_at INTEGER,ended_at INTEGER," +
            "UNIQUE(activity_id,segment_index))");
        db.execSQL("CREATE TABLE event_local_state (event_id TEXT PRIMARY KEY,role TEXT NOT NULL,status TEXT NOT NULL," +
            "participant_local_id TEXT,session_token_ciphertext TEXT,last_server_sync_at INTEGER,payload_json TEXT,updated_at INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE sync_queue (id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE," +
            "latest_wins_key TEXT,payload_json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'PENDING',attempt_count INTEGER NOT NULL DEFAULT 0," +
            "next_attempt_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)");
        db.execSQL("CREATE INDEX sync_queue_ready ON sync_queue(state,next_attempt_at,created_at)");
        db.execSQL("CREATE TABLE settings (key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE diagnostic_events (id INTEGER PRIMARY KEY AUTOINCREMENT,activity_id TEXT,name TEXT NOT NULL," +
            "detail TEXT,timestamp INTEGER NOT NULL)");
        db.execSQL("CREATE INDEX diagnostics_activity_time ON diagnostic_events(activity_id,timestamp)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }

    synchronized JSONObject startActivity(String id, String type, String profile) throws Exception {
        long now = System.currentTimeMillis();
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues insert = new ContentValues();
            insert.put("id", id); insert.put("activity_type", type); insert.put("status", "ACTIVE"); insert.put("profile", profile);
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
            return activityJson(cursor);
        }
    }

    synchronized JSONObject activeActivity() throws Exception {
        try (Cursor cursor = getReadableDatabase().query("activities", null, "status IN ('ACTIVE','PAUSED')", null, null, null, "updated_at DESC", "1")) {
            return cursor.moveToFirst() ? activityJson(cursor) : null;
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
        value.put("id", string(cursor,"id")); value.put("eventId", nullableString(cursor,"event_id")); value.put("type", string(cursor,"activity_type"));
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
    private static void nullableDecimal(JSONObject object,String name,Cursor cursor)throws Exception{int index=cursor.getColumnIndexOrThrow(name);object.put(name,cursor.isNull(index)?JSONObject.NULL:cursor.getDouble(index));}
    @SuppressWarnings("deprecation") private static boolean isMock(Location location){if(Build.VERSION.SDK_INT>=31)return location.isMock();if(Build.VERSION.SDK_INT>=18)return location.isFromMockProvider();return false;}
}
