package app.crate.player;

import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Random;
import java.util.Set;

/**
 * The play queue. Pure Java (no Android classes) so it can be unit tested on a normal JVM.
 *
 * <p>It keeps two lists:
 * <ul>
 *   <li>{@code order} – what actually plays, in play order (shuffled or not)</li>
 *   <li>{@code context} – the original order of the album / playlist / folder you started</li>
 * </ul>
 * Songs added with "Add to queue" / "Play next" are "user" entries: they play right after the
 * current song and survive shuffle being toggled on or off.
 */
final class PlayQueue {

    static final class Entry {
        final long uid;   // unique per queue entry (the same song can be queued twice)
        final long id;    // MediaStore audio id
        final boolean user;

        Entry(long uid, long id, boolean user) {
            this.uid = uid;
            this.id = id;
            this.user = user;
        }
    }

    static final int RESTORE_FAILED = -1;
    static final int RESTORE_CURRENT_LOST = 0;
    static final int RESTORE_OK = 1;

    private final ArrayList<Entry> order = new ArrayList<Entry>();
    private final ArrayList<Entry> context = new ArrayList<Entry>();
    private final Random rnd;
    private int index = -1;
    private boolean shuffle;
    private Entry anchor;           // last *context* entry that was current (for un-shuffling)
    private long nextUid = 1;
    private int version;            // bumps on every structural change

    PlayQueue(Random rnd) {
        this.rnd = rnd;
    }

    int version() { return version; }
    int size() { return order.size(); }
    int index() { return index; }
    boolean shuffle() { return shuffle; }
    List<Entry> order() { return Collections.unmodifiableList(order); }

    Entry current() {
        return index >= 0 && index < order.size() ? order.get(index) : null;
    }

    boolean isLast() {
        return index >= order.size() - 1;
    }

    /** Replace everything with a new context. {@code start < 0} with shuffle means "random first song". */
    void set(long[] ids, int start, boolean shuffleOn) {
        order.clear();
        context.clear();
        anchor = null;
        for (long id : ids) context.add(new Entry(nextUid++, id, false));
        shuffle = shuffleOn;
        if (context.isEmpty()) {
            index = -1;
            version++;
            return;
        }
        if (shuffleOn) {
            ArrayList<Entry> rest = new ArrayList<Entry>(context);
            Entry first = (start >= 0 && start < rest.size()) ? rest.remove(start) : null;
            Collections.shuffle(rest, rnd);
            if (first != null) order.add(first);
            order.addAll(rest);
            index = 0;
        } else {
            order.addAll(context);
            index = Math.max(0, Math.min(start, order.size() - 1));
        }
        touch();
        version++;
    }

    Entry moveNext(boolean wrap) {
        if (order.isEmpty()) return null;
        if (index + 1 < order.size()) index++;
        else if (wrap) index = 0;
        else return null;
        touch();
        return current();
    }

    Entry movePrev(boolean wrap) {
        if (order.isEmpty()) return null;
        if (index > 0) index--;
        else if (wrap) index = order.size() - 1;
        else return null;
        touch();
        return current();
    }

    void first() {
        if (!order.isEmpty()) {
            index = 0;
            touch();
        }
    }

    boolean jumpTo(long uid) {
        for (int i = 0; i < order.size(); i++) {
            if (order.get(i).uid == uid) {
                index = i;
                touch();
                return true;
            }
        }
        return false;
    }

    private void touch() {
        Entry e = current();
        if (e != null && !e.user) anchor = e;
    }

