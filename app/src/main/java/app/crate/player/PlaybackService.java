package app.crate.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Binder;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import java.util.ArrayList;
import java.util.Random;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Plays music in the background: MediaPlayer + queue + media session (lock screen, headphones,
 * Bluetooth, notification controls). The UI is just a remote control for this service.
 * Everything here runs on the main thread except art loading and the library scan.
 */
public final class PlaybackService extends Service implements AudioManager.OnAudioFocusChangeListener {
    private static final String TAG = "CratePlayer";

    static final String ACTION_TOGGLE = "app.crate.player.action.TOGGLE";
    static final String ACTION_NEXT = "app.crate.player.action.NEXT";
    static final String ACTION_PREV = "app.crate.player.action.PREV";
    static final String ACTION_DISMISS = "app.crate.player.action.DISMISS";
    private static final String CUSTOM_SHUFFLE = "app.crate.player.custom.SHUFFLE";
    private static final String CUSTOM_REPEAT = "app.crate.player.custom.REPEAT";

    private static final String CHANNEL_ID = "playback";
    private static final int NOTIFICATION_ID = 1337;
    private static final int ACCENT = 0xFF35E07C;

    static final int REPEAT_OFF = 0;
    static final int REPEAT_ALL = 1;
    static final int REPEAT_ONE = 2;

    private static final AudioAttributes ATTRS = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build();

    interface Listener {
        void onPlayerState(String stateJson);
    }

    final class LocalBinder extends Binder {
        PlaybackService service() {
            return PlaybackService.this;
        }
    }

    private final IBinder binder = new LocalBinder();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService bg = Executors.newSingleThreadExecutor();
    private final Random rnd = new Random();
    private final PlayQueue queue = new PlayQueue(rnd);

    private AudioManager audio;
    private NotificationManager notifications;
    private MediaSession session;
    private AudioFocusRequest focusRequest;
    private MediaPlayer player;

    private int repeat = REPEAT_OFF;
    private String contextLabel = "";
    private String contextRef = "";

    private Library.Track current;
    private long loadedUid = -1;
    private boolean prepared, preparing, playWhenReady, playing, seeking;
    private long pendingSeek = -1;
    private long lastPosition;

    private Bitmap art;
    private long artForId = -1;

    private boolean started, foreground, hasFocus, focusHeld, resumeOnFocusGain, noisyRegistered;
    private boolean restored, userActed;
    private Library lastLibrary;
    private final ArrayList<Runnable> afterRestore = new ArrayList<Runnable>();
    private int errorsInARow;
    private String lastError = "";

    private long sleepAtElapsed;
    private boolean sleepEndOfTrack;

    private long playStartedAt = -1;
    private long playedMs;
    private boolean counted, historyAdded;

    private Listener listener;
    private volatile String stateJson = "null";
    private volatile String queueJson = "null";
    private int queueJsonVersion = -1;
    private int savedQueueVersion = -1;
    private long stateSeq;

    // ================================================================== lifecycle

    @Override
    public void onCreate() {
        super.onCreate();
        audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        notifications = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Now playing",
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Playback controls");
        channel.setShowBadge(false);
        notifications.createNotificationChannel(channel);

        session = new MediaSession(this, "Crate");
        session.setCallback(sessionCallback, main);
        session.setSessionActivity(openAppIntent());

        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(ATTRS)
                .setOnAudioFocusChangeListener(this, main)
                .setWillPauseWhenDucked(false)
                .build();

        repeat = prefs().getInt("repeat", REPEAT_OFF);
        publishState();
        restore();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        started = true;
        String action = intent == null ? null : intent.getAction();
        if (action != null) handleAction(action);
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (!playing && !playWhenReady) stopAndClear();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        finishCounting(false);
        saveState();
        main.removeCallbacksAndMessages(null);
        unregisterNoisy();
        abandonFocus();
        if (player != null) {
            try {
                player.release();
            } catch (Exception ignored) {
                // already gone
            }
            player = null;
        }
        session.setActive(false);
        session.release();
        notifications.cancel(NOTIFICATION_ID);
        bg.shutdownNow();
        listener = null;
        super.onDestroy();
    }

