Pod::Spec.new do |s|
  s.name = 'VelaTopShelf'
  s.version = '0.1.0'
  s.summary = 'Apple TV Top Shelf: Continue Watching written to the App Group the TV Services extension reads'
  s.license = 'LicenseRef-Vela'
  s.author = 'Vela'
  s.homepage = 'https://github.com/braedonsaunders/vela'
  s.source = { :git => 'https://github.com/braedonsaunders/vela.git' }
  # Apple TV only: autolinking skips it for iPhone and iPad, which have no Top Shelf.
  s.platforms = { :tvos => '18.0' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = '*.swift'
  s.frameworks = 'TVServices'
  s.dependency 'ExpoModulesCore'
end
