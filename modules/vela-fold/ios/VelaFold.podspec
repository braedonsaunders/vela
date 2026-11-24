Pod::Spec.new do |s|
  s.name = 'VelaFold'
  s.version = '0.1.0'
  s.summary = "A foldable iPhone's posture and fold (UIHingeInteraction, reserved division regions)"
  s.license = 'LicenseRef-Vela'
  s.author = 'Vela'
  s.homepage = 'https://github.com/braedonsaunders/vela'
  s.source = { :git => 'https://github.com/braedonsaunders/vela.git' }
  # iPhone only: autolinking skips it for tvOS, where nothing folds (the module reads as flat there).
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = '*.swift'
  s.dependency 'ExpoModulesCore'
end
