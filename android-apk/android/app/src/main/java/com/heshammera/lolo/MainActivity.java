package com.heshammera.lolo;

import android.content.pm.ApplicationInfo;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {
    private FrameLayout startupCover;
    private final Runnable startupTimeout = this::removeStartupCover;

    @Override public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        // Synthetic proof bridge is intentionally absent in release builds.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            registerPlugin(OfflineDeviceProofPlugin.class);
            registerPlugin(OfflineLicenseVaultPlugin.class);
        }
        registerPlugin(LearningReminderPlugin.class);
        registerPlugin(StartupSplashPlugin.class);
        super.onCreate(savedInstanceState);
        showStartupCover();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
    private void showStartupCover() {
        // Read the exact same approved asset already verified in the web bundle.
        Bitmap art;
        try (InputStream stream = getAssets().open("public/assets/branding/lolo-splash.webp")) {
            art = BitmapFactory.decodeStream(stream);
        } catch (Exception ignored) { return; }
        if (art == null) return;
        FrameLayout cover = new FrameLayout(this);
        cover.setBackground(new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[]{Color.rgb(150,131,236),Color.rgb(181,165,241),Color.rgb(165,225,228)}));
        cover.setClickable(true);
        cover.setContentDescription("جارٍ تجهيز التطبيق");
        ImageView image = new ImageView(this);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        image.setImageBitmap(art);
        cover.addView(image,new FrameLayout.LayoutParams(-1,-1));

        LinearLayout loading = new LinearLayout(this);
        loading.setOrientation(LinearLayout.VERTICAL);
        loading.setGravity(Gravity.CENTER);
        loading.setPadding(dp(18),dp(12),dp(18),dp(14));
        GradientDrawable panel = new GradientDrawable();
        panel.setColor(Color.argb(223,53,35,87));panel.setCornerRadius(dp(22));
        loading.setBackground(panel);
        TextView label = new TextView(this);
        label.setText("بنجهز رحلتك مع لولو…");label.setTextColor(Color.WHITE);
        label.setTextSize(13);label.setGravity(Gravity.CENTER);
        loading.addView(label,new LinearLayout.LayoutParams(-1,-2));
        ProgressBar bar = new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);
        bar.setIndeterminate(false);bar.setMax(100);bar.setProgress(10);
        bar.setProgressTintList(ColorStateList.valueOf(Color.rgb(212,181,255)));
        bar.setProgressBackgroundTintList(ColorStateList.valueOf(Color.argb(70,255,255,255)));
        LinearLayout.LayoutParams progress = new LinearLayout.LayoutParams(-1,dp(8));
        progress.topMargin=dp(8);loading.addView(bar,progress);
        int width=Math.min(dp(370),Math.round(getResources().getDisplayMetrics().widthPixels*.82f));
        FrameLayout.LayoutParams bottom = new FrameLayout.LayoutParams(width,-2,Gravity.BOTTOM|Gravity.CENTER_HORIZONTAL);
        bottom.bottomMargin=dp(28);cover.addView(loading,bottom);
        startupCover=cover;
        addContentView(cover,new ViewGroup.LayoutParams(-1,-1));
        // Never leave a native cover permanently blocking the WebView on startup failure.
        cover.postDelayed(startupTimeout,8000);
    }
    void webSplashPainted(Runnable completed) {
        runOnUiThread(() -> {
            WebView web=getBridge()==null?null:getBridge().getWebView();
            if (startupCover==null || web==null) {
                removeStartupCover();completed.run();return;
            }
            // The callback is delivered when the next WebView draw can include the painted splash.
            web.postVisualStateCallback(1,new WebView.VisualStateCallback(){
                @Override public void onComplete(long id){removeStartupCover();completed.run();}
            });
        });
    }
    private void removeStartupCover() {
        FrameLayout cover=startupCover;
        if(cover==null)return;
        startupCover=null;cover.removeCallbacks(startupTimeout);
        if(cover.getParent() instanceof ViewGroup)((ViewGroup)cover.getParent()).removeView(cover);
    }
    @Override protected void onDestroy(){removeStartupCover();super.onDestroy();}
}
