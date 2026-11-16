# libvelampv: the JNI binding between MpvClient.kt and libmpv (one mpv handle per player view).
# libmpv and FFmpeg come prebuilt from libmpv/build.sh (LGPL); VELA_LIBMPV_DIR is passed by build.gradle.
cmake_minimum_required(VERSION 3.22.1)
project(velampv CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(velampv SHARED mpv_jni.cpp mpv_node.cpp mpv_events.cpp)

add_library(mpv SHARED IMPORTED)
set_target_properties(mpv PROPERTIES IMPORTED_LOCATION "${VELA_LIBMPV_DIR}/jniLibs/${ANDROID_ABI}/libmpv.so")

add_library(avcodec SHARED IMPORTED)
set_target_properties(avcodec PROPERTIES IMPORTED_LOCATION "${VELA_LIBMPV_DIR}/jniLibs/${ANDROID_ABI}/libavcodec.so")

target_include_directories(velampv PRIVATE "${VELA_LIBMPV_DIR}/include")
target_compile_options(velampv PRIVATE -Wall -Wextra -Werror)
target_link_libraries(velampv mpv avcodec log)
