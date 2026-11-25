cmake_minimum_required(VERSION 3.22.1)
project(vizspike CXX)

# Hermes: the prefab package inside com.facebook.hermes:hermes-android (libhermesvm.so + headers).
find_package(hermes-engine REQUIRED CONFIG)

# JSI: libjsi.so and its headers, extracted from react-android by the extractRnNative Gradle task.
add_library(rn_jsi SHARED IMPORTED)
set_target_properties(rn_jsi PROPERTIES
  IMPORTED_LOCATION ${RN_NATIVE}/jni/${ANDROID_ABI}/libjsi.so
  INTERFACE_INCLUDE_DIRECTORIES ${RN_NATIVE}/prefab/modules/jsi/include)

add_library(vizspike SHARED jni.cpp engine.cpp executor.cpp dsp.cpp)
target_compile_options(vizspike PRIVATE -O2 -Wall -Wno-unused-parameter -fexceptions -frtti)
target_link_libraries(vizspike hermes-engine::hermesvm rn_jsi GLESv3 EGL log android)
