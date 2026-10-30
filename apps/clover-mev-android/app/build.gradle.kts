plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing for the Clover App Market: the owner's keystore, never in git. Read from environment variables or
// ~/.gradle/gradle.properties: TAKATAK_MEV_KEYSTORE (path), TAKATAK_MEV_KEYSTORE_PASSWORD, TAKATAK_MEV_KEY_ALIAS,
// TAKATAK_MEV_KEY_PASSWORD. Without them a release build is left unsigned (it cannot be uploaded).
// Clover accepts the v1 (JAR) scheme only — signature file META-INF/CERT.RSA, no v2 / v3 / v4 — and the same key for
// every upload of the app: losing the keystore means a new listing.
fun signingValue(name: String): String? =
    (System.getenv(name) ?: project.findProperty(name) as String?)?.takeIf { it.isNotBlank() }
val releaseKeystore = signingValue("TAKATAK_MEV_KEYSTORE")

android {
    namespace = "ca.takatak.mev.clover"
    compileSdk = 34

    defaultConfig {
        applicationId = "ca.takatak.mev.clover"
        // Clover Station Duo 2, Mini 3, Flex 3/4 run Android 10 (API 29); 25 keeps older Clover devices installable.
        minSdk = 25
        // Clover App Market rule: 25 or lower (docs.clover.com « Set up Android SDK versions »). From 27, Android's
        // account access policy gets in the way of CloverAccount / CloverAuth, which this app needs for its token.
        // It is also what lets a v1-only signature (Clover's rule, below) install: Android wants v2 only from target 30.
        // Google Play's target-level rules do not apply to Clover devices.
        targetSdk = 25
        versionCode = 1
        versionName = "0.1.0"
        // Food Hub's public address (the app's settings can change it on a device).
        buildConfigField("String", "FOODHUB_URL", "\"https://foodhub.on2go.ca\"")
    }

    buildFeatures { buildConfig = true }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = signingValue("TAKATAK_MEV_KEYSTORE_PASSWORD")
                keyAlias = signingValue("TAKATAK_MEV_KEY_ALIAS")
                keyPassword = signingValue("TAKATAK_MEV_KEY_PASSWORD")
                // minSdk ≥ 24 turns v1 off by default: Clover needs it on, and only it.
                enableV1Signing = true
                enableV2Signing = false
                enableV3Signing = false
                enableV4Signing = false
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
    // Google Play's « target SDK too old » check: Clover devices are not Play devices (see targetSdk above).
    lint { disable += setOf("ExpiredTargetSdkVersion", "OldTargetApi") }
}

dependencies {
    // Clover Android SDK: CloverAuth (the merchant's token), the PAYMENT_PROCESSED broadcast, the printer jobs.
    implementation("com.clover.sdk:clover-android-sdk:341")
    // Fallback only: draws the QR code from its link when the image Food Hub sends is not a PNG.
    implementation("com.google.zxing:core:3.5.3")
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    testImplementation("junit:junit:4.13.2")
    // Real org.json in JVM unit tests (Android's is a stub there).
    testImplementation("org.json:json:20240303")
}
