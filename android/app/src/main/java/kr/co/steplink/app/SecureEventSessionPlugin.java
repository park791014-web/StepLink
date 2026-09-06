package kr.co.steplink.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "SecureEventSession")
public class SecureEventSessionPlugin extends Plugin {
    private StepLinkDatabase db;

    @Override public void load() { db = new StepLinkDatabase(getContext()); }

    @PluginMethod public void save(PluginCall call) {
        String eventId = call.getString("eventId");
        String eventName = call.getString("eventName");
        String role = call.getString("role");
        String status = call.getString("status");
        String subjectId = call.getString("subjectId");
        JSObject secrets = call.getObject("secrets");
        JSObject metadata = call.getObject("metadata", new JSObject());
        if (eventId == null || eventName == null || role == null || status == null || subjectId == null || secrets == null) {
            call.reject("행사 세션 필드가 누락되었습니다."); return;
        }
        if (!("OWNER".equals(role) || "OPERATOR".equals(role) || "PARTICIPANT".equals(role))) {
            call.reject("지원하지 않는 행사 역할입니다."); return;
        }
        try {
            String ciphertext = SecureEventSessionCrypto.encrypt(secrets.toString());
            db.saveEventSession(eventId, eventName, role, status, subjectId, ciphertext, "ANDROID_KEYSTORE_AES_GCM_V1", metadata.toString());
            call.resolve();
        } catch (Exception error) { call.reject("행사 세션을 안전하게 저장하지 못했습니다.", error); }
    }

    @PluginMethod public void loadSession(PluginCall call) {
        try {
            JSONObject stored = db.latestEventSession();
            JSObject result = new JSObject();
            if (stored == null) {
                result.put("session", JSONObject.NULL); result.put("recoveryRequired", false); call.resolve(result); return;
            }
            String eventId = stored.getString("eventId");
            String ciphertext = stored.optString("ciphertext", "");
            if (ciphertext.isEmpty()) {
                EventLiveSyncManager.disable(getContext(), db);
                StepLinkLocationService.requestEventSyncRefresh(getContext(), false);
                endParticipantContext(stored);
                db.clearEventSession(eventId);
                result.put("session", JSONObject.NULL); result.put("recoveryRequired", true); result.put("error", "암호화된 세션이 없습니다."); call.resolve(result); return;
            }
            JSONObject session = new JSONObject();
            session.put("eventId", eventId); session.put("eventName", stored.optString("eventName", "행사"));
            session.put("role", stored.getString("role")); session.put("status", stored.getString("status"));
            session.put("subjectId", stored.optString("subjectId", "")); session.put("metadata", stored.opt("metadata"));
            session.put("savedAt", stored.opt("savedAt")); session.put("secrets", new JSONObject(SecureEventSessionCrypto.decrypt(ciphertext)));
            result.put("session", session); result.put("recoveryRequired", false); call.resolve(result);
        } catch (Exception error) {
            try {
                EventLiveSyncManager.disable(getContext(), db);
                StepLinkLocationService.requestEventSyncRefresh(getContext(), false);
                endParticipantContext(db.latestEventSession());
                db.clearEventSession(null);
            } catch (Exception ignored) { }
            JSObject result = new JSObject(); result.put("session", JSONObject.NULL); result.put("recoveryRequired", true);
            result.put("error", "Keystore 세션을 해독할 수 없어 로컬 세션을 정리했습니다."); call.resolve(result);
        }
    }

    @PluginMethod public void updateSnapshot(PluginCall call) {
        String eventId = call.getString("eventId");
        if (eventId == null) { call.reject("eventId가 필요합니다."); return; }
        JSObject metadata = call.getObject("metadata");
        db.updateEventSession(eventId, call.getString("eventName"), call.getString("status"), metadata == null ? null : metadata.toString());
        call.resolve();
    }

    @PluginMethod public void clear(PluginCall call) {
        EventLiveSyncManager.disable(getContext(), db);
        StepLinkLocationService.requestEventSyncRefresh(getContext(), false);
        try { endParticipantContext(db.latestEventSession()); }
        catch (Exception error) { call.reject("행사 activity context를 정리하지 못했습니다.", error); return; }
        db.clearEventSession(call.getString("eventId")); call.resolve();
    }

    private void endParticipantContext(JSONObject stored) throws Exception {
        if (stored == null || !"PARTICIPANT".equals(stored.optString("role"))) return;
        String eventId = stored.optString("eventId", ""), participantId = stored.optString("subjectId", "");
        if (eventId.isEmpty() || participantId.isEmpty()) return;
        JSONObject result = db.endEventActivityContext(eventId, participantId);
        if (result.optBoolean("endedActivity")) {
            getContext().getSharedPreferences("steplink_tracking_state", android.content.Context.MODE_PRIVATE).edit()
                .putBoolean("serviceActive", false).remove("activityId").apply();
            getContext().startService(new android.content.Intent(getContext(), StepLinkLocationService.class).setAction(StepLinkLocationService.ACTION_END));
        }
    }

}
