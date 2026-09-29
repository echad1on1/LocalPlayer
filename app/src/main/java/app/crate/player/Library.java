package app.crate.player;

import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Log;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Reads every song Android's media index knows about and applies the folder rules.
 * One immutable snapshot is cached and shared by the UI and the playback service.
 */
final class Library {
    private static final String TAG = "CrateLibrary";

    static final class Track {
        final long id;
        final String title;
        final String artist;      // from folders
        final String album;       // from folders
        final String albumKey;
        final String volume;
        final String relPath;     // "Music/Artist/Album/"
        final String fileName;
        final String tagArtist;   // from the file's tags ("<unknown>" if none)
        final String key;         // stable id: volume:relPath+fileName
        final String sub;         // disc sub-folder inside the album, or ""
        final long duration;
        final long dateAdded;
        final int track;
        final int year;
        final boolean inRoots;

        Track(long id, String title, String artist, String album, String albumKey, String volume,
              String relPath, String fileName, String tagArtist, String key, String sub, long duration,
              long dateAdded, int track, int year, boolean inRoots) {
            this.id = id;
            this.title = title;
            this.artist = artist;
            this.album = album;
            this.albumKey = albumKey;
            this.volume = volume;
            this.relPath = relPath;
            this.fileName = fileName;
            this.tagArtist = tagArtist;
            this.key = key;
            this.sub = sub;
            this.duration = duration;
            this.dateAdded = dateAdded;
            this.track = track;
            this.year = year;
            this.inRoots = inRoots;
        }

        Uri uri() {
            return ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
        }
    }

    private static final class Raw {
        long id, duration, dateAdded;
        int track, year;
        String title, artist, album, relPath, fileName, volume;
    }

    private static final Object SCAN_LOCK = new Object();
    private static final AtomicInteger GENERATION = new AtomicInteger();
    private static volatile Library cached;

    final boolean permitted;
    final List<Track> tracks;
    final Map<Long, Track> byId;
    final String json;
    final long signature;

    private Library(boolean permitted, List<Track> tracks, Map<Long, Track> byId, String json, long signature) {
        this.permitted = permitted;
        this.tracks = tracks;
        this.byId = byId;
        this.json = json;
        this.signature = signature;
    }

    Set<Long> ids() {
        return byId.keySet();
    }

    Track find(long id) {
        return byId.get(id);
    }

    /** Returns the cached library, scanning the media index if needed. Never call on the main thread first. */
    static Library get(Context ctx) {
        Library c = cached;
        if (c != null) return c;
        synchronized (SCAN_LOCK) {
            c = cached;
            if (c != null) return c;
            int gen = GENERATION.get();
            Library lib = scan(ctx.getApplicationContext());
            if (lib.permitted && gen == GENERATION.get()) cached = lib;
            return lib;
        }
    }

    static Library peek() {
        return cached;
    }

    static void invalidate() {
        GENERATION.incrementAndGet();
        cached = null;
        ArtLoader.clearMisses();
    }

    // ------------------------------------------------------------------ scanning

