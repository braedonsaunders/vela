#!/bin/zsh
# Builds the tvOS (or iOS) simulator spike app without an Xcode project.
#   build.sh <dist dir with viz-native.js + apple-shaders.json> <track.mp3> <out dir> [tvos|ios]
set -e
dist=$1; track=$2; out=$3; plat=${4:-tvos}
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
here=${0:A:h}
if [[ $plat == tvos ]]; then sdk=appletvsimulator; target=arm64-apple-tvos17.0-simulator; family=3; else sdk=iphonesimulator; target=arm64-apple-ios17.0-simulator; family=1; fi
app=$out/VizSpike.app; rm -rf $app; mkdir -p $app
xcrun -sdk $sdk swiftc -O -target $target -sdk $(xcrun --sdk $sdk --show-sdk-path) -parse-as-library \
  -framework UIKit -framework Metal -framework QuartzCore -framework JavaScriptCore -framework AVFoundation -framework MediaToolbox -framework Accelerate \
  $here/*.swift $here/../../../../modules/vela-player/ios/Visualizer/{MetalExecutor,ShaderTable,VizDSP}.swift -o $app/VizSpike
cp $dist/viz-native.js $dist/apple-shaders.json $app/
cp $track $app/track.mp3
cat > $app/Info.plist <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.vela.vizspike</string>
<key>CFBundleExecutable</key><string>VizSpike</string>
<key>CFBundleName</key><string>VizSpike</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1</string>
<key>MinimumOSVersion</key><string>17.0</string>
<key>UIDeviceFamily</key><array><integer>$family</integer></array>
<key>UILaunchScreen</key><dict/>
<key>UIApplicationSceneManifest</key><dict><key>UIApplicationSupportsMultipleScenes</key><false/></dict>
</dict></plist>
PL
codesign -s - --force $app >/dev/null 2>&1
echo built $app
