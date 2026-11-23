// JNI bridge to libass (ISC): ASS/SSA tracks rendered into an Android ARGB_8888 (premultiplied) bitmap.
#include <android/bitmap.h>
#include <ass/ass.h>
#include <jni.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  ASS_Library *library;
  ASS_Renderer *renderer;
  int width, height;
  char *fontPath, *family;
} Context;

JNIEXPORT jlong JNICALL
Java_app_ether_vela_player_AssNative_create(JNIEnv *env, jclass cls, jstring fontPath, jstring family) {
  (void)cls;
  Context *context = calloc(1, sizeof(Context));
  if (context == NULL) return 0;
  context->library = ass_library_init();
  context->renderer = context->library ? ass_renderer_init(context->library) : NULL;
  if (context->renderer == NULL) {
    if (context->library) ass_library_done(context->library);
    free(context);
    return 0;
  }
  ass_set_extract_fonts(context->library, 1);
  const char *path = (*env)->GetStringUTFChars(env, fontPath, NULL);
  const char *name = (*env)->GetStringUTFChars(env, family, NULL);
  context->fontPath = strdup(path);
  context->family = strdup(name);
  (*env)->ReleaseStringUTFChars(env, fontPath, path);
  (*env)->ReleaseStringUTFChars(env, family, name);
  // No system font provider on Android: every family resolves to added fonts or this default file.
  ass_set_fonts(context->renderer, context->fontPath, context->family, ASS_FONTPROVIDER_NONE, NULL, 0);
  return (jlong)(intptr_t)context;
}

JNIEXPORT void JNICALL
Java_app_ether_vela_player_AssNative_addFont(JNIEnv *env, jclass cls, jlong handle, jstring name, jbyteArray data) {
  (void)cls;
  Context *context = (Context *)(intptr_t)handle;
  const char *font = (*env)->GetStringUTFChars(env, name, NULL);
  jsize length = (*env)->GetArrayLength(env, data);
  jbyte *bytes = (*env)->GetByteArrayElements(env, data, NULL);
  if (bytes != NULL) {
    ass_add_font(context->library, font, (const char *)bytes, (int)length);
    (*env)->ReleaseByteArrayElements(env, data, bytes, JNI_ABORT);
  }
  (*env)->ReleaseStringUTFChars(env, name, font);
}

// Fonts added with addFont take effect when the font selection is rebuilt.
JNIEXPORT void JNICALL
Java_app_ether_vela_player_AssNative_reloadFonts(JNIEnv *env, jclass cls, jlong handle) {
  (void)env; (void)cls;
  Context *context = (Context *)(intptr_t)handle;
  ass_set_fonts(context->renderer, context->fontPath, context->family, ASS_FONTPROVIDER_NONE, NULL, 0);
}

JNIEXPORT jlong JNICALL
Java_app_ether_vela_player_AssNative_newTrack(JNIEnv *env, jclass cls, jlong handle, jbyteArray header) {
  (void)cls;
  Context *context = (Context *)(intptr_t)handle;
  ASS_Track *track = ass_new_track(context->library);
  if (track == NULL) return 0;
  jsize length = (*env)->GetArrayLength(env, header);
  jbyte *bytes = (*env)->GetByteArrayElements(env, header, NULL);
  if (bytes != NULL) {
    ass_process_codec_private(track, (char *)bytes, (int)length);
    (*env)->ReleaseByteArrayElements(env, header, bytes, JNI_ABORT);
  }
  return (jlong)(intptr_t)track;
}

JNIEXPORT void JNICALL
Java_app_ether_vela_player_AssNative_addEvent(JNIEnv *env, jclass cls, jlong trackHandle, jbyteArray chunk,
                                             jlong startMs, jlong durationMs) {
  (void)cls;
  jsize length = (*env)->GetArrayLength(env, chunk);
  jbyte *bytes = (*env)->GetByteArrayElements(env, chunk, NULL);
  if (bytes == NULL) return;
  ass_process_chunk((ASS_Track *)(intptr_t)trackHandle, (char *)bytes, (int)length, (long long)startMs, (long long)durationMs);
  (*env)->ReleaseByteArrayElements(env, chunk, bytes, JNI_ABORT);
}

