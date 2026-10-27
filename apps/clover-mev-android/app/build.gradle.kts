plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ca.takatak.mev.clover"
    compileSdk = 34

    defaultConfig {
        applicationId = "ca.takatak.mev.clover"
        // Clover Station Duo 2, Mini 3, Flex 3/4 run Android 10 (API 29); 25 keeps older Clover devices installable.
        minSdk = 25
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
        // Food Hub's public address (the app's settings can change it on a device).
        buildConfigField("String", "FOODHUB_URL", "\"https://foodhub.on2go.ca\"")
    }

    buildFeatures { buildConfig = true }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
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
