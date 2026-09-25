# One-time (idempotent) project wiring for Send to CiViX on iOS: adds the
# shared capture code + Siri intent to the App target and creates the
# ShareExtension target, embedded in the app. Run with CocoaPods' Ruby:
#   PATH=/usr/local/opt/ruby@3.3/bin:$PATH ruby scripts/ios-add-share-extension.rb
require 'xcodeproj'
proj_path = File.expand_path('../ios/App/App.xcodeproj', __dir__)
proj = Xcodeproj::Project.open(proj_path)
app = proj.targets.find { |t| t.name == 'App' }
root = proj.main_group

def group_for(proj, path)
  proj.main_group.children.find { |c| c.respond_to?(:path) && c.path == path } || proj.main_group.new_group(path, path)
end

app_group = proj.main_group.children.find { |c| c.display_name == 'App' }
shared = group_for(proj, 'Shared')
ext_group = group_for(proj, 'ShareExtension')

def ref(group, name)
  group.files.find { |f| f.path == name } || group.new_reference(name)
end

capture = ref(shared, 'CivixCapture.swift')
%w[CivixShared.swift SendToCivixIntent.swift].each do |f|
  r = ref(app_group, f)
  app.add_file_references([r]) unless app.source_build_phase.files_references.include?(r)
end
app.add_file_references([capture]) unless app.source_build_phase.files_references.include?(capture)

ext = proj.targets.find { |t| t.name == 'ShareExtension' }
unless ext
  ext = proj.new_target(:app_extension, 'ShareExtension', :ios, '16.0')
  ext.add_file_references([ref(ext_group, 'ShareViewController.swift'), capture])
  ref(ext_group, 'Info.plist'); ref(ext_group, 'ShareExtension.entitlements')
  app.add_dependency(ext)
  embed = app.new_copy_files_build_phase('Embed App Extensions')
  embed.dst_subfolder_spec = '13'
  bf = embed.add_file_reference(ext.product_reference, true)
  bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
end

app_settings = app.build_configurations.first.build_settings
ext.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.mycivix.ios.share'
  s['INFOPLIST_FILE'] = 'ShareExtension/Info.plist'
  s['CODE_SIGN_ENTITLEMENTS'] = 'ShareExtension/ShareExtension.entitlements'
  s['DEVELOPMENT_TEAM'] = '22Q786NFKQ'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['SWIFT_VERSION'] = '5.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '16.0'
  s['MARKETING_VERSION'] = app_settings['MARKETING_VERSION'] || '1.0'
  s['CURRENT_PROJECT_VERSION'] = '$(CURRENT_PROJECT_VERSION)' == '' ? '1' : (app_settings['CURRENT_PROJECT_VERSION'] || '1')
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['SKIP_INSTALL'] = 'YES'
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
end
proj.save
puts "App sources: #{app.source_build_phase.files_references.map(&:path).join(', ')}"
puts "ShareExtension sources: #{ext.source_build_phase.files_references.map(&:path).join(', ')}"
