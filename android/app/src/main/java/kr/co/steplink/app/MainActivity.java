package kr.co.steplink.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(NativeGpsPlugin.class);
        registerPlugin(SecureEventSessionPlugin.class);
        registerPlugin(EventSyncQueuePlugin.class);
        registerPlugin(AppUiPlugin.class);
        super.onCreate(state);
    }

    @Override
    public void onBackPressed() {
        getBridge().getWebView().evaluateJavascript("window.dispatchEvent(new Event('steplink:back'))", null);
    }
}
