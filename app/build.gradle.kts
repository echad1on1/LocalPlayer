plugins {
    id("com.android.application")
}

android {
    namespace = "app.crate.player"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.crate.player"
        minSdk = 30          // Android 11+
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    // The same key that signed the ready-made APK, so your own builds install as updates.
    signingConfigs {
        create("crate") {
            storeFile = rootProject.file("crate.jks")
            storePassword = "cratecrate"
            keyAlias = "crate"
            keyPassword = "cratecrate"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("crate")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("crate")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = false
    }
}
