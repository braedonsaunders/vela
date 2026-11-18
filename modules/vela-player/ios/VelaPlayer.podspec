# VelaPlayer: libmpv from MPVKit 1.0.0's LGPL product (never MPVKit-GPL). Its release
# xcframeworks are vendored (fetch-mpvkit.sh, pinned by SHA-256): linking the MPVKit Swift
# package through spm_dependency left FFmpeg, libass and the rest out of the app's link.
require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
frameworks = File.join(__dir__, 'Frameworks')
unless File.exist?(File.join(frameworks, 'Libmpv.xcframework'))
  system(File.join(__dir__, 'fetch-mpvkit.sh')) or raise 'VelaPlayer: fetch-mpvkit.sh failed'
end

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
  s.source_files   = '*.swift'
  s.resource_bundles = { 'VelaPlayerLicenses' => ['Licenses/*'] }

  s.dependency 'ExpoModulesCore'
  spm_dependency(s, url: 'https://github.com/superuser404notfound/AetherEngine',
    requirement: {kind: 'exactVersion', version: '7.70.0'}, products: ['AetherEngine'])

  s.vendored_frameworks = 'Frameworks/*.xcframework'
  # What MPVKit's Package.swift links for its LGPL product.
  # AVKit carries UIWindow.avDisplayManager (display matching); auto-linking does not reach it from this static pod.
  s.frameworks = 'AVKit', 'AVFoundation', 'CoreAudio', 'AudioToolbox', 'CoreVideo', 'CoreFoundation',
                 'CoreMedia', 'Metal', 'VideoToolbox', 'QuartzCore'
  s.libraries = 'bz2', 'iconv', 'expat', 'resolv', 'xml2', 'z', 'c++'
end
