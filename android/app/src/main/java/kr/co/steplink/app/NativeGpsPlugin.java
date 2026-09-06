package kr.co.steplink.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.location.LocationManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONObject;

@CapacitorPlugin(name = "NativeGps", permissions = {
    @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class NativeGpsPlugin extends Plugin {
    private static final String PREFS = "steplink_tracking_state";
    private StepLinkDatabase db;

    @Override public void load() { db = new StepLinkDatabase(getContext()); }

    @PluginMethod public void requestPermissionsForTracking(PluginCall call) { requestAllPermissions(call, "permissionsResult"); }

    @PermissionCallback private void permissionsResult(PluginCall call) {
        JSObject result = new JSObject();
        result.put("location", getPermissionState("location").toString());
        result.put("notifications", Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED);
        db.event(null, "permission_changed", result.toString());
        call.resolve(result);
    }

    @PluginMethod public void start(PluginCall call) {
        String activityId = call.getString("activityId");
        String activityType = call.getString("activityType", "WALK");
        String profile = call.getString("profile", "balanced");
        if (activityId == null || getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("위치 권한과 activityId가 필요합니다."); return;
        }
        try {
            db.startActivity(activityId, activityType, profile);
            rememberStart(activityId, profile);
            startService(activityId, profile);
            call.resolve();
        } catch (Exception error) { call.reject("활동을 시작하지 못했습니다.", error); }
    }

    @PluginMethod public void pause(PluginCall call) {
        String activityId = call.getString("activityId");
        if (activityId == null) { call.reject("activityId가 필요합니다."); return; }
        try {
            if (db.isEventContextActive(activityId)) { call.reject("진행 중인 행사 활동은 행사 종료 전 일시정지할 수 없습니다."); return; }
            getContext().startService(new Intent(getContext(), StepLinkLocationService.class).setAction(StepLinkLocationService.ACTION_PAUSE));
            db.pauseActivity(activityId);
            prefs().edit().putBoolean("serviceActive", false).apply();
            call.resolve();
        } catch (Exception error) { call.reject("활동을 일시정지하지 못했습니다.", error); }
    }

    @PluginMethod public void resume(PluginCall call) {
        String activityId = call.getString("activityId");
        String profile = call.getString("profile", "balanced");
        if (activityId == null || getPermissionState("location") != PermissionState.GRANTED) { call.reject("위치 권한과 activityId가 필요합니다."); return; }
        try {
            db.resumeActivity(activityId, profile);
            prefs().edit().putString("activityId", activityId).putString("profile", profile).putBoolean("serviceActive", true).apply();
            startService(activityId, profile);
            call.resolve();
        } catch (Exception error) { call.reject("활동을 재개하지 못했습니다.", error); }
    }

    @PluginMethod public void end(PluginCall call) {
        String activityId = call.getString("activityId");
        if (activityId == null) { call.reject("activityId가 필요합니다."); return; }
        try {
            if (db.isEventContextActive(activityId)) { call.reject("진행 중인 행사 활동은 행사 종료 후 자동으로 저장됩니다."); return; }
            getContext().startService(new Intent(getContext(), StepLinkLocationService.class).setAction(StepLinkLocationService.ACTION_END));
            recordBatteryEnd(activityId);
            JSObject result = new JSObject(); result.put("activity", db.endActivity(activityId));
            prefs().edit().putBoolean("serviceActive", false).remove("activityId").apply();
            call.resolve(result);
        } catch (Exception error) { call.reject("활동을 종료하지 못했습니다.", error); }
    }

    @PluginMethod public void ensureEventActivity(PluginCall call) {
        String eventId = call.getString("eventId"), participantId = call.getString("participantId"), eventName = call.getString("eventName");
        String activityType = call.getString("activityType", "WALK"), profile = call.getString("profile", "balanced");
        if (eventId == null || participantId == null || eventName == null || getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("행사 activity 정보와 위치 권한이 필요합니다."); return;
        }
        try {
            JSONObject result = db.ensureEventActivity(eventId, participantId, eventName, activityType, profile);
            JSONObject activity = result.getJSONObject("activity");
            String activityId = activity.getString("id"), activeProfile = activity.getString("profile");
            if (result.optBoolean("created")) rememberStart(activityId, activeProfile);
            else prefs().edit().putString("activityId", activityId).putString("profile", activeProfile).putBoolean("serviceActive", true).apply();
            startService(activityId, activeProfile);
            call.resolve(JSObject.fromJSONObject(result));
        } catch (Exception error) { call.reject("행사 활동을 연결하지 못했습니다.", error); }
    }

    @PluginMethod public void endEventActivityContext(PluginCall call) {
        String eventId = call.getString("eventId"), participantId = call.getString("participantId");
        if (eventId == null || participantId == null) { call.reject("행사 activity scope가 필요합니다."); return; }
        try {
            JSONObject result = db.endEventActivityContext(eventId, participantId);
            if (result.optBoolean("endedActivity")) {
                JSONObject activity = result.optJSONObject("activity");
                if (activity != null) recordBatteryEnd(activity.getString("id"));
                prefs().edit().putBoolean("serviceActive", false).remove("activityId").apply();
                getContext().startService(new Intent(getContext(), StepLinkLocationService.class).setAction(StepLinkLocationService.ACTION_END));
            }
            call.resolve(JSObject.fromJSONObject(result));
        } catch (Exception error) { call.reject("행사 활동을 종료하지 못했습니다.", error); }
    }

    @PluginMethod public void readPoints(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("points", db.points(call.getString("activityId", ""), call.getLong("afterSequence", 0L)));
            call.resolve(result);
        } catch (Exception error) { call.reject("위치 기록을 읽지 못했습니다.", error); }
    }

    @PluginMethod public void getActivity(PluginCall call) {
        try { JSObject result = new JSObject(); result.put("activity", db.activity(call.getString("activityId", ""))); call.resolve(result); }
        catch (Exception error) { call.reject("활동을 읽지 못했습니다.", error); }
    }

    @PluginMethod public void getActiveActivity(PluginCall call) {
        try { JSObject result = new JSObject(); JSONObject active = db.activeActivity(); result.put("activity", active == null ? JSONObject.NULL : active); call.resolve(result); }
        catch (Exception error) { call.reject("진행 중인 활동을 복원하지 못했습니다.", error); }
    }

    @PluginMethod public void listCompletedActivities(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("activities", db.completedActivities(call.getInt("limit", 100)));
            call.resolve(result);
        } catch (Exception error) { call.reject("완료 활동 목록을 읽지 못했습니다.", error); }
    }

    @PluginMethod public void getDiagnostics(PluginCall call) {
        try {
            String activityId = call.getString("activityId", prefs().getString("activityId", ""));
            JSObject result = JSObject.fromJSONObject(db.pointStatus(activityId));
            Battery battery = battery();
            long start = prefs().getLong("batteryStartedAt", 0);
            int startPct = prefs().getInt("batteryStartPct", -1);
            double drop = startPct < 0 || battery.percent < 0 ? 0 : startPct - battery.percent;
            long duration = start == 0 ? 0 : System.currentTimeMillis() - start;
            LocationManager locations = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            result.put("available", true);
            result.put("serviceActive", prefs().getBoolean("serviceActive", false));
            result.put("gpsEnabled", locations != null && locations.isProviderEnabled(LocationManager.GPS_PROVIDER));
            result.put("currentBatteryPct", battery.percent < 0 ? null : battery.percent);
            result.put("batteryStartPct", startPct < 0 ? null : startPct);
            result.put("batteryDropPct", startPct < 0 ? null : drop);
            result.put("batteryDrainPctPerHour", duration > 0 ? drop * 3_600_000d / duration : null);
            result.put("charging", battery.charging);
            result.put("batteryOptimizationIgnored", power != null && power.isIgnoringBatteryOptimizations(getContext().getPackageName()));
            result.put("profile", prefs().getString("profile", null));
            call.resolve(result);
        } catch (Exception error) { call.reject("진단 정보를 읽지 못했습니다.", error); }
    }

    @PluginMethod public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent); call.resolve();
    }

    @Override protected void handleOnPause() { db.event(activeId(), "app_background", "activity lifecycle"); }
    @Override protected void handleOnResume() { db.event(activeId(), "app_foreground", "activity lifecycle"); }

    private void startService(String activityId, String profile) {
        Intent intent = new Intent(getContext(), StepLinkLocationService.class).setAction(StepLinkLocationService.ACTION_START)
            .putExtra(StepLinkLocationService.EXTRA_ACTIVITY_ID, activityId).putExtra(StepLinkLocationService.EXTRA_PROFILE, profile);
        ContextCompat.startForegroundService(getContext(), intent);
    }

    private void rememberStart(String activityId, String profile) {
        Battery battery = battery();
        prefs().edit().putString("activityId", activityId).putString("profile", profile).putBoolean("serviceActive", true)
            .putLong("batteryStartedAt", System.currentTimeMillis()).putInt("batteryStartPct", battery.percent).apply();
        db.event(activityId, "battery_start", battery.percent + ":" + battery.charging);
    }

    private void recordBatteryEnd(String activityId) {
        Battery battery = battery(); db.event(activityId, "battery_end", battery.percent + ":" + battery.charging);
    }

    private String activeId() { return prefs().getString("activityId", null); }
    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    private Battery battery() {
        BatteryManager manager = (BatteryManager) getContext().getSystemService(Context.BATTERY_SERVICE);
        int percent = manager == null ? -1 : manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        Intent state = getContext().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        int status = state == null ? -1 : state.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        return new Battery(percent, status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);
    }
    private static final class Battery { final int percent; final boolean charging; Battery(int percent, boolean charging) { this.percent = percent; this.charging = charging; } }
}
