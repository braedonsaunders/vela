Pod::Spec.new do |s|
  s.name = 'VelaInstallStorage'
  s.version = '1.0.0'
  s.summary = 'Installation-local state and migration of retained Vela credentials'
  s.license = 'LicenseRef-Vela'
  s.author = 'Vela'
  s.homepage = 'https://github.com/braedonsaunders/vela'
  s.source = { :git => 'https://github.com/braedonsaunders/vela.git' }
  s.platforms = { :ios => '18.0', :tvos => '18.0' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = '*.swift'
  s.dependency 'ExpoModulesCore'
end
