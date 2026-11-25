require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
Pod::Spec.new do |s|
  s.name           = 'VelaPlayer'
  s.version        = package['version']
  s.summary        = package['description']
  s.license        = 'LicenseRef-Vela'
  s.author         = 'Vela'
  s.homepage       = 'https://github.com/braedonsaunders/vela'
  s.platforms      = { :ios => '18.0', :tvos => '18.0' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/braedonsaunders/vela.git' }
  s.static_framework = true
  s.source_files   = '*.swift', 'Visualizer/*.swift'
  # libass for ASS/SSA as authored, from ass/build.sh (not committed). Without it ASS draws as plain text.
  ass = File.join(__dir__, 'ass', 'build')
  if File.exist?(File.join(ass, 'Libass.xcframework'))
    s.vendored_frameworks = ['ass/build/Libass.xcframework', 'ass/build/Fribidi.xcframework']
  end
  licenses = ['Licenses/*']
  licenses << 'ass/build/licenses/*' if File.exist?(File.join(ass, 'Libass.xcframework'))
  s.resource_bundles = {
    'VelaPlayerLicenses' => licenses,
    'VelaVisualizerAssets' => ['VisualizerAssets/viz-native.js', 'VisualizerAssets/apple-shaders.json']
  }
  s.preserve_paths = 'VisualizerAssets/viz-shaders.metal'
  # The app copies this resource bundle after the pod builds. Compile for its
  # actual device or simulator SDK so no shader compiler runs on first open.
  viz_bundle = '${PODS_CONFIGURATION_BUILD_DIR}/VelaPlayer/VelaVisualizerAssets.bundle'
  s.script_phase = {
    :name => 'Compile music visualizer shaders',
    :execution_position => :before_compile,
    :input_files => ['${PODS_TARGET_SRCROOT}/VisualizerAssets/viz-shaders.metal', viz_bundle + '/apple-shaders.json'],
    :output_files => [viz_bundle + '/viz-shaders.metallib'],
    :script => <<~'SH'
      set -eu
      case "$PLATFORM_NAME" in
        iphoneos) target="ios${IPHONEOS_DEPLOYMENT_TARGET}" ;;
        iphonesimulator) target="ios${IPHONEOS_DEPLOYMENT_TARGET}-simulator" ;;
        appletvos) target="tvos${TVOS_DEPLOYMENT_TARGET}" ;;
        appletvsimulator) target="tvos${TVOS_DEPLOYMENT_TARGET}-simulator" ;;
        *) echo "Unsupported Metal platform $PLATFORM_NAME" >&2; exit 1 ;;
      esac
      mkdir -p "$DERIVED_FILE_DIR"
      air="$DERIVED_FILE_DIR/viz-shaders.air"
      xcrun --sdk "$PLATFORM_NAME" metal -target "air64-apple-$target" -std=metal3.0 -c "$SCRIPT_INPUT_FILE_0" -o "$air"
      xcrun --sdk "$PLATFORM_NAME" metallib "$air" -o "$SCRIPT_OUTPUT_FILE_0"
    SH
  }

  s.dependency 'ExpoModulesCore'
  spm_dependency(s, url: 'https://github.com/superuser404notfound/AetherEngine',
    requirement: {kind: 'exactVersion', version: '7.70.0'}, products: ['AetherEngine'])

  s.frameworks = 'AVKit', 'AVFoundation', 'CoreAudio', 'AudioToolbox', 'CoreVideo', 'CoreFoundation',
                 'CoreMedia', 'Metal', 'VideoToolbox', 'QuartzCore', 'Network', 'Accelerate', 'JavaScriptCore'
end
