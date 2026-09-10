package com.hjsolution.suha.driver;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DriverPip")
public class DriverPipPlugin extends Plugin {
    private MainActivity activity() { return (MainActivity) getActivity(); }

    @PluginMethod public void getState(PluginCall call) {
        getActivity().runOnUiThread(() -> call.resolve(activity().pipState()));
    }

    @PluginMethod public void setSession(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            activity().setPipSession(Boolean.TRUE.equals(call.getBoolean("running")), Boolean.TRUE.equals(call.getBoolean("enabled")));
            call.resolve(activity().pipState());
        });
    }

    @PluginMethod public void heartbeat(PluginCall call) {
        getActivity().runOnUiThread(() -> { activity().pipHeartbeat(); call.resolve(); });
    }

    @PluginMethod public void enter(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (activity().enterDriverPip()) call.resolve(activity().pipState());
            else call.reject("작은 화면을 열지 못했습니다. Android 설정에서 Wake Drive의 ‘화면 속 화면’ 허용 여부를 확인해 주세요.");
        });
    }

    void publish(JSObject state) { notifyListeners("stateChanged", state, true); }
}
