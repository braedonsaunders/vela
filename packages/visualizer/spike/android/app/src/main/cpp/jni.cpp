// JNI surface for app.vela.vizspike.Native.
#include <jni.h>

#include <string>

#include "dsp.h"
#include "engine.h"

extern "C" {

// ExoPlayer's playback thread: n mono samples starting at media frame `frame`.
JNIEXPORT void JNICALL Java_app_vela_vizspike_Native_tapWrite(JNIEnv* env, jclass, jfloatArray mono, jint n, jlong frame, jint rate) {
  auto* p = static_cast<float*>(env->GetPrimitiveArrayCritical(mono, nullptr));
  if (!p) return;
  tapRing().write(p, n, frame, rate);
  env->ReleasePrimitiveArrayCritical(mono, p, JNI_ABORT);
}

// Everything below runs on the GL thread.
JNIEXPORT jlong JNICALL Java_app_vela_vizspike_Native_create(JNIEnv* env, jclass, jbyteArray bundle, jint width, jint height, jstring scene, jboolean gpuFinish) {
  const jsize len = env->GetArrayLength(bundle);
  std::string src(size_t(len), '\0');
  env->GetByteArrayRegion(bundle, 0, len, reinterpret_cast<jbyte*>(src.data()));
  const char* s = env->GetStringUTFChars(scene, nullptr);
  std::string sceneId(s);
  env->ReleaseStringUTFChars(scene, s);
  auto* e = new Engine(std::move(src), width, height, sceneId, gpuFinish);
  return reinterpret_cast<jlong>(e);
}

JNIEXPORT void JNICALL Java_app_vela_vizspike_Native_resize(JNIEnv*, jclass, jlong h, jint width, jint height) {
  reinterpret_cast<Engine*>(h)->resize(width, height);
}

JNIEXPORT void JNICALL Java_app_vela_vizspike_Native_frame(JNIEnv*, jclass, jlong h, jlong heardUs, jint underruns) {
  reinterpret_cast<Engine*>(h)->frame(heardUs, underruns);
}

JNIEXPORT void JNICALL Java_app_vela_vizspike_Native_step(JNIEnv*, jclass, jlong h, jint delta) {
  reinterpret_cast<Engine*>(h)->step(delta);
}

JNIEXPORT void JNICALL Java_app_vela_vizspike_Native_destroy(JNIEnv*, jclass, jlong h, jboolean glValid) {
  auto* e = reinterpret_cast<Engine*>(h);
  if (!glValid) e->abandonGl();
  delete e;
}
}
