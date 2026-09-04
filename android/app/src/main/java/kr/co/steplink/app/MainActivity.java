package kr.co.steplink.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(NativeGpsPlugin.class);
        registerPlugin(SecureEventSessionPlugin.class);
        super.onCreate(state);
    }
}
