package app.crate.player;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.ContentObserver;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Log;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Hosts the UI (HTML/CSS/JS in assets/web) and connects it to the playback service. */
public final class MainActivity extends Activity implements PlaybackService.Listener {
    static final String EXTRA_OPEN_PLAYER = "open_player";
    private static final String TAG = "Crate";
    private static final int REQ_PERMISSIONS = 7;
    private static final int BG = 0xFF0A0B0A;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private FrameLayout root;
    private WebView web;
    private AssetServer server;
    private volatile PlaybackService service;
    private boolean bound;
    private boolean resumed;
    private boolean libraryChangedWhilePaused;
    private volatile boolean openPlayerPending;
    private volatile String insetsJson = "{\"t\":0,\"b\":0,\"l\":0,\"r\":0,\"k\":0}";
    private volatile String lastPermissionState;
    private ContentObserver mediaObserver;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setDecorFitsSystemWindows(false);
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        w.setNavigationBarContrastEnforced(false);
        w.setStatusBarContrastEnforced(false);

        server = new AssetServer(this);
        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        setContentView(root);
        WindowInsetsController ic = w.getInsetsController();
        if (ic != null) {
            ic.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                float d = getResources().getDisplayMetrics().density;
                insetsJson = String.format(Locale.ROOT, "{\"t\":%.1f,\"b\":%.1f,\"l\":%.1f,\"r\":%.1f,\"k\":%.1f}",
                        bars.top / d, bars.bottom / d, bars.left / d, bars.right / d, ime.bottom / d);
                js("window.__crate&&__crate.setInsets(" + insetsJson + ")");
                return WindowInsets.CONSUMED;
            }
        });
        createWebView();

        openPlayerPending = getIntent() != null && getIntent().getBooleanExtra(EXTRA_OPEN_PLAYER, false);
        bound = bindService(new Intent(this, PlaybackService.class), connection, Context.BIND_AUTO_CREATE);

        mediaObserver = new ContentObserver(main) {
            @Override
            public void onChange(boolean selfChange) {
                main.removeCallbacks(checkLibrary);
                main.postDelayed(checkLibrary, 2500);
            }
        };
        try {
            getContentResolver().registerContentObserver(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, true, mediaObserver);
        } catch (Exception e) {
            Log.w(TAG, "Can't watch the media library", e);
        }
    }

    private void createWebView() {
        web = new WebView(this);
        web.setBackgroundColor(BG);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setHapticFeedbackEnabled(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return server.handle(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !AssetServer.HOST.equals(request.getUrl().getHost());
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.w(TAG, "WebView renderer gone; rebuilding UI");
                if (view == web) {
                    root.removeView(web);
                    web.destroy();
                    web = null;
                    createWebView();
                } else {
                    view.destroy();
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d("CrateUI", m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
        web.addJavascriptInterface(new WebBridge(this), "Native");
        WebView.setWebContentsDebuggingEnabled(true);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        web.loadUrl(AssetServer.ORIGIN + "/index.html");
    }

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            PlaybackService s = ((PlaybackService.LocalBinder) binder).service();
            service = s;
            s.setListener(MainActivity.this);
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            service = null;
        }
    };

    PlaybackService service() {
        return service;
    }

    @Override
    public void onPlayerState(String stateJson) {
        js("window.__crate&&__crate.onState(" + stateJson + ")");
    }

    /** Runs JavaScript in the UI (main thread only). */
    void js(String code) {
        if (web != null) web.evaluateJavascript(code, null);
    }

    void runOnMain(Runnable r) {
        main.post(r);
    }

    String insets() {
        return insetsJson;
    }

    boolean consumeOpenPlayer() {
        boolean v = openPlayerPending;
        openPlayerPending = false;
        return v;
    }

    void haptic(int kind) {
        if (web == null) return;
        int c;
        if (kind == 1) c = HapticFeedbackConstants.LONG_PRESS;
        else if (kind == 2) c = HapticFeedbackConstants.CONFIRM;
        else c = HapticFeedbackConstants.KEYBOARD_TAP;
        web.performHapticFeedback(c);
    }

    // ------------------------------------------------------------------ library changes

    private final Runnable checkLibrary = new Runnable() {
        @Override
        public void run() {
            if (!Perms.hasAudio(MainActivity.this)) return;
            final Context app = getApplicationContext();
            try {
                io.execute(new Runnable() {
                    @Override
                    public void run() {
                        Library before = Library.peek();
                        Library.invalidate();
                        Library after = Library.get(app);
                        if (before == null || before.signature != after.signature) {
                            main.post(new Runnable() {
                                @Override
                                public void run() {
                                    if (resumed) js("window.__crate&&__crate.libraryChanged()");
                                    else libraryChangedWhilePaused = true;
                                }
                            });
                        }
                    }
                });
            } catch (RuntimeException ignored) {
                // shutting down
            }
        }
    };

    // ------------------------------------------------------------------ permissions

    String permissionState() {
        String p = Perms.audio();
        if (checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED) return "granted";
        SharedPreferences sp = getSharedPreferences("crate_app", MODE_PRIVATE);
        if (sp.getBoolean("asked_audio", false) && !shouldShowRequestPermissionRationale(p)) return "blocked";
        return "ask";
    }

    void askPermissions() {
        getSharedPreferences("crate_app", MODE_PRIVATE).edit().putBoolean("asked_audio", true).apply();
        ArrayList<String> list = new ArrayList<String>();
        list.add(Perms.audio());
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            list.add(android.Manifest.permission.POST_NOTIFICATIONS);
        }
        requestPermissions(list.toArray(new String[0]), REQ_PERMISSIONS);
    }

    void openAppSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", getPackageName(), null)));
        } catch (Exception e) {
            Log.w(TAG, "Can't open app settings", e);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_PERMISSIONS) notifyPermission(true);
    }

    private void notifyPermission(boolean force) {
        String state = permissionState();
        if (!force && state.equals(lastPermissionState)) return;
        boolean newlyGranted = "granted".equals(state) && !"granted".equals(lastPermissionState);
        lastPermissionState = state;
        if (newlyGranted) {
            Library.invalidate();
            PlaybackService s = service;
            if (s != null) s.onPermissionGranted();
        }
        js("window.__crate&&__crate.onPermission(" + Json.q(state) + ")");
    }

    void rememberPermissionState(String state) {
        lastPermissionState = state;
    }

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.getBooleanExtra(EXTRA_OPEN_PLAYER, false)) {
            js("window.__crate&&__crate.openPlayer()");
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        if (web != null) web.onResume();
        if (lastPermissionState != null) notifyPermission(false);
        if (libraryChangedWhilePaused) {
            libraryChangedWhilePaused = false;
            js("window.__crate&&__crate.libraryChanged()");
        }
    }

    @Override
    protected void onPause() {
        resumed = false;
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web == null) {
            moveTaskToBack(true);
            return;
        }
        web.evaluateJavascript("window.__crate?__crate.back():false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (!"true".equals(value)) moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        if (mediaObserver != null) {
            try {
                getContentResolver().unregisterContentObserver(mediaObserver);
            } catch (Exception ignored) {
                // not registered
            }
        }
        PlaybackService s = service;
        if (s != null) s.setListener(null);
        if (bound) {
            try {
                unbindService(connection);
            } catch (Exception ignored) {
                // already unbound
            }
            bound = false;
        }
        service = null;
        io.shutdownNow();
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
