package com.hjsolution.suha.driver;

import android.Manifest;
import android.app.AlertDialog;
import android.app.AppOpsManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name="DriverPermissions")
public class DriverPermissionsPlugin extends Plugin {
    private AlertDialog dialog;
    private boolean wantsLocation;
    private boolean wantsPip = true;

    private boolean granted(String permission) { return ContextCompat.checkSelfPermission(getContext(),permission)==PackageManager.PERMISSION_GRANTED; }
    JSObject status() {
        boolean locationEnabled;
        LocationManager location=(LocationManager)getContext().getSystemService(Context.LOCATION_SERVICE);
        if(Build.VERSION.SDK_INT>=28) locationEnabled=location.isLocationEnabled();
        else locationEnabled=location.isProviderEnabled(LocationManager.GPS_PROVIDER)||location.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        boolean pipSupported=Build.VERSION.SDK_INT>=26 && getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
        boolean pipAllowed=false;
        if(pipSupported) {
            AppOpsManager ops=(AppOpsManager)getContext().getSystemService(Context.APP_OPS_SERVICE);
            pipAllowed=ops.checkOpNoThrow(AppOpsManager.OPSTR_PICTURE_IN_PICTURE,android.os.Process.myUid(),getContext().getPackageName())==AppOpsManager.MODE_ALLOWED;
        }
        return new JSObject().put("camera",granted(Manifest.permission.CAMERA))
            .put("location",granted(Manifest.permission.ACCESS_COARSE_LOCATION)||granted(Manifest.permission.ACCESS_FINE_LOCATION))
            .put("locationEnabled",locationEnabled).put("pipSupported",pipSupported).put("pip",pipAllowed);
    }
    private void open(String target) {
        Intent intent;
        if("locationService".equals(target)) intent=new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
        else if("privacy".equals(target)) intent=new Intent(Settings.ACTION_PRIVACY_SETTINGS);
        else if("pip".equals(target) && Build.VERSION.SDK_INT>=26) intent=new Intent("android.settings.PICTURE_IN_PICTURE_SETTINGS",Uri.parse("package:"+getContext().getPackageName()));
        else intent=new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getContext().getPackageName()));
        try { getActivity().startActivity(intent); }
        catch(ActivityNotFoundException ex) { getActivity().startActivity(new Intent(Settings.ACTION_SETTINGS)); }
    }
    private void notice(String title,String message,String target) {
        if(getActivity().isFinishing() || getActivity().isDestroyed() || (dialog!=null && dialog.isShowing())) return;
        dialog=new AlertDialog.Builder(getActivity()).setTitle(title).setMessage(message)
            .setPositiveButton("설정으로 이동",(d,w)->open(target)).setNegativeButton("나중에",(d,w)->{}).create();
        dialog.show();
    }
    boolean ensure(String feature) {
        JSObject state=status();
        if("camera".equals(feature) && !state.optBoolean("camera")) {
            notice("카메라 권한이 꺼져 있어요","졸음 감지를 시작하려면 카메라 권한이 필요합니다.\n\n설정 → 권한 → 카메라에서 ‘앱 사용 중에만 허용’을 선택한 뒤 앱으로 돌아와 주세요.\n위치 권한은 GPS 속도를 켤 때만 필요합니다.","app"); return false;
        }
        if("location".equals(feature) && (!state.optBoolean("location") || !state.optBoolean("locationEnabled"))) {
            boolean permitted=state.optBoolean("location");
            notice(permitted?"휴대폰 위치 기능이 꺼져 있어요":"위치 권한이 꺼져 있어요", "GPS 참고 속도를 표시하려면 위치 권한과 휴대폰 위치 기능이 필요합니다.\n위치를 켜지 않아도 카메라 졸음 감지는 사용할 수 있어요.",permitted?"locationService":"app"); return false;
        }
        if("pip".equals(feature) && state.optBoolean("pipSupported") && !state.optBoolean("pip")) {
            notice("작은 화면 권한이 꺼져 있어요","다른 앱 위에서 작은 화면으로 측정하려면 Wake Drive의 ‘화면 속 화면’을 허용해 주세요.\n현재 앱 화면에서는 졸음 감지를 사용할 수 있어요.","pip"); return false;
        }
        return true;
    }
    void checkOnResume() {
        if(!ensure("camera")) return;
        if(wantsLocation && !ensure("location")) return;
        if(wantsPip) ensure("pip");
    }
    @PluginMethod public void getStatus(PluginCall call) { getActivity().runOnUiThread(()->call.resolve(status())); }
    @PluginMethod public void ensure(PluginCall call) { getActivity().runOnUiThread(()->call.resolve(new JSObject().put("allowed",ensure(call.getString("feature","camera"))))); }
    @PluginMethod public void configure(PluginCall call) { getActivity().runOnUiThread(()->{wantsLocation=Boolean.TRUE.equals(call.getBoolean("location")); wantsPip=Boolean.TRUE.equals(call.getBoolean("pip"));call.resolve();}); }
    @PluginMethod public void openSettings(PluginCall call) { getActivity().runOnUiThread(()->{open(call.getString("target","app"));call.resolve();}); }
    @PluginMethod public void showOverview(PluginCall call) {
        getActivity().runOnUiThread(()->{
            if(dialog!=null && dialog.isShowing()) dialog.dismiss();
            JSObject state=status();
            String[] rows={"카메라 (필수) · "+(state.optBoolean("camera")?"허용됨":"꺼짐")+" → 앱 설정",
                "위치 권한 (선택) · "+(state.optBoolean("location")?"허용됨":"꺼짐")+" → 앱 설정",
                "휴대폰 위치 기능 · "+(state.optBoolean("locationEnabled")?"켜짐":"꺼짐"),
                "화면 속 화면 (선택) · "+(!state.optBoolean("pipSupported")?"지원 안 됨":state.optBoolean("pip")?"허용됨":"꺼짐"),
                "휴대폰 전체 카메라 접근 토글 확인"};
            String[] targets={"app","app","locationService","pip","privacy"};
            dialog=new AlertDialog.Builder(getActivity()).setTitle("권한 확인 및 설정").setItems(rows,(d,index)->open(targets[index])).setNegativeButton("닫기",null).create();
            dialog.show(); call.resolve();
        });
    }
    @Override protected void handleOnDestroy() { if(dialog!=null) dialog.dismiss(); }
}
