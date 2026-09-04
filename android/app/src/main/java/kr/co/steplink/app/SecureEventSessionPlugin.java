package kr.co.steplink.app;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

@CapacitorPlugin(name = "SecureEventSession")
public class SecureEventSessionPlugin extends Plugin {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "steplink_event_session_key_v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
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
            String ciphertext = encrypt(secrets.toString());
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
                db.clearEventSession(eventId);
                result.put("session", JSONObject.NULL); result.put("recoveryRequired", true); result.put("error", "암호화된 세션이 없습니다."); call.resolve(result); return;
            }
            JSONObject session = new JSONObject();
            session.put("eventId", eventId); session.put("eventName", stored.optString("eventName", "행사"));
            session.put("role", stored.getString("role")); session.put("status", stored.getString("status"));
            session.put("subjectId", stored.optString("subjectId", "")); session.put("metadata", stored.opt("metadata"));
            session.put("savedAt", stored.opt("savedAt")); session.put("secrets", new JSONObject(decrypt(ciphertext)));
            result.put("session", session); result.put("recoveryRequired", false); call.resolve(result);
        } catch (Exception error) {
            try { db.clearEventSession(null); } catch (Exception ignored) { }
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
        db.clearEventSession(call.getString("eventId")); call.resolve();
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE); store.load(null);
        SecretKey existing = (SecretKey) store.getKey(KEY_ALIAS, null);
        if (existing != null) return existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }

    private String encrypt(String plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION); cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        JSONObject envelope = new JSONObject();
        envelope.put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
        envelope.put("data", Base64.encodeToString(cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
        return envelope.toString();
    }

    private String decrypt(String encoded) throws Exception {
        JSONObject envelope = new JSONObject(encoded);
        byte[] iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP);
        byte[] data = Base64.decode(envelope.getString("data"), Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance(TRANSFORMATION); cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(data), StandardCharsets.UTF_8);
    }
}
