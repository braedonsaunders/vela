# DefaultRenderersFactory discovers the optional audio renderer by name.
-keep class androidx.media3.decoder.ffmpeg.** { *; }

# libvela_dovi.so binds DoviNative.convert by name.
-keepclasseswithmembernames class app.ether.vela.player.DoviNative { native <methods>; }
# libvela_ass.so binds AssNative by name.
-keepclasseswithmembernames class app.ether.vela.player.AssNative { native <methods>; }
