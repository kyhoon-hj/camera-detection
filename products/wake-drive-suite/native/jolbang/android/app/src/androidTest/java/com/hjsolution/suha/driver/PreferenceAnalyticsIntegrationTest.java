package com.hjsolution.suha.driver;

import android.app.KeyguardManager;
import android.content.Context;
import android.os.SystemClock;
import android.view.WindowManager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Exercises the installed production WebView handlers and real MP4, no synthetic watch events. */
@RunWith(AndroidJUnit4.class)
public class PreferenceAnalyticsIntegrationTest {
    private MainActivity activity;
    private String js(String source) throws Exception {
        var result=new AtomicReference<String>();var latch=new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.getBridge().getWebView().evaluateJavascript(source,value->{result.set(value);latch.countDown();}));
        assertTrue("WebView responds",latch.await(10,TimeUnit.SECONDS));return result.get();
    }
    private void until(String predicate,long timeout) throws Exception {
        long end=SystemClock.elapsedRealtime()+timeout;
        while(SystemClock.elapsedRealtime()<end) {if("true".equals(js(predicate))) return;Thread.sleep(300);}
        fail("Timed out waiting for test predicate: "+predicate);
    }
    @Test public void nativePreferenceAllowlist() {
        assertTrue(DriverAnalyticsPlugin.validProperty("applied_video","video-10"));
        assertTrue(DriverAnalyticsPlugin.validProperty("playback_mode","RANDOM_OWNED"));
        assertFalse(DriverAnalyticsPlugin.validProperty("applied_video","video-99"));
        assertFalse(DriverAnalyticsPlugin.validProperty("sound_mode","private-personal-text"));
        assertFalse(DriverAnalyticsPlugin.validProperty("email","person@example.com"));
    }
    @Test public void actualSettingsAndPreviewExit() throws Exception {
        var context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertFalse("Unlock phone for actual UI playback test",((KeyguardManager)context.getSystemService(Context.KEYGUARD_SERVICE)).isKeyguardLocked());
        assertTrue("Enable analytics in app before transport test",context.getSharedPreferences("wake_drive_analytics",0).getBoolean("enabled",false));
        try(var scenario=ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(value->{activity=value;value.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);value.getBridge().getWebView().loadUrl("https://localhost/");});
            until("!!document.querySelector('.pop-library')",30000);
            String before=js("document.querySelector('.wake-sound-pill').getAttribute('aria-pressed')");
            try {
                js("document.querySelector('.wake-sound-pill').click()");Thread.sleep(800);
                assertNotEquals(before,js("document.querySelector('.wake-sound-pill').getAttribute('aria-pressed')"));
                js("document.querySelector('[data-analytics-action=filter_owned]').click()");Thread.sleep(500);
                js("document.querySelector('.pop-video-card[data-video-id=\"video-0\"]').scrollIntoView({block:'center'})");Thread.sleep(1000);
                js("document.querySelector('.pop-video-card[data-video-id=\"video-0\"] .pop-thumbnail').click()");
                until("!!document.querySelector('.pop-preview-dialog[open] video') && document.querySelector('.pop-preview-dialog video').currentTime>2 && !document.querySelector('.pop-preview-dialog video').paused",15000);
                System.out.println("PREFERENCE_UI: actual MP4 advancing "+js("document.querySelector('.pop-preview-dialog video').currentTime"));
                js("document.querySelector('.pop-preview-dialog header button').click()");
                until("!document.querySelector('.pop-preview-dialog')",5000);
                System.out.println("PREFERENCE_UI: settings changed, owned filter, visible video card, actual preview, mid-play close verified");
            } finally {
                js("document.querySelector('.pop-preview-dialog header button')?.click()");
                if(!before.equals(js("document.querySelector('.wake-sound-pill').getAttribute('aria-pressed')"))) js("document.querySelector('.wake-sound-pill').click()");
                js("document.querySelector('[data-analytics-action=filter_all]').click()");
            }
            assertEquals(before,js("document.querySelector('.wake-sound-pill').getAttribute('aria-pressed')"));
            Thread.sleep(15000);
        }
    }
}
