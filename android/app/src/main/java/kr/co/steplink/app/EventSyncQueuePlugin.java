package kr.co.steplink.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "EventSyncQueue")
public class EventSyncQueuePlugin extends Plugin {
    private StepLinkDatabase db;
    @Override public void load() { db = new StepLinkDatabase(getContext()); }

    @PluginMethod public void enqueueLatest(PluginCall call) {
        String kind = call.getString("kind"), key = call.getString("idempotencyKey"), latest = call.getString("latestWinsKey");
        JSObject payload = call.getObject("payload");
        if (kind == null || key == null || latest == null || payload == null) { call.reject("sync queue 필드가 누락되었습니다."); return; }
        try { db.enqueueLatestSync(kind, key, latest, payload.toString()); call.resolve(); }
        catch (Exception error) { call.reject("최신 상태를 queue에 저장하지 못했습니다.", error); }
    }

    @PluginMethod public void enqueueDurable(PluginCall call) {
        String kind = call.getString("kind"), key = call.getString("idempotencyKey"); JSObject payload = call.getObject("payload");
        if (kind == null || key == null || payload == null) { call.reject("sync queue 필드가 누락되었습니다."); return; }
        try { db.enqueueDurableSync(kind, key, payload.toString()); call.resolve(); }
        catch (Exception error) { call.reject("중요 이벤트를 queue에 저장하지 못했습니다.", error); }
    }

    @PluginMethod public void ready(PluginCall call) {
        try { JSObject result = new JSObject(); result.put("items", db.readySyncItems(call.getInt("limit", 10))); call.resolve(result); }
        catch (Exception error) { call.reject("sync queue를 읽지 못했습니다.", error); }
    }
    @PluginMethod public void complete(PluginCall call) { Long id = call.getLong("id"); if (id == null) call.reject("id가 필요합니다."); else { db.completeSyncItem(id); call.resolve(); } }
    @PluginMethod public void retry(PluginCall call) { Long id = call.getLong("id"), next = call.getLong("nextAttemptAt"); if (id == null || next == null) call.reject("retry 필드가 필요합니다."); else { db.retrySyncItem(id, next); call.resolve(); } }
    @PluginMethod public void terminal(PluginCall call) { Long id = call.getLong("id"); String reason = call.getString("reason", "terminal_error"); if (id == null) call.reject("id가 필요합니다."); else { db.terminalSyncItem(id, reason); call.resolve(); } }
    @PluginMethod public void discardLatest(PluginCall call) { String key = call.getString("latestWinsKey"); if (key == null) call.reject("latestWinsKey가 필요합니다."); else { db.discardLatestSync(key); call.resolve(); } }
    @PluginMethod public void reconcileScope(PluginCall call) {
        String eventId = call.getString("eventId"), participantId = call.getString("participantId");
        if (eventId == null || participantId == null) { call.reject("행사 참가자 scope가 필요합니다."); return; }
        db.scopeOperationalQueue(eventId, participantId, "session_scope_changed"); call.resolve();
    }

    @PluginMethod public void configureLiveSync(PluginCall call) {
        String url = call.getString("supabaseUrl"), anonKey = call.getString("anonKey");
        String eventId = call.getString("eventId"), participantId = call.getString("participantId");
        Long intervalMs = call.getLong("intervalMs", EventLiveSyncManager.DEFAULT_INTERVAL_MS);
        if (url == null || anonKey == null || eventId == null || participantId == null) { call.reject("background live sync 설정이 누락되었습니다."); return; }
        try {
            if (db.activeEventActivityId(eventId, participantId) == null) {
                call.reject("행사에 연결된 active activity가 없어 live sync를 시작할 수 없습니다."); return;
            }
            EventLiveSyncManager.configure(getContext(), url, anonKey, eventId, participantId, intervalMs);
            StepLinkLocationService.requestEventSyncRefresh(getContext(), true);
            call.resolve();
        }
        catch (Exception error) { call.reject("background live sync를 설정하지 못했습니다.", error); }
    }

    @PluginMethod public void disableLiveSync(PluginCall call) {
        EventLiveSyncManager.disable(getContext(), db);
        StepLinkLocationService.requestEventSyncRefresh(getContext(), false);
        call.resolve();
    }

    @PluginMethod public void getLiveSyncStatus(PluginCall call) {
        try { call.resolve(JSObject.fromJSONObject(EventLiveSyncManager.diagnostics(getContext(), db))); }
        catch (Exception error) { call.reject("live sync 상태를 읽지 못했습니다.", error); }
    }
}
