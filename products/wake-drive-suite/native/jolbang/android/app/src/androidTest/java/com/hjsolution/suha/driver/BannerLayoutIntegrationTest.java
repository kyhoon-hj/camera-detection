package com.hjsolution.suha.driver;

import android.content.pm.ActivityInfo;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** 실기기의 실제 AdMob 테스트 배너와 버튼 경계를 비교. 광고 클릭·카메라 권한 변경 없음. */
@RunWith(AndroidJUnit4.class)
public class BannerLayoutIntegrationTest {
    private MainActivity activity;
    private String js(String script) throws Exception {
        AtomicReference<String> value = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.getBridge().getWebView().evaluateJavascript(script, result -> { value.set(result); done.countDown(); }));
        assertTrue("JS 응답", done.await(8, TimeUnit.SECONDS));
        return value.get();
    }
    private void until(String predicate, long timeout) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + timeout;
        while (SystemClock.elapsedRealtime() < deadline) {
            if ("true".equals(js(predicate))) return;
            Thread.sleep(300);
        }
        fail("화면 조건 시간 초과: " + predicate);
    }
    private View adIn(View view) {
        if (view.getClass().getName().equals("com.google.android.gms.ads.AdView")) return view;
        if (view instanceof ViewGroup && !(view instanceof WebView)) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) { View ad = adIn(group.getChildAt(i)); if (ad != null) return ad; }
        }
        return null;
    }
    private JSONObject nativeBounds() {
        JSONObject result = new JSONObject();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            try {
                WebView web = activity.getBridge().getWebView();
                int[] xy = new int[2]; web.getLocationOnScreen(xy);
                result.put("webTop",xy[1]).put("webBottom",xy[1]+web.getHeight()).put("webWidth",web.getWidth());
                View ad = adIn((View) web.getParent());
                Rect rect = new Rect();
                result.put("adVisible",ad != null && ad.isShown() && ad.getGlobalVisibleRect(rect));
                result.put("adTop",rect.top).put("adBottom",rect.bottom);
            } catch (Exception e) { throw new RuntimeException(e); }
        });
        return result;
    }
    private void verifyAndCapture(String name) throws Exception {
        long deadline = SystemClock.elapsedRealtime()+60000;
        JSONObject bounds;
        long stableSince=0;
        do {
            bounds=nativeBounds();
            if (bounds.optBoolean("adVisible") && bounds.optInt("adBottom")>bounds.optInt("adTop") && bounds.optInt("webBottom")<bounds.optInt("adTop")) {
                if (stableSince==0) stableSince=SystemClock.elapsedRealtime();
                if (SystemClock.elapsedRealtime()-stableSince>2000) break;
            } else stableSince=0;
            Thread.sleep(300);
        } while(SystemClock.elapsedRealtime()<deadline);
        assertTrue("실제 광고 표시",bounds.getBoolean("adVisible"));
        assertEquals("\"static\"",js("getComputedStyle(document.querySelector('.controls')).position"));
        js("document.querySelector('.controls .primary').scrollIntoView({block:'center',behavior:'instant'})");
        Thread.sleep(300);
        bounds=nativeBounds();
        String geometry=js("(()=>{const b=document.querySelector('.controls .primary').getBoundingClientRect();return {bottom:b.bottom,top:b.top,width:innerWidth,height:innerHeight}})()");
        JSONObject button=new JSONObject(geometry);
        double buttonBottom=bounds.getInt("webTop")+button.getDouble("bottom")*bounds.getInt("webWidth")/button.getDouble("width");
        assertTrue("WebView와 광고 분리: "+bounds,bounds.getInt("webBottom")<bounds.getInt("adTop"));
        assertTrue("버튼이 광고 위: "+buttonBottom+" / "+bounds,buttonBottom<=bounds.getInt("webBottom"));
        assertTrue("버튼 화면 내부",button.getDouble("top")>=0 && button.getDouble("bottom")<=button.getDouble("height"));
        Log.i("BannerLayoutTest",name+" native="+bounds+" button="+button+" buttonBottomPx="+buttonBottom);
        Bitmap bitmap=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull(bitmap);
        File file=new File(activity.getExternalFilesDir(null),"banner-layout-"+name+".png");
        try(FileOutputStream out=new FileOutputStream(file)){bitmap.compress(Bitmap.CompressFormat.PNG,100,out);} finally {bitmap.recycle();}
    }
    @Test public void actualBannerDoesNotCoverMonitorButtons() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(a->activity=a);
            int original=activity.getRequestedOrientation();
            try {
                scenario.onActivity(a->a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
                until("!!document.querySelector('main')",30000);
                js("document.querySelector('.first-run-notice>button')?.click()");
                if (!"true".equals(js("!!document.querySelector('.controls .primary')"))) {
                    scenario.onActivity(a -> a.getBridge().getWebView().loadUrl("https://localhost/?mode=DROWSINESS"));
                    until("!!document.querySelector('.controls .primary')",30000);
                }
                js("document.querySelector('.safety-confirm')?.click()");
                verifyAndCapture("portrait");
                js("window.Capacitor.nativePromise('AdMob','hideBanner',{}).catch(console.error)");
                Thread.sleep(1000);
                JSONObject hidden=nativeBounds();
                assertFalse("숨긴 광고",hidden.getBoolean("adVisible"));
                js("window.Capacitor.nativePromise('AdMob','resumeBanner',{}).catch(console.error)");
                verifyAndCapture("restored");
                scenario.onActivity(a->a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
                until("innerWidth>innerHeight",15000);
                verifyAndCapture("landscape");
            } finally {
                Log.i("BannerLayoutTest","final native="+nativeBounds());
                Bitmap debug=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
                if(debug!=null) { try(FileOutputStream out=new FileOutputStream(new File(activity.getExternalFilesDir(null),"banner-layout-final.png"))){debug.compress(Bitmap.CompressFormat.PNG,100,out);} finally {debug.recycle();} }
                scenario.onActivity(a->a.setRequestedOrientation(original));
            }
        }
    }
}
