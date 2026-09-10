package com.hjsolution.suha.driver;

import android.graphics.Color;
import android.graphics.Rect;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.webkit.WebView;
import android.widget.TextView;
import androidx.coordinatorlayout.widget.CoordinatorLayout;
import java.util.ArrayList;
import java.util.List;

/** 실제 네이티브 광고 상단까지 WebView를 줄여 fixed 버튼·모달도 광고 위에 배치한다. */
final class BannerLayoutController implements ViewTreeObserver.OnPreDrawListener {
    private final WebView web;
    private final ViewGroup root;
    private final TextView footer;
    private final int initialBottomMargin;
    private final int dividerHeight;
    private final List<View> pipHidden = new ArrayList<>();
    private boolean suppressed;

    BannerLayoutController(WebView web) {
        this.web = web;
        root = (ViewGroup) web.getParent();
        initialBottomMargin = ((ViewGroup.MarginLayoutParams) web.getLayoutParams()).bottomMargin;
        dividerHeight = Math.round(22 * web.getResources().getDisplayMetrics().density);
        footer = new TextView(web.getContext());
        footer.setText("광고");
        footer.setTextSize(9);
        footer.setTextColor(Color.rgb(167, 157, 180));
        footer.setBackgroundColor(Color.rgb(15, 13, 24));
        footer.setGravity(Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        footer.setPadding(0, Math.round(4 * web.getResources().getDisplayMetrics().density), 0, 0);
        footer.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        footer.setVisibility(View.GONE);
        CoordinatorLayout.LayoutParams params = new CoordinatorLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0);
        params.gravity = Gravity.BOTTOM;
        root.addView(footer, root.indexOfChild(web) + 1, params);
        root.getViewTreeObserver().addOnPreDrawListener(this);
    }

    private View adIn(View view) {
        // SDK 구현은 앱 의존성을 노출하지 않으므로 공개 AdView 클래스 이름으로 식별한다.
        if (view.getClass().getName().equals("com.google.android.gms.ads.AdView")) return view;
        if (view instanceof ViewGroup && !(view instanceof WebView)) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                View result = adIn(group.getChildAt(i));
                if (result != null) return result;
            }
        }
        return null;
    }

    void setSuppressed(boolean value) {
        suppressed = value;
        if (!value) {
            for (View view : pipHidden) if (view.getParent() == root) view.setVisibility(View.VISIBLE);
            pipHidden.clear();
        }
        root.requestLayout();
    }

    @Override public boolean onPreDraw() {
        int reserve = 0;
        int[] rootLocation = new int[2];
        root.getLocationOnScreen(rootLocation);
        for (int i = 0; i < root.getChildCount(); i++) {
            View sibling = root.getChildAt(i);
            if (sibling == web || sibling == footer) continue;
            View ad = adIn(sibling);
            if (ad == null) continue;
            if (suppressed) {
                if (sibling.getVisibility() == View.VISIBLE) { pipHidden.add(sibling); sibling.setVisibility(View.INVISIBLE); }
                continue;
            }
            Rect bounds = new Rect();
            if (ad.isShown() && ad.getGlobalVisibleRect(bounds) && bounds.height() > 0) {
                reserve = Math.max(reserve, rootLocation[1] + root.getHeight() - bounds.top + dividerHeight);
            }
        }
        reserve = Math.max(0, Math.min(reserve, root.getHeight()));
        int desired = Math.max(initialBottomMargin, reserve);
        ViewGroup.MarginLayoutParams webParams = (ViewGroup.MarginLayoutParams) web.getLayoutParams();
        boolean changed = webParams.bottomMargin != desired;
        if (changed) { webParams.bottomMargin = desired; web.setLayoutParams(webParams); }
        ViewGroup.LayoutParams footerParams = footer.getLayoutParams();
        if (footerParams.height != reserve) { footerParams.height = reserve; footer.setLayoutParams(footerParams); changed = true; }
        int visibility = reserve > 0 ? View.VISIBLE : View.GONE;
        if (footer.getVisibility() != visibility) { footer.setVisibility(visibility); changed = true; }
        // 새 배너가 나타난 첫 프레임에도 겹친 화면을 그리지 않는다.
        return !changed;
    }

    void dispose() {
        if (root.getViewTreeObserver().isAlive()) root.getViewTreeObserver().removeOnPreDrawListener(this);
    }
}
