# libvela_dovi.so: the JNI bridge statically linked with the ABI's libdovi archive (dovi/build.sh).
add_library(vela_dovi SHARED "${CMAKE_CURRENT_LIST_DIR}/vela_dovi.c")
target_link_libraries(vela_dovi "${VELA_DOVI_DIR}/${ANDROID_ABI}/libdolby_vision.a" log dl m)
target_link_options(vela_dovi PRIVATE "-Wl,--exclude-libs,ALL" "-Wl,--gc-sections")
