#include <node_api.h>
#include <cstdlib>
#include <string>
extern "C" void *vela_create(void *);
extern "C" char *vela_call(void *, const char *, const char *);
extern "C" void vela_destroy(void *);
extern "C" char *vela_capabilities();
struct Handle { void *session; };
static void finalize(napi_env, void *data, void *) {
  auto *handle = static_cast<Handle *>(data);
  if (handle->session) vela_destroy(handle->session);
  delete handle;
}
static std::string string(napi_env env, napi_value value) {
  size_t size = 0; napi_get_value_string_utf8(env, value, nullptr, 0, &size);
  std::string result(size + 1, '\0');
  napi_get_value_string_utf8(env, value, result.data(), result.size(), &size);
  result.resize(size); return result;
}
static napi_value create(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  void *bytes = nullptr; size_t size = 0; bool buffer = false;
  if (argc) napi_is_buffer(env, args[0], &buffer);
  if (!buffer || napi_get_buffer_info(env, args[0], &bytes, &size) != napi_ok || size != sizeof(void *)) {
    napi_throw_type_error(env, nullptr, "Expected native window handle"); return nullptr;
  }
  void *session = vela_create(*static_cast<void **>(bytes));
  if (!session) { napi_throw_error(env, nullptr, "Native surface unavailable"); return nullptr; }
  napi_value result; napi_create_external(env, new Handle{session}, finalize, nullptr, &result); return result;
}
static napi_value call(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value args[3]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Handle *handle = nullptr;
  if (argc != 3 || napi_get_value_external(env, args[0], reinterpret_cast<void **>(&handle)) != napi_ok || !handle || !handle->session) {
    napi_throw_error(env, nullptr, "Native host disposed"); return nullptr;
  }
  auto op = string(env, args[1]); auto json = string(env, args[2]);
  char *text = vela_call(handle->session, op.c_str(), json.c_str());
  napi_value result; napi_create_string_utf8(env, text ? text : "{}", NAPI_AUTO_LENGTH, &result); free(text); return result;
}
static napi_value destroy(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  Handle *handle = nullptr;
  if (argc && napi_get_value_external(env, args[0], reinterpret_cast<void **>(&handle)) == napi_ok && handle && handle->session) {
    vela_destroy(handle->session); handle->session = nullptr;
  }
  napi_value result; napi_get_undefined(env, &result); return result;
}
static napi_value capabilities(napi_env env, napi_callback_info) {
  char *text = vela_capabilities(); napi_value result;
  napi_create_string_utf8(env, text ? text : "{}", NAPI_AUTO_LENGTH, &result); free(text); return result;
}
static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptors[] = {
    {"create", nullptr, create, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"call", nullptr, call, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"destroy", nullptr, destroy, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"capabilities", nullptr, capabilities, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 4, descriptors); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
