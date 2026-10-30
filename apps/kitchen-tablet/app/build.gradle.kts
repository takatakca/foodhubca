plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Version and signing come from the environment (GitHub Actions, .github/workflows/android-tablet.yml):
//   FOODHUB_TABLET_VERSION       versionName, e.g. 1.0.0 (tag tablet-v1.0.0)
//   FOODHUB_TABLET_VERSION_CODE  versionCode, always rising (the workflow's run number)
//   ANDROID_KEYSTORE_FILE, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
//     the owner's release key (never in git). Without it the workflow builds the debug APK instead.
fun envOrProp(name: String): String? =
    (System.getenv(name) ?: project.findProperty(name) as String?)?.takeIf { it.isNotBlank() }
val releaseKeystore = envOrProp("ANDROID_KEYSTORE_FILE")

android {
    namespace = "ca.takatak.foodhub.tablet"
    compileSdk = 34

    defaultConfig {
        applicationId = "ca.takatak.foodhub.tablet"
        minSdk = 26
        // 34 on purpose: from 35, a "dataSync" foreground service is limited to 6 hours a day (OrderWatchService).
        targetSdk = 34
        versionCode = envOrProp("FOODHUB_TABLET_VERSION_CODE")?.toIntOrNull() ?: 1
        versionName = envOrProp("FOODHUB_TABLET_VERSION") ?: "1.0.0-dev"
        buildConfigField("String", "DEFAULT_KITCHEN_URL", "\"https://foodhub.on2go.ca/kitchen\"")
    }

    buildFeatures { buildConfig = true }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = envOrProp("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = envOrProp("ANDROID_KEY_ALIAS")
                keyPassword = envOrProp("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
    // Sideloaded app (no Play Store): Play's target-level checks do not apply; lint never blocks the APK build.
    lint {
        checkReleaseBuilds = false
        abortOnError = false
        disable += setOf("ExpiredTargetSdkVersion", "OldTargetApi")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")

    testImplementation("junit:junit:4.13.2")
    // Real org.json in JVM unit tests (Android's is a stub there).
    testImplementation("org.json:json:20240303")
}
