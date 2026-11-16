// The libmpv handle's lifecycle, options, commands and properties for MpvNative.kt.
// Every call takes the handle create() returned; MpvClient.kt never uses one after destroy().
#include <clocale>
#include <string>
#include <vector>

#include "mpv_jni.h"

// FFmpeg's MediaCodec decoders need the Java VM (libavcodec/jni.h).
extern "C" int av_jni_set_java_vm(void *vm, void *log_ctx);

namespace {

/// A Java string's UTF-8 for the duration of one call.
class Utf8 {
public:
    Utf8(JNIEnv *env, jstring text) : env_(env), text_(text), chars_(env->GetStringUTFChars(text, nullptr)) {}
    ~Utf8() { env_->ReleaseStringUTFChars(text_, chars_); }
    Utf8(const Utf8 &) = delete;
    Utf8 &operator=(const Utf8 &) = delete;
    const char *get() const { return chars_; }

private:
    JNIEnv *env_;
    jstring text_;
    const char *chars_;
};

/// A Java String[] as the strings and the null-terminated pointer array mpv takes.
class Utf8Array {
public:
    Utf8Array(JNIEnv *env, jobjectArray values) {
        jsize length = env->GetArrayLength(values);
        strings_.reserve(length);
        for (jsize index = 0; index < length; index++) {
            auto value = static_cast<jstring>(env->GetObjectArrayElement(values, index));
            Utf8 text(env, value);
            strings_.emplace_back(text.get());
            env->DeleteLocalRef(value);
        }
        for (auto &text : strings_) {
            pointers_.push_back(text.c_str());
        }
        pointers_.push_back(nullptr);
    }
    const char **pointers() { return pointers_.data(); }
    size_t size() const { return strings_.size(); }
    const std::string &operator[](size_t index) const { return strings_[index]; }

private:
    std::vector<std::string> strings_;
    std::vector<const char *> pointers_;
};

}  // namespace

extern "C" JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void *) {
    JNIEnv *env = nullptr;
    if (vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) != JNI_OK || !cacheClasses(env)) {
        return JNI_ERR;
    }
    av_jni_set_java_vm(vm, nullptr);
    return JNI_VERSION_1_6;
}

VELA_JNI(jlong, create)(JNIEnv *, jclass) {
    // mpv parses numbers with the C locale.
    setlocale(LC_NUMERIC, "C");
    mpv_handle *mpv = mpv_create();
    if (mpv == nullptr) {
        return 0;
    }
    auto result = new Player();
    result->mpv = mpv;
    return reinterpret_cast<jlong>(result);
}

VELA_JNI(jint, initialize)(JNIEnv *, jclass, jlong handle) {
    return mpv_initialize(player(handle)->mpv);
}

VELA_JNI(void, destroy)(JNIEnv *env, jclass, jlong handle) {
    Player *target = player(handle);
    mpv_terminate_destroy(target->mpv);
    if (target->surface != nullptr) {
        env->DeleteGlobalRef(target->surface);
    }
    delete target;
}

VELA_JNI(jint, setOption)(JNIEnv *env, jclass, jlong handle, jstring name, jstring value) {
    Utf8 key(env, name);
    Utf8 text(env, value);
    return mpv_set_option_string(player(handle)->mpv, key.get(), text.get());
}

/// Draws into `surface` (mpv's Android video output takes a global reference as `wid`), or stops
/// drawing when it is null. The previous Surface's reference is released after mpv lets go of it.
VELA_JNI(jint, setSurface)(JNIEnv *env, jclass, jlong handle, jobject surface) {
    Player *target = player(handle);
    jobject previous = target->surface;
    target->surface = surface != nullptr ? env->NewGlobalRef(surface) : nullptr;
    int64_t wid = reinterpret_cast<intptr_t>(target->surface);
    int status = mpv_set_option(target->mpv, "wid", MPV_FORMAT_INT64, &wid);
    if (previous != nullptr) {
        env->DeleteGlobalRef(previous);
    }
    return status;
}

VELA_JNI(jint, command)(JNIEnv *env, jclass, jlong handle, jobjectArray arguments) {
    Utf8Array values(env, arguments);
    return mpv_command(player(handle)->mpv, values.pointers());
}

VELA_JNI(jint, setPropertyString)(JNIEnv *env, jclass, jlong handle, jstring name, jstring value) {
    Utf8 key(env, name);
    Utf8 text(env, value);
    return mpv_set_property_string(player(handle)->mpv, key.get(), text.get());
}

VELA_JNI(jint, setPropertyFlag)(JNIEnv *env, jclass, jlong handle, jstring name, jboolean value) {
    Utf8 key(env, name);
    int flag = value ? 1 : 0;
    return mpv_set_property(player(handle)->mpv, key.get(), MPV_FORMAT_FLAG, &flag);
}

VELA_JNI(jint, setPropertyDouble)(JNIEnv *env, jclass, jlong handle, jstring name, jdouble value) {
    Utf8 key(env, name);
    double number = value;
    return mpv_set_property(player(handle)->mpv, key.get(), MPV_FORMAT_DOUBLE, &number);
}

/// A string-list property (http-header-fields) set as a node, so values may hold commas.
VELA_JNI(jint, setPropertyStringList)(JNIEnv *env, jclass, jlong handle, jstring name, jobjectArray values) {
    Utf8 key(env, name);
    Utf8Array strings(env, values);
    std::vector<mpv_node> items(strings.size());
    for (size_t index = 0; index < strings.size(); index++) {
        items[index].format = MPV_FORMAT_STRING;
        items[index].u.string = const_cast<char *>(strings[index].c_str());
    }
    mpv_node_list list{static_cast<int>(items.size()), items.data(), nullptr};
    mpv_node node{};
    node.format = MPV_FORMAT_NODE_ARRAY;
    node.u.list = &list;
    return mpv_set_property(player(handle)->mpv, key.get(), MPV_FORMAT_NODE, &node);
}

VELA_JNI(jstring, errorString)(JNIEnv *env, jclass, jint status) {
    return javaString(env, mpv_error_string(status));
}
