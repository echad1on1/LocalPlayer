package app.crate.player;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

final class Perms {
    private Perms() {}

    /** Android 13+ uses the "Music and audio" permission, older versions the storage permission. */
    static String audio() {
        return Build.VERSION.SDK_INT >= 33
                ? Manifest.permission.READ_MEDIA_AUDIO
                : Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    static boolean hasAudio(Context c) {
        return c.checkSelfPermission(audio()) == PackageManager.PERMISSION_GRANTED;
    }
}
