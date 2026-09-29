package app.crate.player;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Small persistent storage:
 * <ul>
 *   <li>a key/value store the UI uses for likes, playlists and settings (JSON strings)</li>
 *   <li>listening stats: play counts and a history of recently played songs</li>
 * </ul>
 * Songs are identified by a stable key ("volume:Music/Artist/Album/file.mp3") so likes and
 * playlists survive a media rescan.
 */
final class Store {
    private static final String KV = "crate_kv";
    private static final String STATS = "crate_stats";
    private static final int HISTORY_MAX = 300;

    private static JSONObject counts;
    private static JSONArray history;

    private Store() {}

    static SharedPreferences kv(Context c) {
        return c.getApplicationContext().getSharedPreferences(KV, Context.MODE_PRIVATE);
    }

    static String get(Context c, String key) {
        return kv(c).getString(key, null);
    }

    static void set(Context c, String key, String value) {
        SharedPreferences.Editor e = kv(c).edit();
        if (value == null) e.remove(key);
        else e.putString(key, value);
        e.apply();
    }

    // ------------------------------------------------------------------ stats

    private static void load(Context c) {
        if (counts != null) return;
        SharedPreferences p = c.getApplicationContext().getSharedPreferences(STATS, Context.MODE_PRIVATE);
        try {
            counts = new JSONObject(p.getString("counts", "{}"));
        } catch (JSONException e) {
            counts = new JSONObject();
        }
        try {
            history = new JSONArray(p.getString("history", "[]"));
        } catch (JSONException e) {
            history = new JSONArray();
        }
    }

    private static void save(Context c) {
        c.getApplicationContext().getSharedPreferences(STATS, Context.MODE_PRIVATE).edit()
                .putString("counts", counts.toString())
                .putString("history", history.toString())
                .apply();
    }

    static synchronized void addHistory(Context c, String key) {
        if (key == null) return;
        load(c);
        JSONArray h = new JSONArray();
        JSONArray item = new JSONArray();
        item.put(key);
        item.put(System.currentTimeMillis());
        h.put(item);
        for (int i = 0; i < history.length() && h.length() < HISTORY_MAX; i++) {
            h.put(history.opt(i));
        }
        history = h;
        save(c);
    }

    static synchronized void countPlay(Context c, String key) {
        if (key == null) return;
        load(c);
        try {
            counts.put(key, counts.optInt(key, 0) + 1);
        } catch (JSONException ignored) {
            return;
        }
        save(c);
    }

    static synchronized String statsJson(Context c) {
        load(c);
        return "{\"counts\":" + counts.toString() + ",\"history\":" + history.toString() + "}";
    }

    static synchronized void clearStats(Context c) {
        counts = new JSONObject();
        history = new JSONArray();
        save(c);
    }
}
