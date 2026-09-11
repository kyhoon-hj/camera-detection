package com.hjsolution.suha.driver;

import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.PictureInPictureUiState;
import android.app.RemoteAction;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.drawable.Icon;
import android.util.Rational;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginHandle;
import java.util.Collections;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    String localized(String korean, String english) {
        String language=getSharedPreferences("wake_drive_locale",Context.MODE_PRIVATE).getString("language",java.util.Locale.getDefault().getLanguage());
        return "ko".equals(language)?korean:english;
    }
    private final Handler pipHandler = new Handler(Looper.getMainLooper());
    private boolean monitoring = false;
    private boolean pipEnabled = true;
    private boolean visible = false;
    private long transitionUntil = 0;
    private long rotationGraceUntil = 0;
    private long lastHeartbeat = 0;
    private String stopReason = "";
    private String stopAction() { return getPackageName() + ".STOP_PIP_MONITOR"; }
    private final BroadcastReceiver stopReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (stopAction().equals(intent.getAction())) stopPipMonitoring("user");
        }
    };
    private final Runnable watchdog = new Runnable() {
        @Override public void run() {
            if (monitoring && SystemClock.elapsedRealtime() - lastHeartbeat > 8000) stopPipMonitoring("stalled");
            pipHandler.postDelayed(this, 1000);
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeSpeechPlugin.class);
        registerPlugin(DisplayControlPlugin.class);
        registerPlugin(DriverPipPlugin.class);
        registerPlugin(DriverPermissionsPlugin.class);
        super.onCreate(savedInstanceState);
        bridge.getWebView().getSettings().setGeolocationEnabled(false);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(stopReceiver, new IntentFilter(stopAction()), Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(stopReceiver, new IntentFilter(stopAction()));
        pipHandler.postDelayed(watchdog, 1000);
    }

    boolean supportsDriverPip() {
        return Build.VERSION.SDK_INT >= 26 && getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    JSObject pipState() {
        JSObject result = new JSObject();
        result.put("supported", supportsDriverPip());
        result.put("active", Build.VERSION.SDK_INT >= 26 && isInPictureInPictureMode());
        result.put("transitioning", monitoring && SystemClock.elapsedRealtime() < transitionUntil);
        result.put("rotationGrace", SystemClock.elapsedRealtime() < rotationGraceUntil);
        result.put("visible", visible);
        result.put("monitoring", monitoring);
        result.put("stopReason", stopReason);
        return result;
    }

    private void publishPipState() {
        if (bridge == null) return;
        PluginHandle handle = bridge.getPlugin("DriverPip");
        if (handle != null) ((DriverPipPlugin) handle.getInstance()).publish(pipState());
    }

    void setPipSession(boolean running, boolean enabled) {
        // 늦게 도착한 JS 응답으로 숨겨진 앱의 카메라 세션을 다시 활성화하지 않는다.
        if (running && !visible) return;
        if (running && !monitoring) { lastHeartbeat = SystemClock.elapsedRealtime(); stopReason = ""; }
        monitoring = running;
        pipEnabled = enabled;
        if (!running) { transitionUntil = 0; stopReason = ""; }
        updatePipParams();
        publishPipState();
        if (!running && Build.VERSION.SDK_INT >= 26 && isInPictureInPictureMode()) finish();
    }

    void pipHeartbeat() { if (monitoring) lastHeartbeat = SystemClock.elapsedRealtime(); }

    private PictureInPictureParams buildPipParams() {
        Intent intent = new Intent(stopAction()).setPackage(getPackageName());
        PendingIntent pending = PendingIntent.getBroadcast(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        RemoteAction stop = new RemoteAction(Icon.createWithResource(this, R.drawable.ic_wake_stop), localized("측정 종료", "Stop detection"), localized("졸음 측정 종료", "Stop drowsiness detection"), pending);
        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder()
            .setAspectRatio(new Rational(4, 3)).setActions(Collections.singletonList(stop));
        if (Build.VERSION.SDK_INT >= 31) builder.setAutoEnterEnabled(monitoring && pipEnabled).setSeamlessResizeEnabled(false);
        if (Build.VERSION.SDK_INT >= 33) builder.setTitle(localized("Wake Drive · 졸음 감지", "Wake Drive · Drowsiness detection"));
        return builder.build();
    }

    private void updatePipParams() {
        if (!supportsDriverPip()) return;
        try { setPictureInPictureParams(buildPipParams()); } catch (IllegalStateException | IllegalArgumentException ignored) { }
    }

    private void preparePip() {
        transitionUntil = SystemClock.elapsedRealtime() + 2000;
        rotationGraceUntil = transitionUntil + 1000;
        publishPipState();
        pipHandler.postDelayed(() -> {
            publishPipState();
        }, 2100);
    }

    boolean enterDriverPip() {
        if (!supportsDriverPip() || !monitoring || !pipEnabled || !visible) return false;
        if (isInPictureInPictureMode()) return true;
        preparePip();
        try {
            boolean entered = enterPictureInPictureMode(buildPipParams());
            if (entered) return true;
        } catch (IllegalStateException | IllegalArgumentException ignored) { }
        transitionUntil = 0;
        publishPipState();
        return false;
    }

    @Override protected void onUserLeaveHint() {
        if (monitoring && pipEnabled && supportsDriverPip()) {
            preparePip();
            if (Build.VERSION.SDK_INT < 31) enterDriverPip();
        }
        super.onUserLeaveHint();
    }

    @Override public void onPictureInPictureUiStateChanged(PictureInPictureUiState state) {
        super.onPictureInPictureUiStateChanged(state);
        if (Build.VERSION.SDK_INT >= 35 && state.isTransitioningToPip()) preparePip();
    }

    @Override public void onPictureInPictureModeChanged(boolean inPip, Configuration config) {
        super.onPictureInPictureModeChanged(inPip, config);
        transitionUntil = 0;
        rotationGraceUntil = SystemClock.elapsedRealtime() + 2000;
        if (inPip && bridge != null) bridge.getWebView().onResume();
        publishPipState();
    }

    @Override public void onStart() { super.onStart(); visible = true; publishPipState(); }
    @Override public void onResume() {
        super.onResume();
        visible = true;
        transitionUntil = 0;
        publishPipState();
        pipHandler.postDelayed(() -> {
            if(!visible || isFinishing() || (Build.VERSION.SDK_INT>=26 && isInPictureInPictureMode())) return;
            PluginHandle handle=bridge.getPlugin("DriverPermissions");
            if(handle!=null) ((DriverPermissionsPlugin)handle.getInstance()).checkOnResume();
        }, 350);
    }

    private void stopPipMonitoring(String reason) {
        if (!monitoring) return;
        monitoring = false;
        stopReason = reason;
        transitionUntil = 0;
        updatePipParams();
        // JS 이벤트 수신 여부와 관계없이 현재 WebView의 카메라 트랙부터 해제한다.
        if (bridge != null) bridge.getWebView().evaluateJavascript(
            "document.querySelectorAll('video').forEach(v=>{if(v.srcObject){v.srcObject.getTracks().forEach(t=>t.stop());v.srcObject=null;}v.pause();});", null);
        publishPipState();
        if (Build.VERSION.SDK_INT >= 26 && isInPictureInPictureMode()) finish();
    }

    @Override public void onStop() {
        visible = false;
        stopPipMonitoring("hidden");
        publishPipState();
        super.onStop();
    }

    @Override public void onDestroy() {
        pipHandler.removeCallbacksAndMessages(null);
        unregisterReceiver(stopReceiver);
        super.onDestroy();
    }
}
