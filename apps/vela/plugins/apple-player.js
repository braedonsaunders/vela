// Exact engine and LGPL FFmpeg pins survive every Expo prebuild.
const { withInfoPlist, withPodfileProperties, withXcodeProject } = require('expo/config-plugins');
module.exports = function withApplePlayer(config) {
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
    let id = Object.keys(objects.XCRemoteSwiftPackageReference).find(key =>
      String(objects.XCRemoteSwiftPackageReference[key]?.repositoryURL || '').includes('superuser404notfound/FFmpegBuild'));
    if (!id) {
      id = project.generateUuid();
      objects.XCRemoteSwiftPackageReference[id] = {
        isa: 'XCRemoteSwiftPackageReference',
        repositoryURL: '"https://github.com/superuser404notfound/FFmpegBuild"',
      };
      const root = project.getFirstProject().firstProject;
      root.packageReferences ||= [];
      root.packageReferences.push({ value: id, comment: 'FFmpegBuild' });
    }
    objects.XCRemoteSwiftPackageReference[id].requirement = { kind: 'exactVersion', version: '3.15.0' };
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
};
