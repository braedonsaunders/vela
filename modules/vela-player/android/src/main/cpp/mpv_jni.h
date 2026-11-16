// Shared pieces of the libmpv JNI binding: the per-view player, cached Java classes, and conversions.
#pragma once

#include <jni.h>
#include <mpv/client.h>

#define VELA_JNI(type, name) extern "C" JNIEXPORT type JNICALL Java_app_ether_vela_player_MpvNative_##name

/// One mpv handle and the Surface it draws into (a global reference while attached).
struct Player {
    mpv_handle *mpv = nullptr;
    jobject surface = nullptr;
};

inline Player *player(jlong handle) {
    return reinterpret_cast<Player *>(handle);
}

/// Caches the Java classes and constructors the binding creates; called from JNI_OnLoad.
bool cacheClasses(JNIEnv *env);

/// A Java String from mpv's UTF-8 (which JNI's modified UTF-8 does not accept for every character).
jstring javaString(JNIEnv *env, const char *text);

/// A Java value for an mpv node: String, Boolean, Long, Double, ArrayList or HashMap (null otherwise).
jobject javaNode(JNIEnv *env, const mpv_node *node);

/// A Java value for an observed property's data in its format.
jobject javaProperty(JNIEnv *env, mpv_format format, void *data);

/// An app.ether.vela.player.MpvEvent for one mpv event, or null for MPV_EVENT_NONE.
jobject javaEvent(JNIEnv *env, const mpv_event *event);
