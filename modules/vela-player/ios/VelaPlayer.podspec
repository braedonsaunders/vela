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
  s.source_files   = '*.swift'
  # libass for ASS/SSA as authored, from ass/build.sh (not committed). Without it ASS draws as plain text.
  ass = File.join(__dir__, 'ass', 'build')
  if File.exist?(File.join(ass, 'Libass.xcframework'))
    s.vendored_frameworks = ['ass/build/Libass.xcframework', 'ass/build/Fribidi.xcframework']
    s.resource_bundles = { 'VelaPlayerLicenses' => ['Licenses/*', 'ass/build/licenses/*'] }
  else
    s.resource_bundles = { 'VelaPlayerLicenses' => ['Licenses/*'] }
  end

  s.dependency 'ExpoModulesCore'
  spm_dependency(s, url: 'https://github.com/superuser404notfound/AetherEngine',
    requirement: {kind: 'exactVersion', version: '7.70.0'}, products: ['AetherEngine'])

  s.frameworks = 'AVKit', 'AVFoundation', 'CoreAudio', 'AudioToolbox', 'CoreVideo', 'CoreFoundation',
                 'CoreMedia', 'Metal', 'VideoToolbox', 'QuartzCore', 'Network'
end
