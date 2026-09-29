package app.crate.player;

/** Minimal helpers for writing JSON by hand (fast enough for libraries with tens of thousands of songs). */
final class Json {
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private Json() {}

    static String q(String s) {
        StringBuilder sb = new StringBuilder(s == null ? 4 : s.length() + 8);
        q(sb, s);
        return sb.toString();
    }

    /** Appends {@code s} as a quoted JSON string literal that is also safe to evaluate as JavaScript. */
    static StringBuilder q(StringBuilder sb, String s) {
        if (s == null) return sb.append("null");
        sb.append('"');
        for (int i = 0, n = s.length(); i < n; i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (Character.isHighSurrogate(c) && i + 1 < n && Character.isLowSurrogate(s.charAt(i + 1))) {
                        sb.append(c).append(s.charAt(++i));
                    } else if (c < 0x20 || c == 0x2028 || c == 0x2029 || Character.isSurrogate(c)) {
                        sb.append("\\u").append(HEX[(c >> 12) & 15]).append(HEX[(c >> 8) & 15])
                                .append(HEX[(c >> 4) & 15]).append(HEX[c & 15]);
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.append('"');
    }

    /** Parses a JSON array of integers such as "[1,2,3]" into a long[] (tolerant of whitespace). */
    static long[] parseIds(String json) {
        if (json == null) return new long[0];
        String s = json.trim();
        if (s.startsWith("[")) s = s.substring(1);
        if (s.endsWith("]")) s = s.substring(0, s.length() - 1);
        s = s.trim();
        if (s.isEmpty()) return new long[0];
        String[] parts = s.split(",");
        long[] out = new long[parts.length];
        int n = 0;
        for (String p : parts) {
            String t = p.trim();
            if (t.isEmpty()) continue;
            try {
                out[n] = Long.parseLong(t);
                n++;
            } catch (NumberFormatException e) {
                try {
                    out[n] = (long) Double.parseDouble(t);
                    n++;
                } catch (NumberFormatException ignored) {
                    // skip garbage
                }
            }
        }
        if (n == out.length) return out;
        long[] trimmed = new long[n];
        System.arraycopy(out, 0, trimmed, 0, n);
        return trimmed;
    }
}
