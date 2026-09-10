package com.hjsolution.suha.driver;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import com.google.firebase.analytics.FirebaseAnalytics;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.EnumMap;
import java.util.Iterator;

@CapacitorPlugin(name = "DriverAnalytics")
public class DriverAnalyticsPlugin extends Plugin {
    private FirebaseAnalytics analytics;
    private SharedPreferences preferences;
    private static final Set<String> EVENTS = new HashSet<>(Arrays.asList("app_open","screen_view","ui_click","video_select","video_apply","reward_unlock_start","reward_ad_result","video_unlocked","video_unlock_error","video_play_start","video_play_complete","video_play_error","drive_start","drive_progress","drive_end","drive_warning","preferences_snapshot","setting_change","video_impression","library_filter","video_play_exit","video_watch_progress","detection_start_result","ad_request","ad_shown","ad_failed","ad_reward_earned"));
    private static final Set<String> PARAMS = new HashSet<>(Arrays.asList("screen_name","screen_class","action","video_id","context","reason","outcome","playback_seconds","measured_seconds","speed_valid_seconds","speed_sum","max_kmh","speed_0_10_seconds","speed_10_40_seconds","speed_40_80_seconds","speed_80_plus_seconds","applied_video","playback_mode","sound_mode","pip_mode","library_size_band","setting_name","setting_value","filter","ownership","watched_seconds","watch_percent","milestone","startup_seconds","failure_stage","ad_format","ad_placement","ad_test"));
    private static final Set<String> PROPERTY_NAMES = new HashSet<>(Arrays.asList("applied_video","playback_mode","sound_mode","pip_mode","library_size_band"));
    static boolean validProperty(String name, String value) {
        if (value == null) return false;
        switch(name) {
            case "applied_video": return value.matches("video-([0-9]|10)");
            case "playback_mode": return value.equals("APPLIED") || value.equals("RANDOM_OWNED");
            case "sound_mode": return value.equals("on") || value.equals("off");
            case "pip_mode": return value.equals("on") || value.equals("off") || value.equals("unsupported");
            case "library_size_band": return value.equals("one") || value.equals("two_to_five") || value.equals("six_plus");
            default: return false;
        }
    }
    @PluginMethod public void setPreferences(PluginCall call) {
        if (analytics == null || !preferences.getBoolean("enabled", false)) { call.resolve(); return; }
        JSObject values = call.getObject("properties",new JSObject());
        for (String name : PROPERTY_NAMES) {
            Object value = values.opt(name);
            if (value instanceof String && validProperty(name,(String)value)) analytics.setUserProperty(name,(String)value);
        }
        call.resolve();
    }
    @Override public void load() {
        preferences = getContext().getSharedPreferences("wake_drive_analytics", Context.MODE_PRIVATE);
        if (!FirebaseApp.getApps(getContext()).isEmpty()) {
            analytics = FirebaseAnalytics.getInstance(getContext());
            applyConsent(preferences.getBoolean("enabled", false));
        }
    }
    private void applyConsent(boolean enabled) {
        if (analytics == null) return;
        EnumMap<FirebaseAnalytics.ConsentType,FirebaseAnalytics.ConsentStatus> consent = new EnumMap<>(FirebaseAnalytics.ConsentType.class);
        consent.put(FirebaseAnalytics.ConsentType.ANALYTICS_STORAGE, enabled ? FirebaseAnalytics.ConsentStatus.GRANTED : FirebaseAnalytics.ConsentStatus.DENIED);
        consent.put(FirebaseAnalytics.ConsentType.AD_STORAGE, FirebaseAnalytics.ConsentStatus.DENIED);
        consent.put(FirebaseAnalytics.ConsentType.AD_USER_DATA, FirebaseAnalytics.ConsentStatus.DENIED);
        consent.put(FirebaseAnalytics.ConsentType.AD_PERSONALIZATION, FirebaseAnalytics.ConsentStatus.DENIED);
        analytics.setConsent(consent);
        analytics.setAnalyticsCollectionEnabled(enabled);
    }
    private JSObject status() {
        JSObject result = new JSObject();
        result.put("configured", analytics != null);
        result.put("enabled", analytics != null && preferences.getBoolean("enabled", false));
        result.put("decided", preferences.contains("enabled"));
        return result;
    }
    @PluginMethod public void getStatus(PluginCall call) { call.resolve(status()); }
    @PluginMethod public void setEnabled(PluginCall call) {
        if (analytics == null) { call.resolve(status()); return; }
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        applyConsent(enabled);
        preferences.edit().putBoolean("enabled", enabled).apply();
        if (!enabled) { for (String name : PROPERTY_NAMES) analytics.setUserProperty(name, null); analytics.resetAnalyticsData(); }
        call.resolve(status());
    }
    @PluginMethod public void logEvent(PluginCall call) {
        if (analytics == null || !preferences.getBoolean("enabled", false)) { call.resolve(); return; }
        String name = call.getString("name", "");
        if (!EVENTS.contains(name)) { call.reject("Unsupported analytics event"); return; }
        Bundle bundle = new Bundle();
        JSObject params = call.getObject("params", new JSObject());
        Iterator<String> keys = params.keys();
        while (keys.hasNext()) {
            String key = keys.next(); Object value = params.opt(key);
            if (!PARAMS.contains(key)) continue;
            if (value instanceof Number) {
                double number = ((Number)value).doubleValue();
                if (Double.isFinite(number) && number >= 0) bundle.putDouble(key,number);
            } else if (value instanceof String && ((String)value).matches("[A-Za-z0-9_-]{1,80}")) bundle.putString(key,(String)value);
        }
        analytics.logEvent(name,bundle); call.resolve();
    }
}