    private static Library scan(Context ctx) {
        boolean permitted = Perms.hasAudio(ctx);
        ArrayList<Raw> raws = new ArrayList<Raw>();
        if (permitted) {
            Uri uri = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL);
            String[] proj = {"_id", "title", "artist", "album", "duration", "track", "year",
                    "relative_path", "_display_name", "volume_name", "date_added"};
            Cursor c = null;
            try {
                c = ctx.getContentResolver().query(uri, proj, "is_music != 0", null, null);
                if (c != null) {
                    while (c.moveToNext()) {
                        Raw r = new Raw();
                        r.id = c.getLong(0);
                        r.title = c.getString(1);
                        r.artist = c.getString(2);
                        r.album = c.getString(3);
                        r.duration = c.isNull(4) ? 0 : c.getLong(4);
                        r.track = c.isNull(5) ? 0 : safeInt(c, 5);
                        r.year = c.isNull(6) ? 0 : safeInt(c, 6);
                        r.relPath = c.getString(7);
                        r.fileName = c.getString(8);
                        r.volume = c.getString(9);
                        r.dateAdded = c.isNull(10) ? 0 : c.getLong(10);
                        if (r.relPath == null) r.relPath = "";
                        if (r.volume == null) r.volume = MediaStore.VOLUME_EXTERNAL_PRIMARY;
                        if (r.fileName == null) r.fileName = String.valueOf(r.id);
                        raws.add(r);
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Media scan failed", e);
            } finally {
                if (c != null) c.close();
            }
        }

        // ---- which folders count as the music library
        ArrayList<String> specs = new ArrayList<String>();
        boolean auto = true;
        String rootsRaw = Store.get(ctx, "roots");
        if (rootsRaw != null) {
            try {
                JSONArray a = new JSONArray(rootsRaw);
                for (int i = 0; i < a.length(); i++) specs.add(a.getString(i));
                auto = specs.isEmpty();
            } catch (Exception ignored) {
                specs.clear();
            }
        }
        
        if (auto) {
    specs.clear();
    boolean hasMusic = false;
    for (Raw r : raws) {
        String[] p = FolderRules.split(r.relPath);
        if (p.length > 0 && p[0].equalsIgnoreCase("Music")) {
            hasMusic = true;
            break;
        }
    }
    if (hasMusic) {
        specs.add("*:Music");
    } else {
        // No Music folder: use the top-level folder that contains your artist folders.
        // Your layout is orginized/Artist/Album/song.mp3, so the root is "orginized".
        String container = null;
        for (Raw r : raws) {
            String[] p = FolderRules.split(r.relPath);
            if (p.length >= 3) {
                if (container == null) container = p[0];
                else if (!container.equalsIgnoreCase(p[0])) { container = null; break; }
            }
        }
        specs.add(container != null ? "*:" + container : "*");
    }
}
        FolderRules rules = new FolderRules(specs);

        // ---- first pass: locate each file relative to its root
        final int n = raws.size();
        String[][] partsOf = new String[n][];
        int[] rootLen = new int[n];
        boolean[] inRoots = new boolean[n];
        HashMap<String, HashMap<String, Integer>> folderArtistCounts = new HashMap<String, HashMap<String, Integer>>();
        HashMap<String, String> artistDisplay = new HashMap<String, String>();
        HashMap<String, Integer> folderTotals = new HashMap<String, Integer>();
        for (int i = 0; i < n; i++) {
            Raw r = raws.get(i);
            String[] parts = FolderRules.split(r.relPath);
            int rl = rules.rootLength(r.volume, parts);
            inRoots[i] = rl >= 0;
            if (rl < 0) rl = FolderRules.fallbackRootLength(parts);
            partsOf[i] = parts;
            rootLen[i] = rl;
            if (FolderRules.depthBelowRoot(parts, rl) == 1) {
                String fk = folderKey(r);
                Integer tot = folderTotals.get(fk);
                folderTotals.put(fk, tot == null ? 1 : tot + 1);
                if (FolderRules.known(r.artist)) {
                    String a = r.artist.trim();
                    String ak = a.toLowerCase(Locale.ROOT);
                    if (!artistDisplay.containsKey(ak)) artistDisplay.put(ak, a);
                    HashMap<String, Integer> m = folderArtistCounts.get(fk);
                    if (m == null) {
                        m = new HashMap<String, Integer>();
                        folderArtistCounts.put(fk, m);
                    }
                    Integer cnt = m.get(ak);
                    m.put(ak, cnt == null ? 1 : cnt + 1);
                }
            }
        }
        HashMap<String, String> dominant = new HashMap<String, String>();
        for (Map.Entry<String, HashMap<String, Integer>> e : folderArtistCounts.entrySet()) {
            String best = null;
            int bestCount = 0;
            for (Map.Entry<String, Integer> a : e.getValue().entrySet()) {
                if (a.getValue() > bestCount) {
                    bestCount = a.getValue();
                    best = a.getKey();
                }
            }
            Integer total = folderTotals.get(e.getKey());
            if (best != null && total != null && bestCount * 2 >= total) {
                dominant.put(e.getKey(), artistDisplay.get(best));
            }
        }

        // ---- second pass: build tracks
        ArrayList<Track> tracks = new ArrayList<Track>(n);
        HashMap<Long, Track> byId = new HashMap<Long, Track>(Math.max(16, n * 2));
        for (int i = 0; i < n; i++) {
            Raw r = raws.get(i);
            FolderRules.Derived d = FolderRules.derive(r.volume, partsOf[i], rootLen[i], r.artist, r.album,
                    dominant.get(folderKey(r)));
            String title = r.title == null || r.title.trim().isEmpty() ? stripExtension(r.fileName) : r.title.trim();
            String key = r.volume + ":" + r.relPath + r.fileName;
            Track t = new Track(r.id, title, d.artist, d.album, d.albumKey, r.volume, r.relPath, r.fileName,
                    r.artist == null ? "" : r.artist, key, d.sub, r.duration, r.dateAdded, r.track, r.year,
                    inRoots[i]);
            tracks.add(t);
            byId.put(t.id, t);
        }
        Collections.sort(tracks, TRACK_ORDER);

        long sig = 1469598103934665603L;
        for (Track t : tracks) {
            sig = sig * 1099511628211L + t.id;
            sig = sig * 1099511628211L + t.key.hashCode();
            sig = sig * 1099511628211L + t.title.hashCode();
            sig = sig * 1099511628211L + t.tagArtist.hashCode();
            sig = sig * 1099511628211L + t.duration;
        }

        // ---- folder overview for the "Music folders" setting
        TreeMap<String, int[]> folderCounts = new TreeMap<String, int[]>(new Comparator<String>() {
            @Override
            public int compare(String a, String b) {
                return FolderRules.natural(a, b);
            }
        });
        for (int i = 0; i < n; i++) {
            Raw r = raws.get(i);
            String[] p = partsOf[i];
            if (p.length >= 1) bump(folderCounts, r.volume + ":" + p[0]);
            if (p.length >= 2) bump(folderCounts, r.volume + ":" + p[0] + "/" + p[1]);
        }

        String json = toJson(tracks, specs, auto, folderCounts, n);
        return new Library(permitted, Collections.unmodifiableList(tracks), byId, json, sig);
    }

    private static final Comparator<Track> TRACK_ORDER = new Comparator<Track>() {
        @Override
        public int compare(Track a, Track b) {
            int c = a.albumKey.compareTo(b.albumKey);
            if (c != 0) return c;
            c = FolderRules.natural(a.sub, b.sub);
            if (c != 0) return c;
            int da = a.track / 1000, db = b.track / 1000;
            if (da != db) return da - db;
            int ta = a.track % 1000, tb = b.track % 1000;
            if (ta <= 0) ta = 100000;
            if (tb <= 0) tb = 100000;
            if (ta != tb) return ta - tb;
            c = FolderRules.natural(a.fileName, b.fileName);
            if (c != 0) return c;
            return a.id < b.id ? -1 : (a.id == b.id ? 0 : 1);
        }
    };

    private static void bump(Map<String, int[]> m, String k) {
        int[] v = m.get(k);
        if (v == null) m.put(k, new int[]{1});
        else v[0]++;
    }

    private static String folderKey(Raw r) {
        return (r.volume + ":" + r.relPath).toLowerCase(Locale.ROOT);
    }

    private static int safeInt(Cursor c, int col) {
        try {
            return c.getInt(col);
        } catch (Exception e) {
            return 0;
        }
    }

    static String stripExtension(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }

    private static String toJson(List<Track> tracks, List<String> specs, boolean auto,
                                 Map<String, int[]> folderCounts, int total) {
        StringBuilder sb = new StringBuilder(tracks.size() * 200 + 1024);
        sb.append("{\"v\":1,\"total\":").append(total).append(",\"auto\":").append(auto).append(",\"roots\":[");
        for (int i = 0; i < specs.size(); i++) {
            if (i > 0) sb.append(',');
            Json.q(sb, specs.get(i));
        }
        sb.append("],\"folders\":[");
        boolean first = true;
        for (Map.Entry<String, int[]> e : folderCounts.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            String k = e.getKey();
            int c = k.indexOf(':');
            sb.append('[');
            Json.q(sb, k.substring(0, c)).append(',');
            Json.q(sb, k.substring(c + 1)).append(',').append(e.getValue()[0]).append(']');
        }
        sb.append("],\"tracks\":[");
        for (int i = 0; i < tracks.size(); i++) {
            Track t = tracks.get(i);
            if (i > 0) sb.append(',');
            sb.append('[').append(t.id).append(',');
            Json.q(sb, t.title).append(',');
            Json.q(sb, t.artist).append(',');
            Json.q(sb, t.album).append(',');
            Json.q(sb, t.albumKey).append(',');
            sb.append(t.duration).append(',').append(t.track).append(',').append(t.year).append(',')
                    .append(t.dateAdded).append(',');
            Json.q(sb, t.volume + ":" + t.relPath).append(',');
            Json.q(sb, t.fileName).append(',');
            Json.q(sb, t.key).append(',');
            Json.q(sb, t.sub).append(',');
            sb.append(t.inRoots ? 1 : 0).append(',');
            Json.q(sb, FolderRules.known(t.tagArtist) ? t.tagArtist.trim() : "");
            sb.append(']');
        }
        sb.append("]}");
        return sb.toString();
    }
}
