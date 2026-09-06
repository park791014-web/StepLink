package kr.co.steplink.app;

import android.content.pm.ActivityInfo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "AppUi")
public class AppUiPlugin extends Plugin {
    @PluginMethod
    public void setOrientation(PluginCall call) {
        String mode = call.getString("mode", "PORTRAIT");
        getActivity().runOnUiThread(() -> {
            int orientation = "FLEXIBLE".equals(mode)
                ? ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
            getActivity().setRequestedOrientation(orientation);
            call.resolve(new JSObject());
        });
    }

    @PluginMethod
    public void exitApp(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            call.resolve(new JSObject());
            getActivity().finish();
        });
    }
}
