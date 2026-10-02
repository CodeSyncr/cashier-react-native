require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "cashier-react-native"
  s.module_name  = "CashierReactNative"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "15.0" }
  s.source       = { :git => "https://github.com/CodeSyncr/cashier-react-native.git", :tag => s.version.to_s }
  s.swift_version = "5.10"

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.pod_target_xcconfig = { "DEFINES_MODULE" => "YES" }

  # The native iOS SDK (github.com/CodeSyncr/cashier-ios, NimbusCashier.podspec).
  s.dependency "NimbusCashier", "~> #{package["cashier"]["iosSdkVersion"]}"

  # React Native >= 0.71: React-Core plus, with the new architecture, the
  # codegen'd RNCashierSpec and TurboModule headers.
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end
end
