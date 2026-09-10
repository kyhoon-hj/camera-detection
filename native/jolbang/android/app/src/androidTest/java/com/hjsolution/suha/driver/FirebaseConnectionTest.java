package com.hjsolution.suha.driver;

import android.content.pm.PackageManager;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.firebase.FirebaseApp;
import com.google.firebase.analytics.FirebaseAnalytics;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.EnumMap;
import static org.junit.Assert.*;

/** Optional synthetic DebugView probe; never changes the user's saved analytics choice. */
@RunWith(AndroidJUnit4.class)
public class FirebaseConnectionTest {
    @Test public void configuredProjectAndOptionalDebugTransport() throws Exception {
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.hjsolution.jolbang", context.getPackageName());
        if (FirebaseApp.getApps(context).isEmpty()) FirebaseApp.initializeApp(context);
        var app = FirebaseApp.getInstance();
        assertEquals("wake-drive", app.getOptions().getProjectId());
        assertEquals("1:331472726742:android:24e40bc115535e5fb83777", app.getOptions().getApplicationId());
        var metadata = context.getPackageManager().getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA).metaData;
        assertFalse(metadata.getBoolean("firebase_analytics_collection_enabled", true));
        assertFalse(metadata.getBoolean("google_analytics_adid_collection_enabled", true));
        if (!"true".equals(InstrumentationRegistry.getArguments().getString("sendDebugEvent"))) return;
        var analytics = FirebaseAnalytics.getInstance(context);
        var consent = new EnumMap<FirebaseAnalytics.ConsentType,FirebaseAnalytics.ConsentStatus>(FirebaseAnalytics.ConsentType.class);
        for (var type : FirebaseAnalytics.ConsentType.values()) consent.put(type,FirebaseAnalytics.ConsentStatus.DENIED);
        boolean previous = context.getSharedPreferences("wake_drive_analytics",0).getBoolean("enabled",false);
        try {
            consent.put(FirebaseAnalytics.ConsentType.ANALYTICS_STORAGE,FirebaseAnalytics.ConsentStatus.GRANTED);
            analytics.setConsent(consent); analytics.setAnalyticsCollectionEnabled(true);
            var params = new android.os.Bundle(); params.putString("verification_source","android_instrumentation");
            analytics.logEvent("integration_check",params);
            System.out.println("Firebase synthetic integration_check queued for DebugView; this does not verify user camera or ad flows.");
            Thread.sleep(60000);
        } finally {
            consent.put(FirebaseAnalytics.ConsentType.ANALYTICS_STORAGE,previous ? FirebaseAnalytics.ConsentStatus.GRANTED : FirebaseAnalytics.ConsentStatus.DENIED);
            analytics.setConsent(consent); analytics.setAnalyticsCollectionEnabled(previous);
        }
    }
}
