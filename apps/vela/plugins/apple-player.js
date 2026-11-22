// Exact engine, LGPL FFmpeg and LibTrueHD pins, and the engine's package traits, survive every Expo prebuild.
const { withInfoPlist, withPodfile, withPodfileProperties, withXcodeProject } = require('expo/config-plugins');

// AetherEngine's optional components are SwiftPM package traits, off by default. React Native's
// spm_dependency cannot name traits, and CocoaPods' project model has no key for them, so the Podfile
// teaches the model a traits attribute and sets it on the engine's reference after integration: TrueHD Atmos objects and DTS:X heights rendered for
// tvOS to carry as Dolby MAT, and a Profile 7 FEL enhancement layer folded into its 8.1 RPU.
const AETHER_TRAITS = ['TrueHDObjectAudio', 'DTSXObjectAudio', 'DolbyVisionFelCurves'];
const TRAITS_MARKER = '# @vela/apple-player: AetherEngine package traits';
const traitsHook = String.raw`${TRAITS_MARKER}
# The Pods project is saved again after integration, so the traits live on the in-memory reference.
Xcodeproj::Project::Object::XCRemoteSwiftPackageReference.class_eval do
  attribute :traits, Array unless method_defined?(:traits)
end
post_integrate do |installer|
  project = installer.pods_project
  refs = project.root_object.package_references.select do |ref|
    ref.respond_to?(:repositoryURL) && ref.repositoryURL.to_s.include?('superuser404notfound/AetherEngine')
  end
  raise 'AetherEngine package reference not found in the Pods project' if refs.empty?
  traits = %w[${AETHER_TRAITS.join(' ')}]
  refs.each { |ref| ref.traits = traits unless ref.traits == traits }
  project.save
end
`;
module.exports = withApplePlayer;
module.exports.AETHER_TRAITS = AETHER_TRAITS;
function withApplePlayer(config) {
  config = withPodfile(config, mod => {
    const podfile = mod.modResults;
    const start = podfile.contents.indexOf(TRAITS_MARKER);
    const kept = start < 0 ? podfile.contents : podfile.contents.slice(0, start).trimEnd() + '\n';
    podfile.contents = `${kept.trimEnd()}\n\n${traitsHook}`;
    return mod;
  });
  config = withPodfileProperties(config, mod => {
    mod.modResults['ios.deploymentTarget'] = '18.0';
    return mod;
  });
  config = withInfoPlist(config, mod => {
    const ats = mod.modResults.NSAppTransportSecurity;
    // Public HTTP servers are user-selected too. On modern Apple OS versions,
    // the local-only key overrides NSAllowsArbitraryLoads, even when both are true.
    if (ats?.NSAllowsArbitraryLoads === true) delete ats.NSAllowsLocalNetworking;
    return mod;
  });
  return withXcodeProject(config, mod => {
    const project = mod.modResults;
    for (const section of Object.values(project.pbxXCBuildConfigurationSection())) {
      if (!section.buildSettings) continue;
      // Remove the old static-provider overrides when updating a generated project.
      const flags = section.buildSettings.OTHER_LDFLAGS;
      if (Array.isArray(flags)) {
        const clean = value => String(value).replaceAll('"', '');
        const kept = [];
        for (let i = 0; i < flags.length; i++) {
          if (clean(flags[i]) === '-framework' && /^Lib(?:av|sw|dav1d)/.test(clean(flags[i + 1]))) { i++; continue; }
          if (clean(flags[i]) === '-Wl' && clean(flags[i + 1]) === '-dead_strip_dylibs') { i++; continue; }
          if (clean(flags[i]).includes('dead_strip_dylibs')) continue;
          kept.push(flags[i]);
        }
        section.buildSettings.OTHER_LDFLAGS = kept;
      }
      section.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '18.0';
      section.buildSettings.TVOS_DEPLOYMENT_TARGET = '18.0';
    }
    // AetherEngine consumes these products transitively. An exact root constraint
    // prevents its upToNextMinor requirement from silently updating FFmpeg.
    const objects = project.hash.project.objects;
    objects.XCRemoteSwiftPackageReference ||= {};
    const pin = (name, version) => {
      let ref = Object.keys(objects.XCRemoteSwiftPackageReference).find(key =>
        String(objects.XCRemoteSwiftPackageReference[key]?.repositoryURL || '').includes(`superuser404notfound/${name}`));
      if (!ref) {
        ref = project.generateUuid();
        objects.XCRemoteSwiftPackageReference[ref] = {
          isa: 'XCRemoteSwiftPackageReference',
          repositoryURL: `"https://github.com/superuser404notfound/${name}"`,
        };
        const root = project.getFirstProject().firstProject;
        root.packageReferences ||= [];
        root.packageReferences.push({ value: ref, comment: name });
      }
      objects.XCRemoteSwiftPackageReference[ref].requirement = { kind: 'exactVersion', version };
      return ref;
    };
    const id = pin('FFmpegBuild', '3.15.0');
    // The TrueHDObjectAudio trait's decoder floats on its minor inside AetherEngine; the app pins it.
    pin('LibTrueHD', '3.2.0');
    // CocoaPods compiles the static engine, but Xcode needs app product references
    // to copy and sign its dynamic FFmpeg dependencies into the application.
    objects.XCSwiftPackageProductDependency ||= {};
    objects.PBXBuildFile ||= {};
    const target = objects.PBXNativeTarget[project.getFirstTarget().uuid];
    target.packageProductDependencies ||= [];
    const phaseRef = target.buildPhases.find(ref => objects.PBXFrameworksBuildPhase[ref.value]);
    const phase = objects.PBXFrameworksBuildPhase[phaseRef.value];
    for (const name of ['avcodec', 'avformat', 'avutil', 'swresample', 'swscale', 'avfilter', 'dav1d', 'zimg', 'zvbi']) {
      const productName = `AetherLib${name}`;
      let product = Object.keys(objects.XCSwiftPackageProductDependency).find(key =>
        objects.XCSwiftPackageProductDependency[key]?.package === id &&
        objects.XCSwiftPackageProductDependency[key]?.productName === productName);
      if (!product) {
        product = project.generateUuid();
        objects.XCSwiftPackageProductDependency[product] = { isa: 'XCSwiftPackageProductDependency', package: id, productName };
      }
      if (!target.packageProductDependencies.some(ref => ref.value === product)) {
        target.packageProductDependencies.push({ value: product, comment: productName });
      }
      if (!phase.files.some(ref => objects.PBXBuildFile[ref.value]?.productRef === product)) {
        const file = project.generateUuid();
        objects.PBXBuildFile[file] = { isa: 'PBXBuildFile', productRef: product, productRef_comment: productName };
        phase.files.push({ value: file, comment: `${productName} in Frameworks` });
      }
    }
    return mod;
  });
}