    private void handleAction(final String action) {
        if (!restored) {
            afterRestore.add(new Runnable() {
                @Override
                public void run() {
                    handleAction(action);
                }
            });
            return;
        }
        if (ACTION_TOGGLE.equals(action)) toggle();
        else if (ACTION_NEXT.equals(action)) next();
        else if (ACTION_PREV.equals(action)) prev();
        else if (ACTION_DISMISS.equals(action)) {
            if (!playing && !playWhenReady) stopAndClear();
        }
    }

    private void stopAndClear() {
        finishCounting(false);
        saveState();
        if (foreground) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
            foreground = false;
        }
        notifications.cancel(NOTIFICATION_ID);
        session.setActive(false);
        started = false;
        stopSelf();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("crate_player", Context.MODE_PRIVATE);
    }

    // ================================================================== restore / save

    private void restore() {
        if (!Perms.hasAudio(this)) {
            finishRestore();
            return;
        }
        final Context app = getApplicationContext();
        runInBackground(new Runnable() {
            @Override
            public void run() {
                final Library lib = Library.get(app);
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        lastLibrary = lib;
                        applyRestore(lib);
                    }
                });
            }
        });
    }

    private void applyRestore(Library lib) {
        if (!userActed && lib.permitted) {
            SharedPreferences p = prefs();
            String qs = p.getString("queue", null);
            int result = queue.restoreFrom(qs, p.getInt("index", 0), lib.ids());
            if (result != PlayQueue.RESTORE_FAILED) {
                savedQueueVersion = -1;
                contextLabel = p.getString("ctx", "");
                contextRef = p.getString("ref", "");
                long pos = result == PlayQueue.RESTORE_OK ? p.getLong("position", 0) : 0;
                loadCurrent(false, pos);
            }
        }
        finishRestore();
    }

    private void finishRestore() {
        restored = true;
        ArrayList<Runnable> pending = new ArrayList<Runnable>(afterRestore);
        afterRestore.clear();
        for (Runnable r : pending) r.run();
        publishState();
    }

    /** Called by the UI once the user granted access to their music. */
    void onPermissionGranted() {
        if (queue.size() == 0 && !userActed && restored) {
            restored = false;
            restore();
        }
    }

    private void saveState() {
        if (!restored && !userActed) return;
        if (queue.size() == 0 && !userActed) return;
        SharedPreferences.Editor ed = prefs().edit();
        if (savedQueueVersion != queue.version()) {
            ed.putString("queue", queue.serialize());
            savedQueueVersion = queue.version();
        }
        ed.putInt("index", queue.index())
                .putLong("position", position())
                .putInt("repeat", repeat)
                .putString("ctx", contextLabel)
                .putString("ref", contextRef)
                .apply();
    }

    // ================================================================== commands (main thread)

    void setListener(Listener l) {
        listener = l;
        if (l != null) l.onPlayerState(stateJson);
    }

    String state() {
        return stateJson;
    }

    String queueJson() {
        return queueJson;
    }

    void playIds(long[] ids, int start, boolean shuffle, String label, String ref) {
        userActed = true;
        if (ids.length == 0) return;
        queue.set(ids, start, shuffle);
        contextLabel = label == null ? "" : label;
        contextRef = ref == null ? "" : ref;
        errorsInARow = 0;
        loadCurrent(true, 0);
        saveState();
    }

    void play() {
        resumeOnFocusGain = false;
        if (!restored) {
            afterRestore.add(new Runnable() {
                @Override
                public void run() {
                    play();
                }
            });
            return;
        }
        userActed = true;
        if (current == null) {
            if (queue.current() != null) loadCurrent(true, lastPosition);
            return;
        }
        startInternal();
    }

    void pause() {
        resumeOnFocusGain = false;
        if (playing || playWhenReady) pauseInternal(false);
    }

    void toggle() {
        if (playing || (preparing && playWhenReady)) pause();
        else play();
    }

    void next() {
        if (queue.size() == 0) return;
        userActed = true;
        boolean play = playing || playWhenReady;
        boolean wrapped = queue.isLast();
        if (queue.moveNext(true) == null) return;
        if (wrapped && repeat == REPEAT_OFF) play = false;
        loadCurrent(play, 0);
        saveState();
    }

    void prev() {
        if (current == null && queue.size() == 0) return;
        userActed = true;
        if (position() > 3000) {
            seekTo(0);
            return;
        }
        boolean play = playing || playWhenReady;
        if (queue.movePrev(repeat == REPEAT_ALL) == null) {
            seekTo(0);
            return;
        }
        loadCurrent(play, 0);
        saveState();
    }

    void seekTo(long ms) {
        if (current == null) return;
        long d = duration();
        if (ms < 0) ms = 0;
        if (d > 0 && ms > d) ms = d;
        lastPosition = ms;
        if (prepared) {
            try {
                seeking = true;
                player.seekTo((int) ms);
            } catch (IllegalStateException e) {
                seeking = false;
            }
        } else {
            pendingSeek = ms;
        }
        updateSessionState();
        publishState();
    }

    void setShuffle(boolean on) {
        userActed = true;
        queue.setShuffle(on);
        updateSessionState();
        publishState();
        saveState();
    }

    void setRepeat(int mode) {
        repeat = ((mode % 3) + 3) % 3;
        updateSessionState();
        publishState();
        saveState();
    }

    void jumpTo(long uid) {
        userActed = true;
        if (queue.jumpTo(uid)) {
            loadCurrent(true, 0);
            saveState();
        }
    }

    void addIds(long[] ids, boolean playNext) {
        if (ids.length == 0) return;
        userActed = true;
        boolean wasEmpty = queue.size() == 0;
        queue.add(ids, playNext);
        if (wasEmpty) {
            contextLabel = "Your queue";
            contextRef = "queue";
            loadCurrent(true, 0);
        } else {
            publishState();
        }
        saveState();
    }

    void removeUid(long uid) {
        if (queue.remove(uid)) {
            publishState();
            saveState();
        }
    }

    void clearUpcoming(boolean onlyUser) {
        queue.clearUpcoming(onlyUser);
        publishState();
        saveState();
    }

    void setSleep(int minutes) {
        main.removeCallbacks(sleepRunnable);
        sleepAtElapsed = 0;
        sleepEndOfTrack = false;
        if (minutes > 0) {
            sleepAtElapsed = SystemClock.elapsedRealtime() + minutes * 60000L;
            main.postDelayed(sleepRunnable, minutes * 60000L);
        } else if (minutes < 0) {
            sleepEndOfTrack = true;
        }
        publishState();
    }

    private final Runnable sleepRunnable = new Runnable() {
        @Override
        public void run() {
            sleepAtElapsed = 0;
            pause();
            publishState();
        }
    };

    // ================================================================== player internals

    /** The library snapshot, without blocking the main thread on a rescan when we can avoid it. */
    private Library library() {
        Library l = Library.peek();
        if (l != null) {
            lastLibrary = l;
            return l;
        }
        if (lastLibrary != null) {
            final Context app = getApplicationContext();
            runInBackground(new Runnable() {
                @Override
                public void run() {
                    Library.get(app);
                }
            });
            return lastLibrary;
        }
        lastLibrary = Library.get(getApplicationContext());
        return lastLibrary;
    }

    private void runInBackground(Runnable r) {
        try {
            bg.execute(r);
        } catch (RuntimeException e) {
            Log.w(TAG, "Background task rejected", e);
        }
    }

    private void ensurePlayer() {
        if (player != null) return;
        player = new MediaPlayer();
        player.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);
        player.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
            @Override
            public void onPrepared(MediaPlayer mp) {
                preparing = false;
                prepared = true;
                if (pendingSeek > 0) {
                    try {
                        seeking = true;
                        mp.seekTo((int) pendingSeek);
                    } catch (IllegalStateException e) {
                        seeking = false;
                    }
                }
                pendingSeek = -1;
                updateMetadata();
                if (playWhenReady) {
                    startInternal();
                } else {
                    updateSessionState();
                    publishState();
                }
            }
        });
        player.setOnSeekCompleteListener(new MediaPlayer.OnSeekCompleteListener() {
            @Override
            public void onSeekComplete(MediaPlayer mp) {
                seeking = false;
                updateSessionState();
                publishState();
            }
        });
        player.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
            @Override
            public void onCompletion(MediaPlayer mp) {
                onCompleted();
            }
        });
        player.setOnErrorListener(new MediaPlayer.OnErrorListener() {
            @Override
            public boolean onError(MediaPlayer mp, int what, int extra) {
                onPlaybackError("Can't play this file (" + what + "/" + extra + ")");
                return true;
            }
        });
    }

    /** Loads the queue's current song into the player. */
    private void loadCurrent(boolean play, long startAt) {
        finishCounting(false);
        PlayQueue.Entry e = queue.current();
        if (e == null) {
            unload();
            return;
        }
        Library.Track t = library().find(e.id);
        current = t;
        loadedUid = e.uid;
        lastPosition = Math.max(0, startAt);
        prepared = false;
        preparing = false;
        seeking = false;
        pendingSeek = startAt > 0 ? startAt : -1;
        playWhenReady = play;
        playing = false;
        playedMs = 0;
        playStartedAt = -1;
        counted = false;
        historyAdded = false;
        stopTick();
        if (t == null) {
            onPlaybackError("Song not found");
            return;
        }
        ensurePlayer();
        try {
            player.reset();
            player.setAudioAttributes(ATTRS);
            player.setDataSource(getApplicationContext(), t.uri());
            preparing = true;
            player.prepareAsync();
        } catch (Exception ex) {
            preparing = false;
            Log.w(TAG, "Can't open " + t.key, ex);
            onPlaybackError("Can't open " + t.fileName);
            return;
        }
        updateMetadata();
        loadArt(t);
        updateSessionState();
        publishState();
    }

    private void unload() {
        if (player != null) {
            try {
                player.reset();
            } catch (Exception ignored) {
                // ignore
            }
        }
        current = null;
        loadedUid = -1;
        prepared = preparing = playing = playWhenReady = seeking = false;
        lastPosition = 0;
        unregisterNoisy();
        abandonFocus();
        stopTick();
        if (foreground) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
            foreground = false;
        }
        notifications.cancel(NOTIFICATION_ID);
        session.setMetadata(null);
        updateSessionState();
        publishState();
    }

    private void startInternal() {
        if (current == null) return;
        if (!prepared) {
            playWhenReady = true;
            if (!preparing) loadCurrent(true, lastPosition);
            else publishState();
            return;
        }
        if (!requestFocus()) {
            playWhenReady = false;
            lastError = "Another app is using audio";
            publishState();
            return;
        }
        try {
            player.start();
        } catch (IllegalStateException e) {
            onPlaybackError("Playback failed");
            return;
        }
        playing = true;
        playWhenReady = true;
        errorsInARow = 0;
        lastError = "";
        playStartedAt = SystemClock.elapsedRealtime();
        if (!historyAdded) {
            historyAdded = true;
            Store.addHistory(this, current.key);
        }
        registerNoisy();
        if (!session.isActive()) session.setActive(true);
        goForeground();
        updateSessionState();
        publishState();
        scheduleTick();
    }

    private void pauseInternal(boolean transientLoss) {
        playWhenReady = false;
        if (playing) {
            try {
                player.pause();
            } catch (IllegalStateException ignored) {
                // not playing
            }
        }
        lastPosition = position();
        finishCounting(false);
        accumulate();
        playing = false;
        unregisterNoisy();
        if (!transientLoss) abandonFocus();
        stopTick();
        leaveForeground();
        updateSessionState();
        publishState();
        saveState();
    }

    private void onCompleted() {
        accumulate();
        finishCounting(true);
        playing = false;
        if (repeat == REPEAT_ONE && !sleepEndOfTrack) {
            try {
                player.seekTo(0);
                player.start();
            } catch (IllegalStateException e) {
                onPlaybackError("Playback failed");
                return;
            }
            playing = true;
            counted = false;
            playedMs = 0;
            playStartedAt = SystemClock.elapsedRealtime();
            lastPosition = 0;
            Store.addHistory(this, current.key);
            updateSessionState();
            publishState();
            return;
        }
        boolean stopAfter = sleepEndOfTrack;
        sleepEndOfTrack = false;
        if (queue.isLast() && repeat != REPEAT_ALL) {
            // End of the album/playlist: rewind to the first song and stop.
            queue.first();
            loadCurrent(false, 0);
            stopped();
            return;
        }
        queue.moveNext(true);
        loadCurrent(!stopAfter, 0);
        if (stopAfter) stopped();
        saveState();
    }

    /** Playback stopped by itself (end of queue, sleep timer): release focus and foreground. */
    private void stopped() {
        playWhenReady = false;
        unregisterNoisy();
        abandonFocus();
        stopTick();
        leaveForeground();
        updateSessionState();
        publishState();
        saveState();
    }

    private void onPlaybackError(String msg) {
        Log.w(TAG, "Playback error: " + msg);
        prepared = false;
        preparing = false;
        playing = false;
        seeking = false;
        lastError = msg;
        errorsInARow++;
        boolean wantPlay = playWhenReady;
        int limit = Math.min(Math.max(queue.size(), 1), 10);
        if (errorsInARow >= limit || queue.size() <= 1) {
            errorsInARow = 0;
            stopped();
            return;
        }
        queue.moveNext(true);
        loadCurrent(wantPlay, 0);
    }

    private long position() {
        if (prepared && !seeking && player != null) {
            try {
                lastPosition = player.getCurrentPosition();
            } catch (IllegalStateException ignored) {
                // keep last
            }
        }
        return lastPosition;
    }

    private long duration() {
        if (prepared && player != null) {
            try {
                int d = player.getDuration();
                if (d > 0) return d;
            } catch (IllegalStateException ignored) {
                // fall through
            }
        }
        return current != null ? current.duration : 0;
    }

    private void accumulate() {
        if (playStartedAt >= 0) {
            playedMs += SystemClock.elapsedRealtime() - playStartedAt;
            playStartedAt = -1;
        }
    }

    /** Counts a play once the song played for 30 s (or half of it, if shorter), or finished. */
    private void finishCounting(boolean completed) {
        if (current == null || counted) return;
        boolean wasTiming = playStartedAt >= 0;
        accumulate();
        long threshold = current.duration > 0 ? Math.min(30000, current.duration / 2) : 30000;
        if (completed || playedMs >= threshold) {
            counted = true;
            Store.countPlay(this, current.key);
        }
        if (wasTiming && playing) playStartedAt = SystemClock.elapsedRealtime();
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!playing) return;
            finishCounting(false);
            saveState();
            main.postDelayed(this, 10000);
        }
    };

    private void scheduleTick() {
        main.removeCallbacks(tick);
        main.postDelayed(tick, 10000);
    }

    private void stopTick() {
        main.removeCallbacks(tick);
    }

    // ================================================================== audio focus & headphones

    private boolean requestFocus() {
        if (hasFocus) return true;
        int r = audio.requestAudioFocus(focusRequest);
        focusHeld = r != AudioManager.AUDIOFOCUS_REQUEST_FAILED;
        hasFocus = r == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        return hasFocus;
    }

    private void abandonFocus() {
        if (focusHeld || hasFocus) audio.abandonAudioFocusRequest(focusRequest);
        focusHeld = false;
        hasFocus = false;
    }

    @Override
    public void onAudioFocusChange(int change) {
        switch (change) {
            case AudioManager.AUDIOFOCUS_GAIN:
                hasFocus = true;
                if (resumeOnFocusGain) {
                    resumeOnFocusGain = false;
                    startInternal();
                }
                break;
            case AudioManager.AUDIOFOCUS_LOSS:
                resumeOnFocusGain = false;
                if (playing || playWhenReady) pauseInternal(false);
                abandonFocus();
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                hasFocus = false;
                if (playing) {
                    pauseInternal(true);
                    resumeOnFocusGain = true;
                }
                break;
            default:
                // LOSS_TRANSIENT_CAN_DUCK: Android lowers our volume automatically.
                break;
        }
    }

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) pause();
        }
    };

    private void registerNoisy() {
        if (noisyRegistered) return;
        IntentFilter f = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        try {
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisyReceiver, f, Context.RECEIVER_EXPORTED);
            else registerReceiver(noisyReceiver, f);
            noisyRegistered = true;
        } catch (Exception e) {
            Log.w(TAG, "Can't listen for headphone unplug", e);
        }
    }

    private void unregisterNoisy() {
        if (!noisyRegistered) return;
        try {
            unregisterReceiver(noisyReceiver);
        } catch (Exception ignored) {
            // not registered
        }
        noisyRegistered = false;
    }

    // ================================================================== media session & notification

    private final MediaSession.Callback sessionCallback = new MediaSession.Callback() {
        @Override
        public void onPlay() {
            play();
        }

        @Override
        public void onPause() {
            pause();
        }

        @Override
        public void onStop() {
            pause();
        }

        @Override
        public void onSkipToNext() {
            next();
        }

        @Override
        public void onSkipToPrevious() {
            prev();
        }

        @Override
        public void onSeekTo(long pos) {
            seekTo(pos);
        }

        @Override
        public void onSkipToQueueItem(long id) {
            jumpTo(id);
        }

        @Override
        public void onCustomAction(String action, Bundle extras) {
            if (CUSTOM_SHUFFLE.equals(action)) setShuffle(!queue.shuffle());
            else if (CUSTOM_REPEAT.equals(action)) setRepeat(repeat + 1);
        }
    };

    private void updateMetadata() {
        Library.Track t = current;
        if (t == null) {
            session.setMetadata(null);
            return;
        }
        MediaMetadata.Builder b = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, String.valueOf(t.id))
                .putString(MediaMetadata.METADATA_KEY_TITLE, t.title)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, t.title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, t.artist)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, t.artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST, t.artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, t.album)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, duration());
        if (t.track % 1000 > 0) b.putLong(MediaMetadata.METADATA_KEY_TRACK_NUMBER, t.track % 1000);
        if (art != null && artForId == t.id) b.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
        session.setMetadata(b.build());
    }

    private void loadArt(final Library.Track t) {
        if (artForId == t.id) return;
        final long id = t.id;
        final Context app = getApplicationContext();
        runInBackground(new Runnable() {
            @Override
            public void run() {
                final Bitmap b = ArtLoader.bitmap(app, id, 512);
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        if (current == null || current.id != id) return;
                        art = b;
                        artForId = id;
                        updateMetadata();
                        refreshNotification();
                    }
                });
            }
        });
    }

    private void updateSessionState() {
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP | PlaybackState.ACTION_SKIP_TO_QUEUE_ITEM;
        int st;
        if (current == null) st = PlaybackState.STATE_NONE;
        else if (playing) st = PlaybackState.STATE_PLAYING;
        else if (preparing && playWhenReady) st = PlaybackState.STATE_BUFFERING;
        else st = PlaybackState.STATE_PAUSED;
        boolean sh = queue.shuffle();
        int repeatIcon = repeat == REPEAT_ONE ? R.drawable.ic_n_repeat_one
                : repeat == REPEAT_ALL ? R.drawable.ic_n_repeat_on : R.drawable.ic_n_repeat;
        String repeatName = repeat == REPEAT_ONE ? "Repeat one" : repeat == REPEAT_ALL ? "Repeat all" : "Repeat off";
        PlaybackState state = new PlaybackState.Builder()
                .setActions(actions)
                .setState(st, position(), playing ? 1f : 0f, SystemClock.elapsedRealtime())
                .setActiveQueueItemId(loadedUid)
                .addCustomAction(new PlaybackState.CustomAction.Builder(CUSTOM_SHUFFLE,
                        sh ? "Shuffle on" : "Shuffle off",
                        sh ? R.drawable.ic_n_shuffle_on : R.drawable.ic_n_shuffle).build())
                .addCustomAction(new PlaybackState.CustomAction.Builder(CUSTOM_REPEAT, repeatName, repeatIcon).build())
                .build();
        session.setPlaybackState(state);
        refreshNotification();
    }

    private PendingIntent openAppIntent() {
        Intent i = new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .putExtra(MainActivity.EXTRA_OPEN_PLAYER, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private PendingIntent serviceIntent(String action, int requestCode) {
        Intent i = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, i,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification.Action action(int icon, String title, String act, int requestCode) {
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), title,
                serviceIntent(act, requestCode)).build();
    }

    private Notification buildNotification() {
        Library.Track t = current;
        boolean on = playing || playWhenReady;
        Notification.Builder b = new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_crate)
                .setContentTitle(t != null ? t.title : getString(R.string.app_name))
                .setContentText(t != null ? t.artist : "")
                .setSubText(t != null ? t.album : null)
                .setContentIntent(openAppIntent())
                .setDeleteIntent(serviceIntent(ACTION_DISMISS, 4))
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setOngoing(on)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setColor(ACCENT)
                .addAction(action(R.drawable.ic_n_prev, "Previous", ACTION_PREV, 1))
                .addAction(on ? action(R.drawable.ic_n_pause, "Pause", ACTION_TOGGLE, 2)
                        : action(R.drawable.ic_n_play, "Play", ACTION_TOGGLE, 2))
                .addAction(action(R.drawable.ic_n_next, "Next", ACTION_NEXT, 3))
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));
        if (t != null && art != null && artForId == t.id) b.setLargeIcon(art);
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    private void refreshNotification() {
        if (current == null || (!foreground && !started)) return;
        try {
            notifications.notify(NOTIFICATION_ID, buildNotification());
        } catch (Exception e) {
            Log.w(TAG, "Notification update failed", e);
        }
    }

    private void goForeground() {
        Notification n = buildNotification();
        if (!started) {
            try {
                startService(new Intent(this, PlaybackService.class));
                started = true;
            } catch (Exception e) {
                Log.w(TAG, "startService failed", e);
            }
        }
        try {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            foreground = true;
        } catch (Exception e) {
            // Android may refuse when we're in the background; keep playing and just show the notification.
            Log.w(TAG, "startForeground failed", e);
            try {
                notifications.notify(NOTIFICATION_ID, n);
            } catch (Exception ignored) {
                // no notification permission
            }
        }
    }

    private void leaveForeground() {
        if (foreground) {
            stopForeground(Service.STOP_FOREGROUND_DETACH);
            foreground = false;
        }
        refreshNotification();
    }

    // ================================================================== state for the UI

    private void publishState() {
        if (queueJsonVersion != queue.version()) {
            StringBuilder qb = new StringBuilder(queue.size() * 16 + 64);
            queue.appendJson(qb);
            queueJson = qb.toString();
            queueJsonVersion = queue.version();
        }
        PlayQueue.Entry e = queue.current();
        long sleep = sleepEndOfTrack ? -2 : sleepAtElapsed > 0
                ? Math.max(0, sleepAtElapsed - SystemClock.elapsedRealtime()) : -1;
        StringBuilder sb = new StringBuilder(320);
        sb.append("{\"seq\":").append(++stateSeq)
                .append(",\"id\":").append(current != null ? current.id : (e != null ? e.id : -1))
                .append(",\"uid\":").append(e != null ? e.uid : -1)
                .append(",\"idx\":").append(queue.index())
                .append(",\"len\":").append(queue.size())
                .append(",\"qv\":").append(queue.version())
                .append(",\"up\":").append(queue.upcomingUserCount())
                .append(",\"playing\":").append(playing || (preparing && playWhenReady))
                .append(",\"buffering\":").append(preparing || seeking)
                .append(",\"pos\":").append(position())
                .append(",\"dur\":").append(duration())
                .append(",\"ts\":").append(System.currentTimeMillis())
                .append(",\"shuffle\":").append(queue.shuffle())
                .append(",\"repeat\":").append(repeat)
                .append(",\"sleep\":").append(sleep)
                .append(",\"ctx\":");
        Json.q(sb, contextLabel).append(",\"ref\":");
        Json.q(sb, contextRef).append(",\"err\":");
        Json.q(sb, lastError).append('}');
        stateJson = sb.toString();
        if (listener != null) listener.onPlayerState(stateJson);
    }
}
