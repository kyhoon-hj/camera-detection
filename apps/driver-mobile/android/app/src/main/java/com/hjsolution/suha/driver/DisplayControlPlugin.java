package com.hjsolution.suha.driver;

import android.content.pm.ActivityInfo;
import android.graphics.Insets;
import android.os.Build;
import android.view.WindowInsets;
import android.view.View;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DisplayControl")
public class DisplayControlPlugin extends Plugin {

    @PluginMethod
    public void getSafeAreaInsets(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            View decorView = getActivity().getWindow().getDecorView();
            WindowInsets windowInsets = decorView.getRootWindowInsets();
            float density = getContext().getResources().getDisplayMetrics().density;
            int left = 0;
            int top = 0;
            int right = 0;
            int bottom = 0;
            if (windowInsets != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Insets insets = windowInsets.getInsets(
                        WindowInsets.Type.navigationBars() | WindowInsets.Type.displayCutout()
                    );
                    left = insets.left;
                    top = insets.top;
                    right = insets.right;
                    bottom = insets.bottom;
                } else {
                    left = windowInsets.getStableInsetLeft();
                    top = windowInsets.getStableInsetTop();
                    right = windowInsets.getStableInsetRight();
                    bottom = windowInsets.getStableInsetBottom();
                }
            }
            JSObject result = new JSObject();
            result.put("left", left / density);
            result.put("top", top / density);
            result.put("right", right / density);
            result.put("bottom", bottom / density);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void lockCurrentOrientation(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LOCKED);
            call.resolve();
        });
    }

    @PluginMethod
    public void unlockOrientation(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR);
            call.resolve();
        });
    }
}