    void setShuffle(boolean on) {
        if (on == shuffle) return;
        shuffle = on;
        Entry cur = current();
        if (cur == null) {
            version++;
            return;
        }
        ArrayList<Entry> pending = new ArrayList<Entry>();
        for (int i = index + 1; i < order.size(); i++) {
            Entry e = order.get(i);
            if (e.user) pending.add(e);
        }
        ArrayList<Entry> neu = new ArrayList<Entry>(order.size());
        int newIndex;
        if (on) {
            ArrayList<Entry> rest = new ArrayList<Entry>(context);
            removeIdentity(rest, cur);
            Collections.shuffle(rest, rnd);
            neu.add(cur);
            neu.addAll(pending);
            neu.addAll(rest);
            newIndex = 0;
        } else {
            Entry a = cur.user ? anchor : cur;
            int ai = a == null ? -1 : indexOfIdentity(context, a);
            for (int i = 0; i <= ai; i++) neu.add(context.get(i));
            if (cur.user) {
                neu.add(cur);
                newIndex = neu.size() - 1;
            } else {
                newIndex = ai;
            }
            neu.addAll(pending);
            for (int i = ai + 1; i < context.size(); i++) neu.add(context.get(i));
            if (newIndex < 0) newIndex = 0;
        }
        order.clear();
        order.addAll(neu);
        index = newIndex;
        version++;
    }

    /** "Add to queue" (after other queued songs) or "Play next" (right after the current song). */
    void add(long[] ids, boolean playNext) {
        if (ids.length == 0) return;
        if (order.isEmpty()) {
            for (long id : ids) {
                Entry e = new Entry(nextUid++, id, false);
                context.add(e);
                order.add(e);
            }
            index = 0;
            touch();
            version++;
            return;
        }
        int p = index + 1;
        if (!playNext) {
            while (p < order.size() && order.get(p).user) p++;
        }
        ArrayList<Entry> es = new ArrayList<Entry>(ids.length);
        for (long id : ids) es.add(new Entry(nextUid++, id, true));
        order.addAll(p, es);
        version++;
    }

    /** Removes an upcoming or past entry. The current song can't be removed. */
    boolean remove(long uid) {
        for (int i = 0; i < order.size(); i++) {
            Entry e = order.get(i);
            if (e.uid != uid) continue;
            if (i == index) return false;
            order.remove(i);
            removeIdentity(context, e);
            if (anchor == e) anchor = null;
            if (i < index) index--;
            version++;
            return true;
        }
        return false;
    }

    /** Removes everything after the current song, or only the user-queued songs. */
    void clearUpcoming(boolean onlyUser) {
        if (index < 0) return;
        IdentityHashMap<Entry, Boolean> gone = new IdentityHashMap<Entry, Boolean>();
        ArrayList<Entry> keep = new ArrayList<Entry>(order.size());
        for (int i = 0; i < order.size(); i++) {
            Entry e = order.get(i);
            if (i > index && (!onlyUser || e.user)) gone.put(e, Boolean.TRUE);
            else keep.add(e);
        }
        if (gone.isEmpty()) return;
        order.clear();
        order.addAll(keep);
        ArrayList<Entry> ctx = new ArrayList<Entry>(context.size());
        for (Entry e : context) if (!gone.containsKey(e)) ctx.add(e);
        context.clear();
        context.addAll(ctx);
        if (anchor != null && gone.containsKey(anchor)) anchor = null;
        version++;
    }

    /** Only the uids after the current position that were added by the user. */
    int upcomingUserCount() {
        int n = 0;
        for (int i = index + 1; i < order.size(); i++) if (order.get(i).user) n++;
        return n;
    }

    // ---------------------------------------------------------------- persistence

    /** Format: v1;shuffle;anchorPos;id,id*,id...;ctxPos,ctxPos,... ("*" marks user entries). */
    String serialize() {
        IdentityHashMap<Entry, Integer> pos = new IdentityHashMap<Entry, Integer>();
        int anchorPos = -1;
        for (int i = 0; i < order.size(); i++) {
            Entry e = order.get(i);
            pos.put(e, i);
            if (e == anchor) anchorPos = i;
        }
        StringBuilder sb = new StringBuilder(order.size() * 8 + 32);
        sb.append("v1;").append(shuffle ? '1' : '0').append(';').append(anchorPos).append(';');
        for (int i = 0; i < order.size(); i++) {
            Entry e = order.get(i);
            if (i > 0) sb.append(',');
            sb.append(e.id);
            if (e.user) sb.append('*');
        }
        sb.append(';');
        boolean first = true;
        for (Entry e : context) {
            Integer p = pos.get(e);
            if (p == null) continue;
            if (!first) sb.append(',');
            sb.append(p.intValue());
            first = false;
        }
        return sb.toString();
    }

