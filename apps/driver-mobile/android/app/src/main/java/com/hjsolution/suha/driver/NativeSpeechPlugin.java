package com.hjsolution.suha.driver;

import android.media.AudioAttributes;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@CapacitorPlugin(name = "NativeSpeech")
public class NativeSpeechPlugin extends Plugin implements TextToSpeech.OnInitListener {

    private static final long INITIALIZATION_TIMEOUT_MS = 10_000;
    private static final long SPEECH_START_TIMEOUT_MS = 8_000;
    private static final String LOG_TAG = "SUHA-NativeSpeech";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final List<PendingSpeech> pendingSpeech = new ArrayList<>();
    private final Map<String, PluginCall> activeSpeech = new HashMap<>();
    private TextToSpeech textToSpeech;
    private boolean ready;
    private boolean languageAvailable;
    private String voiceName;
    private String initializationError;

    @Override
    public void load() {
        mainHandler.post(() -> {
            textToSpeech = new TextToSpeech(getContext(), this);
            mainHandler.postDelayed(this::handleInitializationTimeout, INITIALIZATION_TIMEOUT_MS);
        });
    }

    @Override
    public void onInit(int status) {
        mainHandler.post(() -> finishInitialization(status));
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.trim().isEmpty()) {
            call.reject("음성으로 읽을 문장이 없습니다.", "TTS_EMPTY_TEXT");
            return;
        }

        float rate = clamp(call.getFloat("rate", 1.03f), 0.5f, 2f);
        float pitch = clamp(call.getFloat("pitch", 1f), 0.5f, 2f);
        mainHandler.post(() -> {
            if (initializationError != null) {
                call.reject(initializationError, "TTS_UNAVAILABLE");
            } else if (!ready) {
                pendingSpeech.add(new PendingSpeech(call, text, rate, pitch));
            } else {
                speakNow(call, text, rate, pitch);
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        mainHandler.post(() -> {
            if (textToSpeech != null) textToSpeech.stop();
            call.resolve();
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        mainHandler.post(() -> {
            JSObject result = new JSObject();
            result.put("ready", ready);
            result.put("languageAvailable", languageAvailable);
            if (voiceName != null) result.put("voiceName", voiceName);
            if (initializationError != null) result.put("error", initializationError);
            call.resolve(result);
        });
    }

    private void finishInitialization(int status) {
        if (ready || initializationError != null) return;
        if (status != TextToSpeech.SUCCESS || textToSpeech == null) {
            failInitialization("Android 음성 엔진을 시작하지 못했습니다.");
            return;
        }

        int languageResult = textToSpeech.setLanguage(Locale.KOREAN);
        languageAvailable = languageResult != TextToSpeech.LANG_MISSING_DATA
            && languageResult != TextToSpeech.LANG_NOT_SUPPORTED;
        if (!languageAvailable) {
            failInitialization("한국어 음성 데이터가 설치되어 있지 않습니다.");
            return;
        }

        Voice koreanVoice = findKoreanVoice();
        if (koreanVoice != null) {
            textToSpeech.setVoice(koreanVoice);
            voiceName = koreanVoice.getName();
        } else if (textToSpeech.getVoice() != null) {
            voiceName = textToSpeech.getVoice().getName();
        }

        textToSpeech.setAudioAttributes(
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
        );
        textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {
                Log.i(LOG_TAG, "Speech started: " + utteranceId);
                mainHandler.post(() -> resolveSpeechStarted(utteranceId));
            }

            @Override
            public void onDone(String utteranceId) {
                Log.i(LOG_TAG, "Speech completed: " + utteranceId);
                mainHandler.post(() -> resolveSpeechStarted(utteranceId));
            }

            @Override
            public void onError(String utteranceId) {
                Log.e(LOG_TAG, "Speech failed: " + utteranceId);
                mainHandler.post(() -> rejectSpeech(utteranceId, "Android 음성 엔진이 문장을 재생하지 못했습니다."));
            }

            @Override
            public void onStop(String utteranceId, boolean interrupted) {
                mainHandler.post(() -> rejectSpeech(utteranceId, "음성 안내가 중단됐습니다."));
            }
        });
        ready = true;
        List<PendingSpeech> queued = new ArrayList<>(pendingSpeech);
        pendingSpeech.clear();
        for (PendingSpeech speech : queued) {
            speakNow(speech.call, speech.text, speech.rate, speech.pitch);
        }
    }

    private Voice findKoreanVoice() {
        if (textToSpeech == null || textToSpeech.getVoices() == null) return null;
        Voice networkVoice = null;
        for (Voice voice : textToSpeech.getVoices()) {
            if (!Locale.KOREAN.getLanguage().equals(voice.getLocale().getLanguage())) continue;
            if (!voice.isNetworkConnectionRequired()) return voice;
            if (networkVoice == null) networkVoice = voice;
        }
        return networkVoice;
    }

    private void speakNow(PluginCall call, String text, float rate, float pitch) {
        if (textToSpeech == null || !ready) {
            call.reject("Android 음성 엔진이 준비되지 않았습니다.", "TTS_NOT_READY");
            return;
        }
        textToSpeech.setSpeechRate(rate);
        textToSpeech.setPitch(pitch);
        Bundle parameters = new Bundle();
        String utteranceId = "suha-" + System.nanoTime();
        activeSpeech.put(utteranceId, call);
        int result = textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, parameters, utteranceId);
        if (result == TextToSpeech.ERROR) {
            activeSpeech.remove(utteranceId);
            call.reject("Android 음성 재생 요청에 실패했습니다.", "TTS_SPEAK_FAILED");
            return;
        }
        mainHandler.postDelayed(
            () -> rejectSpeech(utteranceId, "Android 음성 엔진이 재생을 시작하지 않았습니다."),
            SPEECH_START_TIMEOUT_MS
        );
    }

    private void resolveSpeechStarted(String utteranceId) {
        PluginCall call = activeSpeech.remove(utteranceId);
        if (call != null) call.resolve();
    }

    private void rejectSpeech(String utteranceId, String message) {
        PluginCall call = activeSpeech.remove(utteranceId);
        if (call != null) call.reject(message, "TTS_PLAYBACK_FAILED");
    }

    private void handleInitializationTimeout() {
        if (!ready && initializationError == null) {
            failInitialization("Android 음성 엔진의 응답 시간이 초과됐습니다.");
        }
    }

    private void failInitialization(String message) {
        initializationError = message;
        List<PendingSpeech> queued = new ArrayList<>(pendingSpeech);
        pendingSpeech.clear();
        for (PendingSpeech speech : queued) {
            speech.call.reject(message, "TTS_UNAVAILABLE");
        }
    }

    @Override
    protected void handleOnDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        for (PendingSpeech speech : pendingSpeech) {
            speech.call.reject("앱이 종료되어 음성 요청이 취소됐습니다.", "TTS_CANCELLED");
        }
        pendingSpeech.clear();
        for (PluginCall call : activeSpeech.values()) {
            call.reject("앱이 종료되어 음성 요청이 취소됐습니다.", "TTS_CANCELLED");
        }
        activeSpeech.clear();
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
        }
        super.handleOnDestroy();
    }

    private static float clamp(float value, float minimum, float maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private static final class PendingSpeech {
        private final PluginCall call;
        private final String text;
        private final float rate;
        private final float pitch;

        private PendingSpeech(PluginCall call, String text, float rate, float pitch) {
            this.call = call;
            this.text = text;
            this.rate = rate;
            this.pitch = pitch;
        }
    }
}
