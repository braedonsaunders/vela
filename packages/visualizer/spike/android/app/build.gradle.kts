// The spike app. Native side: Hermes (com.facebook.hermes:hermes-android, the build React Native 0.88 /
// react-native-tvos 0.88.1-0 ships with) linked through its prefab package; libjsi.so and the JSI headers come
// out of the matching react-android AAR, which publishes them (the Hermes AAR's libhermesvm.so needs them).
plugins {
  id("com.android.application")
}

val hermesVersion = "260318099.0.5"          // node_modules/react-native/sdks/hermes-engine/version.properties
val reactAndroidVersion = "0.88.1-0"         // react-native-tvos

android {
  namespace = "app.vela.vizspike"
  compileSdk = 36
  ndkVersion = "27.1.12297006"

  defaultConfig {
    applicationId = "app.vela.vizspike"
    minSdk = 26
    targetSdk = 36
    versionCode = 1
    versionName = "0.1"
    ndk { abiFilters += (project.findProperty("vizAbis") as String? ?: "x86_64,arm64-v8a").split(",") }
    externalNativeBuild {
      cmake {
        arguments += listOf("-DANDROID_STL=c++_shared", "-DRN_NATIVE=" + layout.buildDirectory.dir("rn-native").get().asFile.path)
        project.findProperty("vizShared")?.let { arguments += "-DVELA_VISUALIZER_DIR=$it" }
        cppFlags += listOf("-std=c++20", "-fexceptions", "-frtti")
      }
    }
  }
  buildFeatures { prefab = true }
  externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }
  compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
  sourceSets["main"].jniLibs.directories.add(layout.buildDirectory.dir("rn-native/jni").get().asFile.path)
  lint { checkReleaseBuilds = false }
  buildTypes {
    // The measured build: optimised native code, still signed with the debug key so it installs anywhere.
    release { isMinifyEnabled = false; signingConfig = signingConfigs.getByName("debug") }
  }
}

val rnNative: Configuration by configurations.creating {
  isTransitive = false
  attributes { attribute(com.android.build.api.attributes.BuildTypeAttr.ATTRIBUTE, objects.named("release")) }
}

dependencies {
  implementation("androidx.media3:media3-exoplayer:1.11.1")
  implementation("com.facebook.hermes:hermes-android:$hermesVersion") { isTransitive = false }
  rnNative("io.github.react-native-tvos:react-android:$reactAndroidVersion")
}

// libjsi.so, libfbjni.so (both NEEDED by libhermesvm.so) and the JSI headers, from react-android.
val extractRnNative by tasks.registering(Copy::class) {
  val aar = rnNative
  from(provider { zipTree(aar.singleFile) }) {
    include("jni/*/libjsi.so", "jni/*/libfbjni.so", "prefab/modules/jsi/include/**")
  }
  into(layout.buildDirectory.dir("rn-native"))
}
tasks.named("preBuild") { dependsOn(extractRnNative) }
