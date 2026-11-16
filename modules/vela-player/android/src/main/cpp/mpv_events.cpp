// Observed properties and the event queue for MpvNative.kt. Only MpvClient's event thread waits.
#include "mpv_jni.h"

namespace {

/// The libmpv formats MpvNative.kt names by number (MpvFormat in MpvNative.kt).
mpv_format format(jint value) {
    switch (value) {
    case 3: return MPV_FORMAT_FLAG;
    case 4: return MPV_FORMAT_INT64;
    case 5: return MPV_FORMAT_DOUBLE;
    case 6: return MPV_FORMAT_NODE;
    default: return MPV_FORMAT_STRING;
    }
}

}  // namespace

VELA_JNI(jint, observe)(JNIEnv *env, jclass, jlong handle, jstring name, jint kind) {
    const char *key = env->GetStringUTFChars(name, nullptr);
    int status = mpv_observe_property(player(handle)->mpv, 0, key, format(kind));
    env->ReleaseStringUTFChars(name, key);
    return status;
}

VELA_JNI(jint, requestLog)(JNIEnv *env, jclass, jlong handle, jstring level) {
    const char *text = env->GetStringUTFChars(level, nullptr);
    int status = mpv_request_log_messages(player(handle)->mpv, text);
    env->ReleaseStringUTFChars(level, text);
    return status;
}

/// The next event, waiting up to `timeout` seconds (negative: until one arrives or wakeup()).
VELA_JNI(jobject, waitEvent)(JNIEnv *env, jclass, jlong handle, jdouble timeout) {
    mpv_event *event = mpv_wait_event(player(handle)->mpv, timeout);
    return javaEvent(env, event);
}

VELA_JNI(void, wakeup)(JNIEnv *, jclass, jlong handle) {
    mpv_wakeup(player(handle)->mpv);
}
