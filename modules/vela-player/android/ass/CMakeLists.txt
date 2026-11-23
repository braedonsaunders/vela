# libvela_ass.so: the JNI renderer statically linked with libass, HarfBuzz, FriBidi and FreeType (ass/build.sh).
set(VELA_ASS_PREFIX "${VELA_ASS_DIR}/${ANDROID_ABI}")
add_library(vela_ass SHARED "${CMAKE_CURRENT_LIST_DIR}/vela_ass.c")
target_include_directories(vela_ass PRIVATE "${VELA_ASS_PREFIX}/include")
target_link_libraries(vela_ass
  "${VELA_ASS_PREFIX}/lib/libass.a" "${VELA_ASS_PREFIX}/lib/libharfbuzz.a"
  "${VELA_ASS_PREFIX}/lib/libfribidi.a" "${VELA_ASS_PREFIX}/lib/libfreetype.a"
  jnigraphics log m)
# HarfBuzz is C++: link it against the module's shared libc++.
set_target_properties(vela_ass PROPERTIES LINKER_LANGUAGE CXX)
target_link_options(vela_ass PRIVATE "-Wl,--exclude-libs,ALL" "-Wl,--gc-sections")
