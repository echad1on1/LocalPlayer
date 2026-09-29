package app.crate.player;

import android.webkit.JavascriptInterface;

/**
 * The methods the UI can call as {@code Native.xyz()}. They run on a WebView background thread,
 * so anything touching the player is posted to the main thread.
 */
final class WebBridge {
    private final MainActivity act;

    WebBridge(MainActivity act) {
        this.act = act;
    }

    private interface Command {
        void run(PlaybackService s);
    }

    private void onService(final Command c) {
        act.runOnMain(new Runnable() {
            @Override
            public void run() {
                PlaybackService s = act.service();
                if (s != null) c.run(s);
            }
        });
    }

    // ------------------------------------------------------------------ player state

    @JavascriptInterface
    public String state() {
        PlaybackService s = act.service();
        return s == null ? "null" : s.state();
    }

    @JavascriptInterface
    public String queue() {
        PlaybackService s = act.service();
        return s == null ? "null" : s.queueJson();
    }

    // ------------------------------------------------------------------ player commands

    @JavascriptInterface
    public void playIds(String idsJson, final int start, final boolean shuffle, final String label, final String ref) {
        final long[] ids = Json.parseIds(idsJson);
        onService(new Command() {
            @Override
            public void run(PlaybackService s) {
                s.playIds(ids, start, shuffle, label, ref);
            }
        });
    }

    @JavascriptInterface
    public void toggle() {
        onService(new Command() {
            @Override
            public void run(PlaybackService s) {
                s.toggle();
            }
        });
    }

    @JavascriptInterface
    public void play() {
        onService(new Command() {
            @Override
            public void run(PlaybackService s) {
                s.play();
            }
        });
    }

    @JavascriptInterface
    public void pause() {
        onService(new Command() {
            @Override
            public void run(PlaybackService s) {
                s.pause();
            }
        });
    }

    @JavascriptInterface
    public void next() {
        onService(new Command() {
            @Override
            public void run(PlaybackService s) {
                s.next();
            }
        });
    }

    @JavascriptInterface
    public void prev() {
        onService(new Command() {
            @Override
            public void run(PlaybackService s) {
                s.prev();
            }
        });
    }

    @JavascriptInterface
    public void seek(final double ms) {
        onService(new Command() {
            @Override
            public void run(PlaybackService s) {
                s.seekTo((long) ms);
            }
        });
    }

    @JavascriptInterface
    public void shuffle(final boolean on) {
        onService(new Command() {
            @Override
            public void run(PlaybackService s) {
                s.setShuffle(on);
            }
        });
    }

    @JavascriptInterface
    public void repeat(final int mode) {
        onService(new Command() {
            @Override
            public void run(PlaybackService s) {
                s.setRepeat(mode);
            }
        });
    }

    @JavascriptInterface
    public void jump(final double uid) {
        onService(new Command() {
            @Override
            public void run(PlaybackService s) {
                s.jumpTo((long) uid);
            }
        });
    }

    @JavascriptInterface
    public void add(String idsJson, final boolean playNext) {
        final long[] ids = Json.parseIds(idsJson);
        onService(new Command() {
            @Override
            public void run(PlaybackService s) {
                s.addIds(ids, playNext);
            }
        });
    }

    @JavascriptInterface
    public void remove(final double uid) {
        onService(new Command() {
            @Override
            public void run(PlaybackService s) {
                s.removeUid((long) uid);
            }
        });
    }

    @JavascriptInterface
    public void clearUpcoming(final boolean onlyUser) {
        onService(new Command() {
            @Override
            public void run(PlaybackService s) {
                s.clearUpcoming(onlyUser);
            }
        });
    }

    @JavascriptInterface
    public void sleep(final int minutes) {
        onService(new Command() {
            @Override
            public void run(PlaybackService s) {
                s.setSleep(minutes);
            }
        });
    }

    // ------------------------------------------------------------------ app

    @JavascriptInterface
    public String permission() {
        String state = act.permissionState();
        act.rememberPermissionState(state);
        return state;
    }

    @JavascriptInterface
    public void requestPermission() {
        act.runOnMain(new Runnable() {
            @Override
            public void run() {
                act.askPermissions();
            }
        });
    }

    @JavascriptInterface
    public void openSettings() {
        act.runOnMain(new Runnable() {
            @Override
            public void run() {
                act.openAppSettings();
            }
        });
    }

    @JavascriptInterface
    public String kvGet(String key) {
        return Store.get(act, key);
    }

    @JavascriptInterface
    public void kvSet(String key, String value) {
        Store.set(act, key, value);
    }

    @JavascriptInterface
    public String stats() {
        return Store.statsJson(act);
    }

    @JavascriptInterface
    public void clearStats() {
        Store.clearStats(act);
    }

    /** Forget the cached library; the UI then re-fetches /api/library. */
    @JavascriptInterface
    public void rescan() {
        Library.invalidate();
    }

    @JavascriptInterface
    public String insets() {
        return act.insets();
    }

    @JavascriptInterface
    public boolean consumeOpenPlayer() {
        return act.consumeOpenPlayer();
    }

    @JavascriptInterface
    public void haptic(final int kind) {
        act.runOnMain(new Runnable() {
            @Override
            public void run() {
                act.haptic(kind);
            }
        });
    }

    @JavascriptInterface
    public String version() {
        try {
            return act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "?";
        }
    }
}
