package kr.co.steplink.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

public class StepLinkLocationService extends Service {
    static final String ACTION_START = "steplink.location.START";
    static final String ACTION_PAUSE = "steplink.location.PAUSE";
    static final String ACTION_END = "steplink.location.END";
    static final String ACTION_EVENT_SYNC_CHANGED = "steplink.location.EVENT_SYNC_CHANGED";
    static final String EXTRA_ACTIVITY_ID = "activityId";
    static final String EXTRA_PROFILE = "profile";
    private static final String PREFS = "steplink_tracking_state";
    private static final String CHANNEL_ID = "steplink_tracking";
    private static final int NOTIFICATION_ID = 1101;
    private FusedLocationProviderClient client;
    private LocationCallback callback;
    private StepLinkDatabase db;
    private EventLiveSyncManager liveSyncManager;
    private String activityId;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable heartbeat = new Runnable() {
        @Override public void run() { db.event(activityId, "service_alive", "60s heartbeat"); handler.postDelayed(this, 60_000); }
    };

    @Override public void onCreate() {
        super.onCreate();
        db = new StepLinkDatabase(this);
        liveSyncManager = new EventLiveSyncManager(this, db, () -> handler.post(this::handleLiveSyncDisabled));
        client = LocationServices.getFusedLocationProviderClient(this);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "활동 위치 기록", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("화면이 꺼진 동안에도 운동 경로를 휴대폰에 기록합니다.");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences preferences = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (intent != null && (ACTION_PAUSE.equals(intent.getAction()) || ACTION_END.equals(intent.getAction()))) {
            stopPersonalTracking(preferences, ACTION_PAUSE.equals(intent.getAction()) ? "pause" : "end");
            return EventLiveSyncManager.isEnabled(this) ? START_STICKY : START_NOT_STICKY;
        }
        boolean restored = intent == null;
        boolean personalActive = preferences.getBoolean("serviceActive", false);
        activityId = personalActive ? (intent == null ? preferences.getString("activityId", null) : intent.getStringExtra(EXTRA_ACTIVITY_ID)) : null;
        if (activityId == null && personalActive) activityId = preferences.getString("activityId", null);
        String profile = intent == null ? preferences.getString("profile", "balanced") : intent.getStringExtra(EXTRA_PROFILE);
        if (profile == null) profile = preferences.getString("profile", "balanced");
        if (activityId == null || !personalActive) { stopSelf(); return START_NOT_STICKY; }
        if (activityId != null) preferences.edit().putString("activityId", activityId).putString("profile", profile).putBoolean("serviceActive", true).apply();
        startInForeground();
        requestUpdates(profile == null ? "balanced" : profile);
        db.event(activityId, restored ? "service_restored" : "service_started", profile);
        liveSyncManager.start(activityId);
        handler.removeCallbacks(heartbeat); handler.postDelayed(heartbeat, 60_000);
        return START_STICKY;
    }

    private void startInForeground() {
        PendingIntent openApp = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("StepLink가 활동을 기록 중입니다")
            .setContentText(liveEnabledText())
            .setOngoing(true).setContentIntent(openApp).setPriority(NotificationCompat.PRIORITY_LOW);
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        else startForeground(NOTIFICATION_ID, notification.build());
    }

    private String liveEnabledText() {
        return EventLiveSyncManager.isEnabled(this) ? "상세 경로는 휴대폰에, 행사에는 최신 상태만 전송됩니다" : "상세 경로는 이 휴대폰에 저장됩니다";
    }

    private void requestUpdates(String profile) {
        if (callback != null) client.removeLocationUpdates(callback);
        long interval = 5_000, minimum = 2_500, delay = 5_000; float distance = 10; int priority = Priority.PRIORITY_HIGH_ACCURACY;
        if ("accurate".equals(profile)) { interval = 3_000; minimum = 1_500; distance = 5; }
        else if ("battery".equals(profile)) { interval = 15_000; minimum = 7_500; delay = 30_000; distance = 25; priority = Priority.PRIORITY_BALANCED_POWER_ACCURACY; }
        LocationRequest request = new LocationRequest.Builder(priority, interval).setMinUpdateIntervalMillis(minimum).setMinUpdateDistanceMeters(distance).setMaxUpdateDelayMillis(delay).build();
        callback = new LocationCallback() {
            @Override public void onLocationResult(LocationResult result) {
                for (android.location.Location location : result.getLocations()) {
                    if (activityId != null) {
                        long sequence = db.insertLocation(activityId, location);
                        if (sequence > 0) db.event(activityId, "location_received", Long.toString(sequence));
                    }
                    liveSyncManager.onLocation(location);
                }
            }
        };
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            db.event(activityId, "service_error", "location permission missing"); stopTracking("permission"); return;
        }
        client.requestLocationUpdates(request, callback, Looper.getMainLooper()).addOnFailureListener(error -> db.event(activityId, "service_error", String.valueOf(error.getMessage())));
    }

    private void stopTracking(String reason) {
        if (callback != null) client.removeLocationUpdates(callback);
        callback = null; handler.removeCallbacks(heartbeat);
        if (liveSyncManager != null) liveSyncManager.stop();
        if (activityId != null) db.event(activityId, "service_stopped", reason);
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("serviceActive", false).apply();
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
    }

    private void stopPersonalTracking(SharedPreferences preferences, String reason) {
        String stoppedActivityId = activityId != null ? activityId : preferences.getString("activityId", null);
        preferences.edit().putBoolean("serviceActive", false).remove("activityId").apply();
        if (stoppedActivityId != null) db.event(stoppedActivityId, "service_stopped", reason);
        activityId = null;
        stopTracking(reason);
    }

    private void handleLiveSyncDisabled() {
        if (!getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("serviceActive", false)) stopTracking("event_live_sync_disabled");
    }

    static void requestEventSyncRefresh(Context context, boolean enabling) {
        Intent intent = new Intent(context, StepLinkLocationService.class).setAction(ACTION_EVENT_SYNC_CHANGED);
        if (enabling) ContextCompat.startForegroundService(context, intent);
        else context.startService(intent);
    }

    @Override public void onDestroy() { if (callback != null) client.removeLocationUpdates(callback); handler.removeCallbacks(heartbeat); if (liveSyncManager != null) liveSyncManager.stop(); super.onDestroy(); }
    @Nullable @Override public IBinder onBind(Intent intent) { return null; }
}
