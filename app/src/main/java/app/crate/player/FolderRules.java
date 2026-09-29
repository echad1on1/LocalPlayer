package app.crate.player;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Turns folder paths into Artists and Albums. Pure Java so it can be unit tested.
 *
 * <p>Relative to a "music root" (by default the phone's Music folder):
 * <pre>
 *   Root/Artist/Album/song.mp3          -> artist "Artist", album "Album"
 *   Root/Artist/Album/CD1/song.mp3      -> same album, "CD1" is kept as a disc sub-folder
 *   Root/Artist - Album/song.mp3        -> artist "Artist", album "Album"
 *   Root/Album/song.mp3                 -> album "Album", artist from the song tags (if any)
 *   Root/song.mp3                       -> artist + album from the song tags
 * </pre>
 */
final class FolderRules {
    static final String UNKNOWN_ARTIST = "Unknown artist";
    static final String LOOSE_ALBUM = "Loose tracks";

    private static final class Root {
        final String volume;     // "*" = any volume
        final String[] parts;

        Root(String volume, String[] parts) {
            this.volume = volume;
            this.parts = parts;
        }
    }

    static final class Derived {
        String artist;
        String album;
        String albumKey;
        String sub;
    }

    private final ArrayList<Root> roots = new ArrayList<Root>();
    private final boolean all;

    /**
     * @param specs root folders like "*:Music" or "external_primary:Download/Tunes"; a single "*"
     *              (or an empty list) means "every top-level folder is a root".
     */
    FolderRules(List<String> specs) {
        boolean everything = specs == null || specs.isEmpty();
        if (specs != null) {
            for (String spec : specs) {
                if (spec == null) continue;
                String s = spec.trim();
                if (s.equals("*") || s.isEmpty()) {
                    everything = true;
                    continue;
                }
                int c = s.indexOf(':');
                String vol = c > 0 ? s.substring(0, c) : "*";
                String path = c >= 0 ? s.substring(c + 1) : s;
                String[] parts = split(path);
                if (parts.length == 0) {
                    everything = true;
                    continue;
                }
                roots.add(new Root(vol, parts));
            }
        }
        all = everything;
    }

    boolean isAll() {
        return all;
    }

    static String[] split(String relPath) {
        if (relPath == null) return new String[0];
        ArrayList<String> out = new ArrayList<String>();
        for (String p : relPath.split("/")) {
            if (!p.isEmpty()) out.add(p);
        }
        return out.toArray(new String[0]);
    }

    /** How many leading path segments form the root, or -1 if the folder isn't inside any root. */
    int rootLength(String volume, String[] parts) {
        int best = -1;
        for (Root r : roots) {
            if (!r.volume.equals("*") && !r.volume.equalsIgnoreCase(volume)) continue;
            if (r.parts.length > parts.length) continue;
            boolean ok = true;
            for (int i = 0; i < r.parts.length; i++) {
                if (!r.parts[i].equalsIgnoreCase(parts[i])) {
                    ok = false;
                    break;
                }
            }
            if (ok && r.parts.length > best) best = r.parts.length;
        }
        if (best < 0 && all) best = parts.length > 0 ? 1 : 0;
        return best;
    }

    /** Fallback root for files outside every root: treat the top-level folder as the root. */
    static int fallbackRootLength(String[] parts) {
        return parts.length > 0 ? 1 : 0;
    }

    static boolean known(String tag) {
        if (tag == null) return false;
        String t = tag.trim();
        return !t.isEmpty() && !t.equals("<unknown>");
    }

    /** Number of folder levels below the root. */
    static int depthBelowRoot(String[] parts, int rootLen) {
        return Math.max(0, parts.length - rootLen);
    }

    static Derived derive(String volume, String[] parts, int rootLen, String tagArtist, String tagAlbum,
                      String dominantFolderArtist) {
    Derived d = new Derived();
    int n = depthBelowRoot(parts, rootLen);
    String vol = volume == null ? "" : volume;

    // orginized/Artist/Album/song.mp3 -> root "orginized", artist, album
    if (n >= 3) {
        d.artist = parts[rootLen + 1].trim();
        d.album = parts[rootLen + 2].trim();
        d.sub = join(parts, rootLen + 3, parts.length);
        d.albumKey = lower(vol + ":" + join(parts, 0, rootLen + 3));
    } else if (n == 2) {
        // Root/Artist/Album directly
        d.artist = parts[rootLen].trim();
        d.album = parts[rootLen + 1].trim();
        d.sub = join(parts, rootLen + 2, parts.length);
        d.albumKey = lower(vol + ":" + join(parts, 0, rootLen + 2));
    } else if (n == 1) {
        String name = parts[rootLen].trim();
        int dash = name.indexOf(" - ");
        if (dash > 0 && dash + 3 < name.length()) {
            d.artist = name.substring(0, dash).trim();
            d.album = name.substring(dash + 3).trim();
        } else {
            d.album = name;
            d.artist = known(dominantFolderArtist) ? dominantFolderArtist.trim() : UNKNOWN_ARTIST;
        }
        d.sub = "";
        d.albumKey = lower(vol + ":" + join(parts, 0, rootLen + 1));
    } else {
        d.artist = known(tagArtist) ? tagArtist.trim() : UNKNOWN_ARTIST;
        String folderName = parts.length > 0 ? parts[parts.length - 1] : "";
        boolean useTag = known(tagAlbum) && !tagAlbum.trim().equalsIgnoreCase(folderName);
        d.album = useTag ? tagAlbum.trim() : LOOSE_ALBUM;
        d.sub = "";
        d.albumKey = lower(vol + ":" + join(parts, 0, rootLen) + "|" + d.artist + "|" + d.album);
    }
    if (d.artist.isEmpty()) d.artist = UNKNOWN_ARTIST;
    if (d.album.isEmpty()) d.album = "Untitled";
    return d;
}

    static String join(String[] parts, int from, int to) {
        StringBuilder sb = new StringBuilder();
        for (int i = Math.max(0, from); i < Math.min(to, parts.length); i++) {
            if (sb.length() > 0) sb.append('/');
            sb.append(parts[i]);
        }
        return sb.toString();
    }

    private static String lower(String s) {
        return s.toLowerCase(Locale.ROOT);
    }

    /** "Natural" order: "2 song" before "10 song", case-insensitive. */
    static int natural(String a, String b) {
        if (a == null) a = "";
        if (b == null) b = "";
        int i = 0, j = 0;
        final int na = a.length(), nb = b.length();
        while (i < na && j < nb) {
            char ca = a.charAt(i), cb = b.charAt(j);
            if (isDigit(ca) && isDigit(cb)) {
                int si = i, sj = j;
                while (si < na && a.charAt(si) == '0') si++;
                while (sj < nb && b.charAt(sj) == '0') sj++;
                int ei = si, ej = sj;
                while (ei < na && isDigit(a.charAt(ei))) ei++;
                while (ej < nb && isDigit(b.charAt(ej))) ej++;
                int la = ei - si, lb = ej - sj;
                if (la != lb) return la - lb;
                for (int k = 0; k < la; k++) {
                    int diff = a.charAt(si + k) - b.charAt(sj + k);
                    if (diff != 0) return diff;
                }
                i = ei;
                j = ej;
            } else {
                int diff = Character.toLowerCase(ca) - Character.toLowerCase(cb);
                if (diff != 0) return diff;
                i++;
                j++;
            }
        }
        return (na - i) - (nb - j);
    }

    private static boolean isDigit(char c) {
        return c >= '0' && c <= '9';
    }
}
