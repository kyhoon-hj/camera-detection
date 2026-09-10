package com.hjsolution.suha.driver;

import android.Manifest;
import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** 에뮬레이터 카메라와 실제 WebView/MediaPipe 경로를 사용하는 통합 검증. 사람의 졸음 정확도 검증은 아님. */
@RunWith(AndroidJUnit4.class)
public class DriverPipIntegrationTest {
    private MainActivity activity;

    private String js(String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.getBridge().getWebView().evaluateJavascript(script, value -> { result.set(value); latch.countDown(); }));
        assertTrue("WebView 응답 시간 초과", latch.await(8, TimeUnit.SECONDS));
        return result.get();
    }

    private void until(String description, String predicate, long timeout) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + timeout;
        while (SystemClock.elapsedRealtime() < deadline) {
            if ("true".equals(js(predicate))) return;
            Thread.sleep(400);
        }
        fail(description + ": " + js("document.body.innerText.slice(-1800)"));
    }

    private boolean nativeFlag(String key) {
        AtomicReference<Boolean> value = new AtomicReference<>(false);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> value.set(activity.pipState().optBoolean(key)));
        return value.get();
    }

    @Test public void cameraAndInferenceContinueThroughHomePipAndStopAction() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        String packageName = instrumentation.getTargetContext().getPackageName();
        instrumentation.getUiAutomation().grantRuntimePermission(packageName, Manifest.permission.CAMERA);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(value -> activity = value);
            until("앱 로딩", "!!document.querySelector('main')", 30000);
            js("document.querySelector('.first-run-notice>button')?.click()");
            js("document.querySelector('.pop-dock button')?.click()");
            until("감지 화면", "!!document.querySelector('.controls .primary')", 10000);
            js("document.querySelector('.safety-confirm')?.click()");
            js("document.querySelector('.controls .primary')?.click()");
            until("실제 카메라 및 분석 엔진 시작", "document.querySelector('.camera-stage')?.dataset.runState==='running'", 120000);
            until("카메라 프레임", "document.querySelector('.camera-stage>video').currentTime>2", 15000);
            assertTrue("네이티브 세션 활성", nativeFlag("monitoring"));
            assertTrue(instrumentation.getUiAutomation().performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME));
            until("자동 PiP와 작은 UI", "document.querySelector('main').classList.contains('is-driver-pip')", 12000);
            assertTrue("실제 Android PiP 활성", nativeFlag("active"));
            double before = Double.parseDouble(js("document.querySelector('.camera-stage>video').currentTime"));
            Thread.sleep(16000);
            double after = Double.parseDouble(js("document.querySelector('.camera-stage>video').currentTime"));
            assertTrue("PiP에서 카메라가 계속 진행", after - before > 8);
            assertTrue("실제 분석 heartbeat가 8초 watchdog을 통과", nativeFlag("monitoring"));
            assertEquals("\"running\"", js("document.querySelector('.camera-stage').dataset.runState"));

            Intent restore = new Intent(instrumentation.getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            instrumentation.getTargetContext().startActivity(restore);
            until("전체 화면 복귀", "!document.querySelector('main').classList.contains('is-driver-pip')", 12000);
            assertEquals("\"running\"", js("document.querySelector('.camera-stage').dataset.runState"));
            js("document.querySelector('.driver-pip-launch button').click()");
            until("버튼으로 PiP 재진입", "document.querySelector('main').classList.contains('is-driver-pip')", 10000);
            instrumentation.getTargetContext().sendBroadcast(new Intent(packageName + ".STOP_PIP_MONITOR").setPackage(packageName));
            long deadline = SystemClock.elapsedRealtime() + 5000;
            while (nativeFlag("monitoring") && SystemClock.elapsedRealtime() < deadline) Thread.sleep(100);
            assertFalse("작은 창 종료 액션으로 세션 종료", nativeFlag("monitoring"));
        }
    }
}
