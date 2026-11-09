package com.sanyu.ledger;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Log;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Minimal full-screen WebView shell for the single-file ledger app.
 *
 * The page is loaded through loadDataWithBaseURL with a stable https origin so
 * WebView keeps a normal, persistent localStorage bucket. Do not change
 * BASE_URL: changing it makes the app look like a different site and the
 * existing records will no longer be found.
 */
public class MainActivity extends Activity {

    private static final String TAG = "SanyuLedger";
    private static final String BASE_URL = "https://sanyu-ledger.local/";
    private static final String PAGE_ASSET = "index.html";
    private static final String BRIDGE_NAME = "LedgerApp";
    private static final int REQUEST_FILE_CHOOSER = 1001;
    private static final int PAGE_BACKGROUND = 0xFFF4F1EA;

    private static final String BACK_JS =
            "(function(){" +
            "var open=document.querySelector('.backdrop.is-open');" +
            "if(open){" +
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));" +
            "return 'handled';}" +
            "var homeTab=document.querySelector('.tab[data-view=\"home\"]');" +
            "var homeView=document.getElementById('view-home');" +
            "if(homeTab&&homeView&&!homeView.classList.contains('is-active')){" +
            "homeTab.click();return 'handled';}" +
            "return 'exit';" +
            "})()";

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(PAGE_BACKGROUND);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> callback,
                                             WebChromeClient.FileChooserParams params) {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                }
                pendingFileCallback = callback;

                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(intent, REQUEST_FILE_CHOOSER);
                } catch (Exception error) {
                    pendingFileCallback = null;
                    toast("无法打开文件选择器");
                    return false;
                }
                return true;
            }
        });

        webView.addJavascriptInterface(new LedgerBridge(), BRIDGE_NAME);
        setContentView(webView);
        configureSystemBars();

        try {
            String html = readAsset(PAGE_ASSET);
            webView.loadDataWithBaseURL(BASE_URL, html, "text/html", "UTF-8", null);
        } catch (IOException error) {
            Log.e(TAG, "Unable to read " + PAGE_ASSET, error);
            toast("加载账本失败");
            finish();
        }
    }

    private void configureSystemBars() {
        getWindow().setStatusBarColor(PAGE_BACKGROUND);
        getWindow().setNavigationBarColor(PAGE_BACKGROUND);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                        | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    }

    private String readAsset(String name) throws IOException {
        try (InputStream input = getAssets().open(name)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toString("UTF-8");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSER && pendingFileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                Uri uri = data.getData();
                if (uri == null && data.getClipData() != null
                        && data.getClipData().getItemCount() > 0) {
                    uri = data.getClipData().getItemAt(0).getUri();
                }
                if (uri != null) {
                    result = new Uri[]{uri};
                }
            }
            pendingFileCallback.onReceiveValue(result);
            pendingFileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(BACK_JS, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (value == null || value.contains("exit")) {
                    finish();
                }
            }
        });
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }
        if (webView != null) {
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void toast(final String message) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
            }
        });
    }

    /**
     * Exposed to the page as window.LedgerApp. WebView cannot save blob:
     * downloads, so JSON/CSV exports are written to the public Downloads
     * collection instead (no storage permission needed on Android 10+).
     */
    private final class LedgerBridge {

        @JavascriptInterface
        public boolean saveFile(String filename, String content, String mimeType) {
            try {
                String safeName = sanitizeFilename(filename);
                if (safeName.isEmpty()) {
                    safeName = "sanyu-export.txt";
                }
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
                values.put(MediaStore.MediaColumns.MIME_TYPE, normalizeMime(mimeType, safeName));
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);

                Uri uri = getContentResolver().insert(
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    throw new IOException("无法创建文件");
                }
                try (OutputStream stream = getContentResolver().openOutputStream(uri)) {
                    if (stream == null) {
                        throw new IOException("无法写入文件");
                    }
                    stream.write(content.getBytes(StandardCharsets.UTF_8));
                    stream.flush();
                }

                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContentResolver().update(uri, values, null, null);
                return true;
            } catch (Exception error) {
                Log.e(TAG, "saveFile failed", error);
                String reason = error.getMessage();
                toast("保存失败：" + (reason == null ? "未知错误" : reason));
                return false;
            }
        }
    }

    private static String sanitizeFilename(String name) {
        if (name == null) {
            return "";
        }
        String base = name.replace('\\', '/');
        int slash = base.lastIndexOf('/');
        if (slash >= 0) {
            base = base.substring(slash + 1);
        }
        base = base.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (base.length() > 120) {
            base = base.substring(0, 120);
        }
        return base;
    }

    private static String normalizeMime(String mimeType, String filename) {
        if (mimeType != null) {
            int semicolon = mimeType.indexOf(';');
            if (semicolon > 0) {
                mimeType = mimeType.substring(0, semicolon);
            }
            mimeType = mimeType.trim();
            if (mimeType.contains("/")) {
                return mimeType;
            }
        }
        String lower = filename.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".json")) {
            return "application/json";
        }
        if (lower.endsWith(".csv")) {
            return "text/csv";
        }
        if (lower.endsWith(".txt")) {
            return "text/plain";
        }
        return "application/octet-stream";
    }
}
