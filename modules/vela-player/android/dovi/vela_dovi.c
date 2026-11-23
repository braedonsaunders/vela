// JNI bridge to libdovi (dovi_tool's dolby_vision crate, MIT): converts one Dolby Vision RPU NAL unit.
#include <jni.h>
#include <stddef.h>
#include <stdint.h>

// libdovi's C API (dolby_vision/src/capi.rs, libdovi 3.4.0).
typedef struct RpuOpaque RpuOpaque;
typedef struct { const uint8_t *data; size_t len; } DoviData;
RpuOpaque *dovi_parse_unspec62_nalu(const uint8_t *buf, size_t len);
const char *dovi_rpu_get_error(const RpuOpaque *ptr);
int32_t dovi_convert_rpu_with_mode(RpuOpaque *ptr, uint8_t mode);
const DoviData *dovi_write_unspec62_nalu(RpuOpaque *ptr);
void dovi_data_free(const DoviData *data);
void dovi_rpu_free(RpuOpaque *ptr);

// An UNSPEC62 NAL unit from its 0x7C01 header (escaped) in; the converted unit, escaped, or null out.
JNIEXPORT jbyteArray JNICALL
Java_app_ether_vela_player_DoviNative_convert(JNIEnv *env, jclass cls, jbyteArray nal, jint mode) {
  (void)cls;
  jsize length = (*env)->GetArrayLength(env, nal);
  jbyte *input = (*env)->GetByteArrayElements(env, nal, NULL);
  if (input == NULL) return NULL;
  RpuOpaque *rpu = dovi_parse_unspec62_nalu((const uint8_t *)input, (size_t)length);
  (*env)->ReleaseByteArrayElements(env, nal, input, JNI_ABORT);
  if (rpu == NULL) return NULL;
  jbyteArray result = NULL;
  if (dovi_rpu_get_error(rpu) == NULL && dovi_convert_rpu_with_mode(rpu, (uint8_t)mode) == 0) {
    const DoviData *out = dovi_write_unspec62_nalu(rpu);
    if (out != NULL) {
      result = (*env)->NewByteArray(env, (jsize)out->len);
      if (result != NULL) (*env)->SetByteArrayRegion(env, result, 0, (jsize)out->len, (const jbyte *)out->data);
      dovi_data_free(out);
    }
  }
  dovi_rpu_free(rpu);
  return result;
}
