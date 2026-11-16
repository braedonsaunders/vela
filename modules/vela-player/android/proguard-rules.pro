# The JNI binding (src/main/cpp) finds these by name: keep them through R8 in the app's release build.
-keep class app.ether.vela.player.MpvEvent { <init>(int, java.lang.String, java.lang.Object, int, int); }
-keepclasseswithmembernames,includedescriptorclasses class app.ether.vela.player.MpvNative { native <methods>; }
