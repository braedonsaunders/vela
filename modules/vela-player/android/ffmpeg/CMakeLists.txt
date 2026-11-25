cmake_minimum_required(VERSION 3.21)
project(VelaMedia3Audio C CXX)
# Media3's LGPL FFmpeg audio extension, and the libdovi bridge (../dovi).
# Installed headers include the ABI's generated avconfig.h, removed by FFmpeg's distclean.
include_directories(BEFORE "${VELA_MEDIA3_DIR}/jni/ffmpeg/android-libs/${ANDROID_ABI}/include")
add_subdirectory("${VELA_MEDIA3_DIR}/jni" "${CMAKE_CURRENT_BINARY_DIR}/media3")
add_subdirectory("${CMAKE_CURRENT_LIST_DIR}/../dovi" "${CMAKE_CURRENT_BINARY_DIR}/dovi")
add_subdirectory("${CMAKE_CURRENT_LIST_DIR}/../ass" "${CMAKE_CURRENT_BINARY_DIR}/ass")
add_subdirectory("${CMAKE_CURRENT_LIST_DIR}/../visualizer" "${CMAKE_CURRENT_BINARY_DIR}/visualizer")
