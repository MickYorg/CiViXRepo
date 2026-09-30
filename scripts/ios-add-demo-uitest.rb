# One-time (idempotent) project wiring for the daily demo clip: adds the
# AppUITests UI-test target (ios/App/AppUITests) and a shared "DemoLoop"
# scheme that builds App and runs that test. Run with CocoaPods' Ruby:
#   PATH=/usr/local/opt/ruby@3.3/bin:$PATH ruby scripts/ios-add-demo-uitest.rb
require 'xcodeproj'
proj_path = File.expand_path('../ios/App/App.xcodeproj', __dir__)
proj = Xcodeproj::Project.open(proj_path)
app = proj.targets.find { |t| t.name == 'App' }

group = proj.main_group.children.find { |c| c.respond_to?(:path) && c.path == 'AppUITests' } ||
        proj.main_group.new_group('AppUITests', 'AppUITests')
file = group.files.find { |f| f.path == 'DemoLoopUITests.swift' } || group.new_reference('DemoLoopUITests.swift')

tests = proj.targets.find { |t| t.name == 'AppUITests' }
unless tests
  tests = proj.new_target(:ui_test_bundle, 'AppUITests', :ios, '16.0')
  tests.add_file_references([file])
  tests.add_dependency(app)
end
tests.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.mycivix.ios.uitests'
  s['TEST_TARGET_NAME'] = 'App'
  s['DEVELOPMENT_TEAM'] = '22Q786NFKQ'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['SWIFT_VERSION'] = '5.0'
  s['GENERATE_INFOPLIST_FILE'] = 'YES'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '16.4'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
end
proj.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(tests)
scheme.set_launch_target(app)
scheme.save_as(proj_path, 'DemoLoop', true)
puts "AppUITests sources: #{tests.source_build_phase.files_references.map(&:path).join(', ')}"