    /**
     * Replaces the contents with a serialized queue. Entries whose id isn't in {@code valid}
     * (deleted files) are dropped. Returns RESTORE_OK, RESTORE_CURRENT_LOST or RESTORE_FAILED.
     */
    int restoreFrom(String s, int savedIndex, Set<Long> valid) {
        if (s == null) return RESTORE_FAILED;
        String[] parts = s.split(";", -1);
        if (parts.length != 5 || !"v1".equals(parts[0])) return RESTORE_FAILED;
        String[] ord = parts[3].isEmpty() ? new String[0] : parts[3].split(",");
        Entry[] byPos = new Entry[ord.length];
        ArrayList<Entry> newOrder = new ArrayList<Entry>(ord.length);
        int curNew = -1, afterNew = -1;
        for (int i = 0; i < ord.length; i++) {
            String tok = ord[i].trim();
            boolean user = tok.endsWith("*");
            long id;
            try {
                id = Long.parseLong(user ? tok.substring(0, tok.length() - 1) : tok);
            } catch (NumberFormatException e) {
                continue;
            }
            if (valid != null && !valid.contains(id)) continue;
            Entry e = new Entry(nextUid++, id, user);
            byPos[i] = e;
            newOrder.add(e);
            if (i == savedIndex) curNew = newOrder.size() - 1;
            else if (i > savedIndex && afterNew < 0) afterNew = newOrder.size() - 1;
        }
        if (newOrder.isEmpty()) return RESTORE_FAILED;
        ArrayList<Entry> newContext = new ArrayList<Entry>();
        if (!parts[4].isEmpty()) {
            for (String p : parts[4].split(",")) {
                try {
                    int k = Integer.parseInt(p.trim());
                    if (k >= 0 && k < byPos.length && byPos[k] != null) newContext.add(byPos[k]);
                } catch (NumberFormatException ignored) {
                    // skip
                }
            }
        }
        int ap = -1;
        try {
            ap = Integer.parseInt(parts[2]);
        } catch (NumberFormatException ignored) {
            // no anchor
        }
        order.clear();
        order.addAll(newOrder);
        context.clear();
        context.addAll(newContext);
        shuffle = "1".equals(parts[1]);
        anchor = (ap >= 0 && ap < byPos.length) ? byPos[ap] : null;
        int result;
        if (curNew >= 0) {
            index = curNew;
            result = RESTORE_OK;
        } else {
            index = afterNew >= 0 ? afterNew : order.size() - 1;
            result = RESTORE_CURRENT_LOST;
        }
        touch();
        version++;
        return result;
    }

    /** {"qv":1,"idx":0,"items":[[uid,id,user],...]} */
    void appendJson(StringBuilder sb) {
        sb.append("{\"qv\":").append(version).append(",\"idx\":").append(index).append(",\"items\":[");
        for (int i = 0; i < order.size(); i++) {
            Entry e = order.get(i);
            if (i > 0) sb.append(',');
            sb.append('[').append(e.uid).append(',').append(e.id).append(',').append(e.user ? 1 : 0).append(']');
        }
        sb.append("]}");
    }

    private static int indexOfIdentity(List<Entry> list, Entry e) {
        for (int i = 0; i < list.size(); i++) if (list.get(i) == e) return i;
        return -1;
    }

    private static void removeIdentity(List<Entry> list, Entry e) {
        int i = indexOfIdentity(list, e);
        if (i >= 0) list.remove(i);
    }
}
