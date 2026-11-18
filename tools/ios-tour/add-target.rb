# Adds the VelaTour UI-test target (tools/ios-tour/*.swift) to the generated apps/vela/ios project
# and to the Vela scheme's test action. The test bundle runs in its own runner app; nothing joins
# Vela.app. Idempotent: run after every prebuild (tools/ios.sh --tour does).
#   ruby tools/ios-tour/add-target.rb <apps/vela/ios> <team>
require 'xcodeproj'

ios, team = ARGV
here = __dir__
path = File.join(ios, 'Vela.xcodeproj')
project = Xcodeproj::Project.open(path)
target = project.targets.find { |t| t.name == 'VelaTour' }
unless target
  app = project.targets.find { |t| t.name == 'Vela' } or abort 'add-target: no Vela target'
  target = project.new_target(:ui_test_bundle, 'VelaTour', :ios, '15.1')
  group = project.main_group.find_subpath('VelaTour', true)
  refs = Dir[File.join(here, '*.swift')].sort.map { |file| group.new_reference(file) }
  target.add_file_references(refs)
  target.add_dependency(app)
end
target.build_configurations.each do |config|
  s = config.build_settings
  s['TEST_TARGET_NAME'] = 'Vela'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'app.ether.vela.tour'
  s['PRODUCT_NAME'] = 'VelaTour'
  s['GENERATE_INFOPLIST_FILE'] = 'YES'
  s['SWIFT_VERSION'] = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['DEVELOPMENT_TEAM'] = team if team && !team.empty?
end
project.save

scheme_path = File.join(path, 'xcshareddata', 'xcschemes', 'Vela.xcscheme')
scheme = Xcodeproj::XCScheme.new(scheme_path)
unless scheme.test_action.testables.any? { |t| t.buildable_references.any? { |r| r.target_name == 'VelaTour' } }
  scheme.test_action.add_testable(Xcodeproj::XCScheme::TestAction::TestableReference.new(target))
  scheme.save_as(path, 'Vela', true)
end
