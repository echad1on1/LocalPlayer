package app.crate.player;

import android.content.ContentUris;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.LruCache;
import android.util.Size;

import java.io.ByteArrayOutputStream;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Album art. Uses the art embedded in the file, or a cover.jpg / folder.jpg next to it
 * (Android's media index finds those for us). Results are cached as JPEG bytes.
 */
final class ArtLoader {
    private static final LruCache<String, byte[]> CACHE = new LruCache<String, byte[]>(20 * 1024 * 1024) {
        @Override
        protected int sizeOf(String key, byte[] value) {
            return value.length;
        }
    };
    private static final Set<String> MISSES = Collections.synchronizedSet(new HashSet<String>());

    private ArtLoader() {}

    static void clearMisses() {
        MISSES.clear();
    }

    /** JPEG bytes for the song's art at roughly {@code size} px, or null if it has none. */
    static byte[] jpeg(Context ctx, long id, int size) {
        String k = id + "@" + size;
        byte[] cached = CACHE.get(k);
        if (cached != null) return cached;
        if (MISSES.contains(k)) return null;
        Bitmap bm = bitmap(ctx, id, size);
        if (bm == null) {
            if (MISSES.size() > 20000) MISSES.clear();
            MISSES.add(k);
            return null;
        }
        ByteArrayOutputStream os = new ByteArrayOutputStream(64 * 1024);
        bm.compress(Bitmap.CompressFormat.JPEG, 90, os);
        bm.recycle();
        byte[] out = os.toByteArray();
        CACHE.put(k, out);
        return out;
    }

    /** A bitmap no larger than about 2x {@code size}. Blocking; call off the main thread. */
    static Bitmap bitmap(Context ctx, long id, int size) {
        Uri uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
        Bitmap b = null;
        if (size > 400) b = embedded(ctx, uri, size);   // full-quality art for the big player
        if (b == null) {
            try {
                b = ctx.getContentResolver().loadThumbnail(uri, new Size(size, size), null);
            } catch (Throwable ignored) {
                b = null;
            }
        }
        if (b == null) return null;
        int max = Math.max(b.getWidth(), b.getHeight());
        if (max > size * 2) {
            float scale = (size * 2f) / max;
            int w = Math.max(1, Math.round(b.getWidth() * scale));
            int h = Math.max(1, Math.round(b.getHeight() * scale));
            Bitmap scaled = Bitmap.createScaledBitmap(b, w, h, true);
            if (scaled != b) b.recycle();
            b = scaled;
        }
        return b;
    }

    private static Bitmap embedded(Context ctx, Uri uri, int size) {
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(ctx, uri);
            byte[] pic = r.getEmbeddedPicture();
            if (pic == null) return null;
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(pic, 0, pic.length, o);
            if (o.outWidth <= 0 || o.outHeight <= 0) return null;
            int sample = 1;
            while (o.outWidth / (sample * 2) >= size && o.outHeight / (sample * 2) >= size) sample *= 2;
            BitmapFactory.Options o2 = new BitmapFactory.Options();
            o2.inSampleSize = sample;
            return BitmapFactory.decodeByteArray(pic, 0, pic.length, o2);
        } catch (Throwable t) {
            return null;
        } finally {
            try {
                r.release();
            } catch (Throwable ignored) {
                // nothing
            }
        }
    }
}
