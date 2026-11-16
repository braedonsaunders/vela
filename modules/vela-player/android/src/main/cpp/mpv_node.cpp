// mpv values as Java objects. Classes are cached once (JNI_OnLoad), so any thread can convert.
#include <cstring>

#include "mpv_jni.h"

namespace {

struct Classes {
    jclass string;
    jmethodID stringFromBytes;
    jstring utf8;
    jclass boolean;
    jmethodID booleanOf;
    jclass longClass;
    jmethodID longOf;
    jclass doubleClass;
    jmethodID doubleOf;
    jclass list;
    jmethodID listNew;
    jmethodID listAdd;
    jclass map;
    jmethodID mapNew;
    jmethodID mapPut;
    jclass event;
    jmethodID eventNew;
};

Classes classes;

jclass global(JNIEnv *env, const char *name) {
    jclass local = env->FindClass(name);
    if (local == nullptr) {
        return nullptr;
    }
    auto result = static_cast<jclass>(env->NewGlobalRef(local));
    env->DeleteLocalRef(local);
    return result;
}

}  // namespace

bool cacheClasses(JNIEnv *env) {
    classes.string = global(env, "java/lang/String");
    classes.boolean = global(env, "java/lang/Boolean");
    classes.longClass = global(env, "java/lang/Long");
    classes.doubleClass = global(env, "java/lang/Double");
    classes.list = global(env, "java/util/ArrayList");
    classes.map = global(env, "java/util/HashMap");
    classes.event = global(env, "app/ether/vela/player/MpvEvent");
    if (!classes.string || !classes.boolean || !classes.longClass || !classes.doubleClass || !classes.list
        || !classes.map || !classes.event) {
        return false;
    }
    classes.stringFromBytes = env->GetMethodID(classes.string, "<init>", "([BLjava/lang/String;)V");
    classes.utf8 = static_cast<jstring>(env->NewGlobalRef(env->NewStringUTF("UTF-8")));
    classes.booleanOf = env->GetStaticMethodID(classes.boolean, "valueOf", "(Z)Ljava/lang/Boolean;");
    classes.longOf = env->GetStaticMethodID(classes.longClass, "valueOf", "(J)Ljava/lang/Long;");
    classes.doubleOf = env->GetStaticMethodID(classes.doubleClass, "valueOf", "(D)Ljava/lang/Double;");
    classes.listNew = env->GetMethodID(classes.list, "<init>", "(I)V");
    classes.listAdd = env->GetMethodID(classes.list, "add", "(Ljava/lang/Object;)Z");
    classes.mapNew = env->GetMethodID(classes.map, "<init>", "()V");
    classes.mapPut = env->GetMethodID(classes.map, "put", "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");
    classes.eventNew = env->GetMethodID(classes.event, "<init>", "(ILjava/lang/String;Ljava/lang/Object;II)V");
    return classes.stringFromBytes && classes.booleanOf && classes.longOf && classes.doubleOf && classes.listNew
        && classes.listAdd && classes.mapNew && classes.mapPut && classes.eventNew;
}

jstring javaString(JNIEnv *env, const char *text) {
    if (text == nullptr) {
        return nullptr;
    }
    auto length = static_cast<jsize>(strlen(text));
    jbyteArray bytes = env->NewByteArray(length);
    env->SetByteArrayRegion(bytes, 0, length, reinterpret_cast<const jbyte *>(text));
    auto result = static_cast<jstring>(env->NewObject(classes.string, classes.stringFromBytes, bytes, classes.utf8));
    env->DeleteLocalRef(bytes);
    return result;
}

jobject javaNode(JNIEnv *env, const mpv_node *node) {
    switch (node->format) {
    case MPV_FORMAT_STRING:
        return javaString(env, node->u.string);
    case MPV_FORMAT_FLAG:
        return env->CallStaticObjectMethod(classes.boolean, classes.booleanOf, node->u.flag != 0);
    case MPV_FORMAT_INT64:
        return env->CallStaticObjectMethod(classes.longClass, classes.longOf, static_cast<jlong>(node->u.int64));
    case MPV_FORMAT_DOUBLE:
        return env->CallStaticObjectMethod(classes.doubleClass, classes.doubleOf, node->u.double_);
    case MPV_FORMAT_NODE_ARRAY: {
        const mpv_node_list *items = node->u.list;
        jobject list = env->NewObject(classes.list, classes.listNew, items->num);
        for (int index = 0; index < items->num; index++) {
            jobject value = javaNode(env, &items->values[index]);
            env->CallBooleanMethod(list, classes.listAdd, value);
            env->DeleteLocalRef(value);
        }
        return list;
    }
    case MPV_FORMAT_NODE_MAP: {
        const mpv_node_list *items = node->u.list;
        jobject map = env->NewObject(classes.map, classes.mapNew);
        for (int index = 0; index < items->num; index++) {
            jstring key = javaString(env, items->keys[index]);
            jobject value = javaNode(env, &items->values[index]);
            jobject previous = env->CallObjectMethod(map, classes.mapPut, key, value);
            env->DeleteLocalRef(previous);
            env->DeleteLocalRef(value);
            env->DeleteLocalRef(key);
        }
        return map;
    }
    default:
        return nullptr;
    }
}

jobject javaProperty(JNIEnv *env, mpv_format format, void *data) {
    if (data == nullptr) {
        return nullptr;
    }
    switch (format) {
    case MPV_FORMAT_FLAG:
        return env->CallStaticObjectMethod(classes.boolean, classes.booleanOf, *static_cast<int *>(data) != 0);
    case MPV_FORMAT_INT64:
        return env->CallStaticObjectMethod(classes.longClass, classes.longOf, *static_cast<int64_t *>(data));
    case MPV_FORMAT_DOUBLE:
        return env->CallStaticObjectMethod(classes.doubleClass, classes.doubleOf, *static_cast<double *>(data));
    case MPV_FORMAT_STRING:
        return javaString(env, *static_cast<char **>(data));
    case MPV_FORMAT_NODE:
        return javaNode(env, static_cast<mpv_node *>(data));
    default:
        return nullptr;
    }
}

jobject javaEvent(JNIEnv *env, const mpv_event *event) {
    jstring name = nullptr;
    jobject value = nullptr;
    jint reason = 0;
    jint error = event->error;
    switch (event->event_id) {
    case MPV_EVENT_NONE:
        return nullptr;
    case MPV_EVENT_PROPERTY_CHANGE: {
        auto property = static_cast<mpv_event_property *>(event->data);
        name = javaString(env, property->name);
        value = javaProperty(env, property->format, property->data);
        break;
    }
    case MPV_EVENT_END_FILE: {
        auto end = static_cast<mpv_event_end_file *>(event->data);
        reason = end->reason;
        error = end->error;
        break;
    }
    case MPV_EVENT_LOG_MESSAGE: {
        auto message = static_cast<mpv_event_log_message *>(event->data);
        name = javaString(env, message->prefix);
        value = javaString(env, message->text);
        reason = message->log_level;
        break;
    }
    default:
        break;
    }
    jobject result = env->NewObject(classes.event, classes.eventNew, event->event_id, name, value, reason, error);
    env->DeleteLocalRef(name);
    env->DeleteLocalRef(value);
    return result;
}
