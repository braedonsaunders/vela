#include "engine.h"

#include <android/asset_manager.h>
#include <android/asset_manager_jni.h>
#include <android/log.h>
#include <jni.h>

#include <stdexcept>

namespace {
std::string utf8(JNIEnv* env, jstring id) {
  const char* data = env->GetStringUTFChars(id, nullptr);
  if (!data) throw std::runtime_error("Cannot read visualizer property");
  std::string result(data);
  env->ReleaseStringUTFChars(id, data);
  return result;
}

template<class F>
bool attempt(F&& fn) {
  try { fn(); return true; }
  catch (const std::exception& e) {
    __android_log_print(ANDROID_LOG_WARN, "VelaVisualizer", "%s", e.what());
    return false;
  }
}
}
extern "C" {
JNIEXPORT jint JNI_OnLoad(JavaVM*, void*) { return JNI_VERSION_1_6; }

JNIEXPORT jlong JNICALL Java_app_ether_vela_player_VisualizerNative_create(
    JNIEnv* env, jobject, jobject assets, jint width, jint height, jstring id, jstring artwork, jstring accent) {
  std::unique_ptr<Engine> engine;
  attempt([&] {
    std::unique_ptr<AAsset, decltype(&AAsset_close)> asset(
        AAssetManager_open(AAssetManager_fromJava(env, assets), "vela-visualizer/viz-native.js", AASSET_MODE_BUFFER), AAsset_close);
    if (!asset) throw std::runtime_error("Missing visualizer bundle");
    const auto* bytes = static_cast<const char*>(AAsset_getBuffer(asset.get()));
    if (!bytes) throw std::runtime_error("Could not read visualizer bundle");
    engine = std::make_unique<Engine>(std::string(bytes, AAsset_getLength(asset.get())), width, height, utf8(env, id), utf8(env, artwork), utf8(env, accent));
  });
  return reinterpret_cast<jlong>(engine.release());
}

JNIEXPORT jboolean JNICALL Java_app_ether_vela_player_VisualizerNative_tint(
    JNIEnv* env, jobject, jlong handle, jstring artwork, jstring accent) {
  return attempt([&] { reinterpret_cast<Engine*>(handle)->tint(utf8(env, artwork), utf8(env, accent)); });
}

JNIEXPORT jboolean JNICALL Java_app_ether_vela_player_VisualizerNative_resize(
    JNIEnv*, jobject, jlong handle, jint width, jint height) {
  return attempt([&] { reinterpret_cast<Engine*>(handle)->resize(width, height); });
}

JNIEXPORT jboolean JNICALL Java_app_ether_vela_player_VisualizerNative_frame(
    JNIEnv* env, jobject, jlong handle, jfloatArray pcm) {
  auto& engine = *reinterpret_cast<Engine*>(handle);
  env->GetFloatArrayRegion(pcm, 0, Analyser::N, engine.samples());
  return !env->ExceptionCheck() && attempt([&] { engine.frame(); });
}

JNIEXPORT void JNICALL Java_app_ether_vela_player_VisualizerNative_destroy(
    JNIEnv*, jobject, jlong handle, jboolean glValid) {
  std::unique_ptr<Engine> engine(reinterpret_cast<Engine*>(handle));
  if (engine && !glValid) engine->abandonGl();
}
}
