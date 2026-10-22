package com.shaunmcintyre.antigravity.neonpulse;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String TAG = "AntiGravity";
    private static final String HOST = "appassets.androidplatform.net";
    private static final String PREFS_NAME = "antigravity_native_state";
    private static final String KEY_ACTIVE_RELEASE = "active_release_version";
    private static final String KEY_PENDING_RELEASE = "pending_release_version";
    private static final String KEY_HIGH_SCORE = "antigravity_high_score";
    private static final String KEY_SCORE_MIGRATED = "antigravity_score_migrated";

    private static final String MANIFEST_URL = "https://shaunmcintyre813.github.io/mobile-arcade-game/release-manifest.json";
    private static final String BASE_URL = "https://shaunmcintyre813.github.io/mobile-arcade-game/";

    private WebView webView;
    private SharedPreferences prefs;
    private final ExecutorService updateExecutor = Executors.newSingleThreadExecutor();
    private volatile boolean isRoundActive = false;
    private volatile boolean isDestroyed = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(10, 10, 22));
        getWindow().setNavigationBarColor(Color.rgb(10, 10, 22));

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        // Apply any fully downloaded release that was prepared on a previous launch
        promotePendingReleaseIfReady();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(5, 5, 8));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new NativeBridge(), "AntiGravityAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAppAsset(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                executeScoreMigrationIfNeeded();
            }
        });

        setContentView(webView);
        hideSystemBars();
        webView.loadUrl("https://" + HOST + "/index.html");

        // Trigger background update check
        triggerBackgroundUpdateCheck();
    }

    private void promotePendingReleaseIfReady() {
        String pending = prefs.getString(KEY_PENDING_RELEASE, null);
        if (pending != null) {
            File pendingDir = getReleaseDir(pending);
            File successMarker = new File(pendingDir, ".ready");
            if (successMarker.exists()) {
                prefs.edit()
                    .putString(KEY_ACTIVE_RELEASE, pending)
                    .remove(KEY_PENDING_RELEASE)
                    .apply();
                Log.i(TAG, "Promoted release " + pending + " to active release.");
            }
        }
    }

    private File getReleasesRoot() {
        File dir = new File(getFilesDir(), "releases");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private File getReleaseDir(String version) {
        return new File(getReleasesRoot(), version);
    }

    private void hideSystemBars() {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            android.view.WindowInsetsController controller = getWindow().getDecorView().getWindowInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(
                    android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private WebResourceResponse serveAppAsset(Uri uri) {
        if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost())) return missing();
        String path = uri.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
        if (path.contains("..") || path.contains("\\")) return missing();

        String relativePath = path.startsWith("/") ? path.substring(1) : path;

        // 1. Try active downloaded release
        String activeVersion = prefs.getString(KEY_ACTIVE_RELEASE, null);
        if (activeVersion != null) {
            File activeDir = getReleaseDir(activeVersion);
            File file = new File(activeDir, relativePath);
            if (file.exists() && file.isFile()) {
                try {
                    return new WebResourceResponse(mime(path), "UTF-8", new FileInputStream(file));
                } catch (IOException e) {
                    Log.w(TAG, "Error reading updated release file: " + file, e);
                }
            }
        }

        // 2. Fallback to APK bundled assets
        try {
            return new WebResourceResponse(mime(path), "UTF-8", getAssets().open("www" + path));
        } catch (IOException e) {
            return missing();
        }
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".webmanifest")) return "application/manifest+json";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private boolean isNetworkAvailable() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        android.net.Network net = cm.getActiveNetwork();
        if (net == null) return false;
        NetworkCapabilities caps = cm.getNetworkCapabilities(net);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void triggerBackgroundUpdateCheck() {
        updateExecutor.execute(() -> {
            try {
                if (!isNetworkAvailable()) {
                    Log.d(TAG, "Offline or no network, skipping update check.");
                    return;
                }
                checkForUpdates();
            } catch (Throwable t) {
                Log.w(TAG, "Update check failed: " + t.getMessage());
            }
        });
    }

    private void checkForUpdates() {
        try {
            String manifestJsonStr = downloadString(MANIFEST_URL);
            if (manifestJsonStr == null) return;

            JSONObject manifestObj = new JSONObject(manifestJsonStr);
            String remoteVersion = manifestObj.getString("version");
            JSONObject filesObj = manifestObj.getJSONObject("files");

            String activeVersion = prefs.getString(KEY_ACTIVE_RELEASE, null);
            if (remoteVersion.equals(activeVersion)) {
                Log.d(TAG, "Already running latest release: " + remoteVersion);
                return;
            }

            File stagingDir = new File(getReleasesRoot(), remoteVersion + ".tmp");
            if (stagingDir.exists()) deleteRecursively(stagingDir);
            stagingDir.mkdirs();

            boolean allSuccess = true;
            Iterator<String> keys = filesObj.keys();
            while (keys.hasNext()) {
                String filePath = keys.next();
                String expectedHash = filesObj.getString(filePath).toLowerCase();

                String fileUrl = BASE_URL + filePath;
                byte[] data = downloadBytes(fileUrl);
                if (data == null) {
                    allSuccess = false;
                    break;
                }

                String actualHash = sha256(data);
                if (!expectedHash.equals(actualHash)) {
                    Log.w(TAG, "Hash mismatch for " + filePath + ": expected=" + expectedHash + " actual=" + actualHash);
                    allSuccess = false;
                    break;
                }

                File destFile = new File(stagingDir, filePath);
                File parent = destFile.getParentFile();
                if (parent != null && !parent.exists()) parent.mkdirs();

                FileOutputStream fos = new FileOutputStream(destFile);
                fos.write(data);
                fos.close();
            }

            if (!allSuccess) {
                Log.w(TAG, "Release download incomplete or corrupted; discarding staging directory.");
                deleteRecursively(stagingDir);
                return;
            }

            // Create .ready marker
            new File(stagingDir, ".ready").createNewFile();

            // Atomic rename to final release directory
            File targetDir = getReleaseDir(remoteVersion);
            if (targetDir.exists()) deleteRecursively(targetDir);
            if (!stagingDir.renameTo(targetDir)) {
                Log.w(TAG, "Failed to rename staging directory to " + targetDir);
                return;
            }

            Log.i(TAG, "Successfully downloaded complete release " + remoteVersion);

            // Record as pending release
            prefs.edit().putString(KEY_PENDING_RELEASE, remoteVersion).apply();

            // If player is not currently in an active game round, safely apply now
            runOnUiThread(() -> {
                if (!isDestroyed && !isRoundActive) {
                    applyUpdateWithoutReloadInterruption(remoteVersion);
                }
            });

        } catch (Exception e) {
            Log.w(TAG, "Exception during update download: " + e.getMessage());
        }
    }

    private void applyUpdateWithoutReloadInterruption(String newVersion) {
        if (isRoundActive) {
            Log.d(TAG, "Game round in progress; deferring release activation to next launch.");
            return;
        }

        prefs.edit()
            .putString(KEY_ACTIVE_RELEASE, newVersion)
            .remove(KEY_PENDING_RELEASE)
            .apply();

        Log.i(TAG, "Promoted release " + newVersion + " to active. Reloading webview safely at idle menu.");
        webView.reload();
    }

    private void executeScoreMigrationIfNeeded() {
        if (prefs.getBoolean(KEY_SCORE_MIGRATED, false)) {
            return;
        }

        // Read high score from WebView localStorage under current origin
        String script = "(function() { try { return localStorage.getItem('antigravity_high_score') || '0'; } catch(e) { return '0'; } })()";
        webView.evaluateJavascript(script, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                try {
                    int score = 0;
                    if (value != null && !value.isEmpty() && !"null".equals(value)) {
                        String unquoted = value.replaceAll("^\"|\"$", "");
                        score = Integer.parseInt(unquoted);
                    }
                    if (score > 0) {
                        int existing = prefs.getInt(KEY_HIGH_SCORE, 0);
                        if (score > existing) {
                            prefs.edit().putInt(KEY_HIGH_SCORE, score).apply();
                            Log.i(TAG, "Migrated high score into persistent Native SharedPreferences: " + score);
                        }
                    }
                    // Sync back to localStorage to ensure origin change doesn't reset it
                    int best = prefs.getInt(KEY_HIGH_SCORE, 0);
                    if (best > 0) {
                        String syncScript = "try { localStorage.setItem('antigravity_high_score', '" + best + "'); } catch(e){}";
                        webView.evaluateJavascript(syncScript, null);
                    }
                    prefs.edit().putBoolean(KEY_SCORE_MIGRATED, true).apply();
                } catch (Exception e) {
                    Log.w(TAG, "Error in high score migration", e);
                }
            }
        });
    }

    private static String downloadString(String urlStr) {
        byte[] data = downloadBytes(urlStr);
        return data != null ? new String(data, StandardCharsets.UTF_8) : null;
    }

    private static byte[] downloadBytes(String urlStr) {
        HttpURLConnection conn = null;
        InputStream in = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(12000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "AntiGravity-Android/1.1.0");

            int code = conn.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK) return null;

            in = conn.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        } catch (Exception e) {
            return null;
        } finally {
            if (in != null) try { in.close(); } catch (Exception ignored) {}
            if (conn != null) conn.disconnect();
        }
    }

    private static String sha256(byte[] data) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(data);
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static void deleteRecursively(File fileOrDir) {
        if (fileOrDir.isDirectory()) {
            File[] files = fileOrDir.listFiles();
            if (files != null) {
                for (File child : files) deleteRecursively(child);
            }
        }
        fileOrDir.delete();
    }

    public final class NativeBridge {
        @JavascriptInterface
        public void share(String message, String url) {
            runOnUiThread(() -> {
                // Security: Ensure URL matches trusted domain or public challenge scheme
                String sanitizedUrl = url;
                if (sanitizedUrl == null || !sanitizedUrl.startsWith("https://shaunmcintyre813.github.io/mobile-arcade-game/")) {
                    sanitizedUrl = "https://shaunmcintyre813.github.io/mobile-arcade-game/";
                }
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("text/plain");
                intent.putExtra(Intent.EXTRA_TEXT, message + "\n" + sanitizedUrl);
                startActivity(Intent.createChooser(intent, "Share challenge"));
            });
        }

        @JavascriptInterface
        public void setRoundState(boolean active) {
            isRoundActive = active;
        }

        @JavascriptInterface
        public void reportScore(int score) {
            if (score > 0) {
                int best = prefs.getInt(KEY_HIGH_SCORE, 0);
                if (score > best) {
                    prefs.edit().putInt(KEY_HIGH_SCORE, score).apply();
                }
            }
        }

        @JavascriptInterface
        public int getSavedHighScore() {
            return prefs.getInt(KEY_HIGH_SCORE, 0);
        }
    }

    @Override
    protected void onDestroy() {
        isDestroyed = true;
        updateExecutor.shutdownNow();
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
