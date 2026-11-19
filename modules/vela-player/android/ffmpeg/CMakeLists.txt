cmake_minimum_required(VERSION 3.21)
project(VelaMedia3Audio C CXX)
# Installed headers include the ABI's generated avconfig.h, removed by FFmpeg's distclean.
include_directories(BEFORE "${VELA_MEDIA3_DIR}/jni/ffmpeg/android-libs/${ANDROID_ABI}/include")
add_subdirectory("${VELA_MEDIA3_DIR}/jni" "${CMAKE_CURRENT_BINARY_DIR}/media3")
