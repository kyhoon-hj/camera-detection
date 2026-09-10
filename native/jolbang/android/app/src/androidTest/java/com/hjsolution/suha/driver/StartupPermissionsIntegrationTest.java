package com.hjsolution.suha.driver;

import android.accessibilityservice.AccessibilityService;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.WindowManager;
import android.app.KeyguardManager;
import android.content.Context;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.Before;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Actual installed WebView/camera and OS settings; does not capture faces or test drowsiness accuracy. */
@RunWith(AndroidJUnit4.class)
public class StartupPermissionsIntegrationTest {
    private MainActivity activity;
    @Before public void requiresUnlockedDevice() {
        var context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertFalse("Unlock the phone before device UI verification",((KeyguardManager)context.getSystemService(Context.KEYGUARD_SERVICE)).isKeyguardLocked());
    }
    private String js(String script) throws Exception {
        AtomicReference<String> result=new AtomicReference<>();
        CountDownLatch latch=new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.getBridge().getWebView().evaluateJavascript(script,value->{result.set(value);latch.countDown();}));
        assertTrue("WebView response timeout",latch.await(12,TimeUnit.SECONDS));
        return result.get();
    }
    private void until(String description,String predicate,long timeout) throws Exception {
        long end=SystemClock.elapsedRealtime()+timeout;
        while(SystemClock.elapsedRealtime()<end) {
            if("true".equals(js(predicate))) return;
            Thread.sleep(500);
        }
        fail(description+": "+js("document.body.innerText.slice(-2200)"));
    }
    private AccessibilityNodeInfo findText(String text,long timeout) throws Exception {
        long end=SystemClock.elapsedRealtime()+timeout;
        while(SystemClock.elapsedRealtime()<end) {
            var root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
            if(root!=null) {
                var nodes=root.findAccessibilityNodeInfosByText(text);
                if(!nodes.isEmpty()) return nodes.get(0);
            }
            Thread.sleep(300);
        }
        fail("Missing native text: "+text); return null;
    }
    @Test public void disabledCameraShowsLaunchPopupAndOpensAppSettings() throws Exception {
        // Runner must start with CAMERA revoked, and restore the original permission afterwards.
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(value->{activity=value;
                value.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                assertFalse(((DriverPermissionsPlugin)value.getBridge().getPlugin("DriverPermissions").getInstance()).status().optBoolean("camera"));
            });
            findText("카메라 권한이 꺼져 있어요",15000);
            var button=findText("설정으로 이동",3000);
            assertTrue(button.performAction(AccessibilityNodeInfo.ACTION_CLICK));
            long end=SystemClock.elapsedRealtime()+10000;
            boolean settings=false;
            while(SystemClock.elapsedRealtime()<end) {
                var root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
                if(root!=null && "com.android.settings".contentEquals(root.getPackageName())) {settings=true;break;}
                Thread.sleep(300);
            }
            assertTrue("Real phone Settings opens",settings);
            findText("Wake Drive",5000);
            InstrumentationRegistry.getInstrumentation().getUiAutomation().performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK);
            findText("카메라 권한이 꺼져 있어요",10000);
        }
    }
    @Test public void confirmationAndInlineStartBothStartRealCamera() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(value->{activity=value;value.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);});
            until("App loaded","!!document.querySelector('main')",30000);
            // Use the existing public monitor URL; ad completion itself is outside this focused test.
            scenario.onActivity(value->value.getBridge().getWebView().loadUrl("https://localhost/?mode=DROWSINESS"));
            Thread.sleep(1500);
            until("Monitor loaded","!!document.querySelector('.controls .primary')",30000);
            js("document.querySelector('.first-run-notice>button')?.click();document.querySelector('.controls .primary')?.click();");
            until("Safety confirmation","!!document.querySelector('.safety-confirm')",5000);
            js("document.querySelector('.safety-confirm').click()");
            until("Actual camera and model initialization","document.querySelector('.camera-stage')?.dataset.runState==='running'",65000);
            until("Frames advance","document.querySelector('.camera-stage>video').currentTime>2",10000);
            System.out.println("STARTUP_EVIDENCE: confirm -> RUNNING; video frames advancing");
            js("document.querySelector('.controls .primary.stop').click()");
            until("Camera stopped","document.querySelector('.camera-stage>video').srcObject===null",5000);
            js("document.querySelector('.controls .primary').click()");
            until("Inline start retries correctly","document.querySelector('.camera-stage')?.dataset.runState==='running'",65000);
            assertEquals("\"static\"",js("getComputedStyle(document.querySelector('.controls')).position"));
            js("document.querySelector('.controls .primary.stop').click()");
            until("Camera released","document.querySelector('.camera-stage>video').srcObject===null",5000);
            System.out.println("STARTUP_EVIDENCE: inline start -> RUNNING -> STOP; controls static");
        }
    }
}