JNIEXPORT void JNICALL
Java_app_ether_vela_player_AssNative_freeTrack(JNIEnv *env, jclass cls, jlong trackHandle) {
  (void)env; (void)cls;
  ass_free_track((ASS_Track *)(intptr_t)trackHandle);
}

// Renders the track at timeMs into the bitmap. 0: nothing changed since the last frame; 1: drawn; 2: blank.
// storageWidth/Height is the video's size, so scripts without PlayRes scale as the video does.
JNIEXPORT jint JNICALL
Java_app_ether_vela_player_AssNative_render(JNIEnv *env, jclass cls, jlong handle, jlong trackHandle, jlong timeMs,
                                           jobject bitmap, jint storageWidth, jint storageHeight, jboolean force) {
  (void)cls;
  Context *context = (Context *)(intptr_t)handle;
  AndroidBitmapInfo info;
  if (AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS ||
      info.format != ANDROID_BITMAP_FORMAT_RGBA_8888) return 0;
  if ((int)info.width != context->width || (int)info.height != context->height) {
    context->width = (int)info.width;
    context->height = (int)info.height;
    ass_set_frame_size(context->renderer, context->width, context->height);
    force = JNI_TRUE;
  }
  if (storageWidth > 0 && storageHeight > 0) ass_set_storage_size(context->renderer, storageWidth, storageHeight);
  int changed = 0;
  ASS_Image *image = ass_render_frame(context->renderer, (ASS_Track *)(intptr_t)trackHandle, (long long)timeMs, &changed);
  if (!changed && !force) return 0;
  void *pixels;
  if (AndroidBitmap_lockPixels(env, bitmap, &pixels) != ANDROID_BITMAP_RESULT_SUCCESS) return 0;
  for (uint32_t y = 0; y < info.height; y++) memset((uint8_t *)pixels + (size_t)y * info.stride, 0, (size_t)info.width * 4);
  int drawn = 0;
  for (; image != NULL; image = image->next) {
    if (image->w <= 0 || image->h <= 0) continue;
    uint32_t color = image->color;
    unsigned r = color >> 24, g = (color >> 16) & 0xff, b = (color >> 8) & 0xff, opacity = 255 - (color & 0xff);
    for (int y = 0; y < image->h; y++) {
      int dy = image->dst_y + y;
      if (dy < 0 || dy >= (int)info.height) continue;
      const uint8_t *mask = image->bitmap + (size_t)y * image->stride;
      uint8_t *row = (uint8_t *)pixels + (size_t)dy * info.stride;
      for (int x = 0; x < image->w; x++) {
        int dx = image->dst_x + x;
        if (dx < 0 || dx >= (int)info.width) continue;
        unsigned k = mask[x] * opacity / 255;
        if (k == 0) continue;
        uint8_t *d = row + (size_t)dx * 4; // R, G, B, A, premultiplied
        d[0] = (uint8_t)((r * k + d[0] * (255 - k)) / 255);
        d[1] = (uint8_t)((g * k + d[1] * (255 - k)) / 255);
        d[2] = (uint8_t)((b * k + d[2] * (255 - k)) / 255);
        d[3] = (uint8_t)(k + d[3] * (255 - k) / 255);
        drawn = 1;
      }
    }
  }
  AndroidBitmap_unlockPixels(env, bitmap);
  return drawn ? 1 : 2;
}

JNIEXPORT void JNICALL
Java_app_ether_vela_player_AssNative_destroy(JNIEnv *env, jclass cls, jlong handle) {
  (void)env; (void)cls;
  Context *context = (Context *)(intptr_t)handle;
  ass_renderer_done(context->renderer);
  ass_library_done(context->library);
  free(context->fontPath);
  free(context->family);
  free(context);
}
