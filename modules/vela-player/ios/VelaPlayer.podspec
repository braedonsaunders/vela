# VelaPlayer: libmpv from MPVKit 1.0.0's LGPL product (never MPVKit-GPL), linked through
# Swift Package Manager by React Native's spm_dependency.
require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'VelaPlayer'
  s.version        = package['version']
  s.summary        = package['description']
  s.license        = 'LicenseRef-Vela'
  s.author         = 'Vela'
  s.homepage       = 'https://github.com/braedonsaunders/vela'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/braedonsaunders/vela.git' }
  s.static_framework = true
  s.source_files   = '**/*.swift'

  s.dependency 'ExpoModulesCore'

  spm_dependency(s,
    url: 'https://github.com/mpvkit/MPVKit.git',
    requirement: { kind: 'exactVersion', version: '1.0.0' },
    products: ['MPVKit']
  )
end
