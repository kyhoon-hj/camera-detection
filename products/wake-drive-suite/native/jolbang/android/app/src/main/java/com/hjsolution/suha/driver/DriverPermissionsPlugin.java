package com.hjsolution.suha.driver;

import android.Manifest;
import android.app.AlertDialog;
import android.app.AppOpsManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
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
    private String localized(String korean, String english) {
        String language=getContext().getSharedPreferences("wake_drive_locale",Context.MODE_PRIVATE).getString("language",java.util.Locale.getDefault().getLanguage());
        return "ko".equals(language)?korean:english;
    }
    @PluginMethod public void getLanguage(PluginCall call) {
        String selected=getContext().getSharedPreferences("wake_drive_locale",Context.MODE_PRIVATE).getString("language",null);
        call.resolve(new JSObject().put("selected",selected).put("device",java.util.Locale.getDefault().toLanguageTag()));
    }
    @PluginMethod public void setLanguage(PluginCall call) {
        String language=call.getString("language");
        if(!"ko".equals(language) && !"en".equals(language)) {call.reject("Unsupported language");return;}
        getContext().getSharedPreferences("wake_drive_locale",Context.MODE_PRIVATE).edit().putString("language",language).apply();
        call.resolve();
    }
    private AlertDialog dialog;
    private boolean wantsPip = true;

    private boolean granted(String permission) { return ContextCompat.checkSelfPermission(getContext(),permission)==PackageManager.PERMISSION_GRANTED; }
    JSObject status() {
        boolean pipSupported=Build.VERSION.SDK_INT>=26 && getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
        boolean pipAllowed=false;
        if(pipSupported) {
            AppOpsManager ops=(AppOpsManager)getContext().getSystemService(Context.APP_OPS_SERVICE);
            pipAllowed=ops.checkOpNoThrow(AppOpsManager.OPSTR_PICTURE_IN_PICTURE,android.os.Process.myUid(),getContext().getPackageName())==AppOpsManager.MODE_ALLOWED;
        }
        return new JSObject().put("camera",granted(Manifest.permission.CAMERA))
            .put("pipSupported",pipSupported).put("pip",pipAllowed);
    }
    private void open(String target) {
        Intent intent;
        if("privacy".equals(target)) intent=new Intent(Settings.ACTION_PRIVACY_SETTINGS);
        else if("pip".equals(target) && Build.VERSION.SDK_INT>=26) intent=new Intent("android.settings.PICTURE_IN_PICTURE_SETTINGS",Uri.parse("package:"+getContext().getPackageName()));
        else intent=new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getContext().getPackageName()));
        try { getActivity().startActivity(intent); }
        catch(ActivityNotFoundException ex) { getActivity().startActivity(new Intent(Settings.ACTION_SETTINGS)); }
    }
    private void notice(String title,String message,String target) {
        if(getActivity().isFinishing() || getActivity().isDestroyed() || (dialog!=null && dialog.isShowing())) return;
        dialog=new AlertDialog.Builder(getActivity()).setTitle(title).setMessage(message)
            .setPositiveButton(localized("설정으로 이동","Open settings"),(d,w)->open(target)).setNegativeButton(localized("나중에","Later"),(d,w)->{}).create();
        dialog.show();
    }
    boolean ensure(String feature) {
        JSObject state=status();
        if("camera".equals(feature) && !state.optBoolean("camera")) {
            notice(localized("카메라 권한이 꺼져 있어요","Camera permission is off"),localized("졸음 감지를 시작하려면 카메라 권한이 필요합니다.\n\n설정 → 권한 → 카메라에서 ‘앱 사용 중에만 허용’을 선택한 뒤 앱으로 돌아와 주세요.","Camera permission is needed for drowsiness detection.\n\nOpen Settings → Permissions → Camera and allow access while using the app, then return."),"app"); return false;
        }

        if("pip".equals(feature) && state.optBoolean("pipSupported") && !state.optBoolean("pip")) {
            notice(localized("작은 화면 권한이 꺼져 있어요","Picture-in-picture permission is off"),localized("다른 앱 위에서 작은 화면으로 측정하려면 Wake Drive의 ‘화면 속 화면’을 허용해 주세요.\n현재 앱 화면에서는 졸음 감지를 사용할 수 있어요.","Allow picture-in-picture for Wake Drive to monitor in a small window above other apps.\nDetection is still available in the app."),"pip"); return false;
        }
        return true;
    }
    void checkOnResume() {
        if(!ensure("camera")) return;
        if(wantsPip) ensure("pip");
    }
    @PluginMethod public void getStatus(PluginCall call) { getActivity().runOnUiThread(()->call.resolve(status())); }
    @PluginMethod public void ensure(PluginCall call) { getActivity().runOnUiThread(()->call.resolve(new JSObject().put("allowed",ensure(call.getString("feature","camera"))))); }
    @PluginMethod public void configure(PluginCall call) { getActivity().runOnUiThread(()->{wantsPip=Boolean.TRUE.equals(call.getBoolean("pip"));call.resolve();}); }
    @PluginMethod public void openSettings(PluginCall call) { getActivity().runOnUiThread(()->{open(call.getString("target","app"));call.resolve();}); }
    @PluginMethod public void showOverview(PluginCall call) {
        getActivity().runOnUiThread(()->{
            if(dialog!=null && dialog.isShowing()) dialog.dismiss();
            JSObject state=status();
            String[] rows={localized("카메라 (필수) · ","Camera (required) · ")+(state.optBoolean("camera")?localized("허용됨","Allowed"):localized("꺼짐","Off"))+localized(" → 앱 설정"," → App settings"),
                localized("화면 속 화면 (선택) · ","Picture-in-picture (optional) · ")+(!state.optBoolean("pipSupported")?localized("지원 안 됨","Not supported"):state.optBoolean("pip")?localized("허용됨","Allowed"):localized("꺼짐","Off")),
                localized("휴대폰 전체 카메라 접근 토글 확인","Check the device Camera access toggle")};
            String[] targets={"app","pip","privacy"};
            dialog=new AlertDialog.Builder(getActivity()).setTitle(localized("권한 확인 및 설정","Permissions and settings")).setItems(rows,(d,index)->open(targets[index])).setNegativeButton(localized("닫기","Close"),null).create();
            dialog.show(); call.resolve();
        });
    }
    @Override protected void handleOnDestroy() { if(dialog!=null) dialog.dismiss(); }
}
