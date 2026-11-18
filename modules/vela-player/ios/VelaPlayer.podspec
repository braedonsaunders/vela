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
  s.resource_bundles = { 'VelaPlayerLicenses' => ['Licenses/*'] }

  s.dependency 'ExpoModulesCore'
  spm_dependency(s, url: 'https://github.com/superuser404notfound/AetherEngine',
    requirement: {kind: 'exactVersion', version: '7.70.0'}, products: ['AetherEngine'])

  s.frameworks = 'AVKit', 'AVFoundation', 'CoreAudio', 'AudioToolbox', 'CoreVideo', 'CoreFoundation',
                 'CoreMedia', 'Metal', 'VideoToolbox', 'QuartzCore'
end
