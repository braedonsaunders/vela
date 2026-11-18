// Keep deployment and package integration reproducible across Expo prebuilds.
const { withPodfileProperties, withXcodeProject } = require('expo/config-plugins');
module.exports = function withApplePlayer(config) {
  config = withPodfileProperties(config, mod => {
    mod.modResults['ios.deploymentTarget'] = '18.0';
    return mod;
  });
  return withXcodeProject(config, mod => {
    for (const section of Object.values(mod.modResults.pbxXCBuildConfigurationSection())) {
      if (!section.buildSettings) continue;
      section.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '18.0';
      section.buildSettings.TVOS_DEPLOYMENT_TARGET = '18.0';
      // AetherEngine's static object must resolve av_* to its own FFmpeg,
      // before the inherited MPVKit framework flags.
      section.buildSettings.OTHER_LDFLAGS = [
        ...['avcodec', 'avformat', 'avutil', 'avfilter', 'swresample', 'swscale', 'dav1d', 'zimg', 'zvbi']
          .flatMap(name => ['-framework', `AetherLib${name}`]),
        '"$(inherited)"',
      ];
    }
    // The static pod already contains AetherEngine and Dovi. Link only the
    // dynamic FFmpeg products here, otherwise -ObjC loads the engine twice.
    const project = mod.modResults;
    const objects = project.hash.project.objects;
    const target = project.getFirstTarget().uuid;
    if (Object.values(objects.XCRemoteSwiftPackageReference || {}).some(
      ref => String(ref.repositoryURL || '').includes('superuser404notfound/FFmpegBuild'))) return mod;
    const packageID = project.generateUuid();
    objects.XCRemoteSwiftPackageReference ||= {};
    objects.XCSwiftPackageProductDependency ||= {};
    objects.XCRemoteSwiftPackageReference[packageID] = {
      isa: 'XCRemoteSwiftPackageReference',
      repositoryURL: '"https://github.com/superuser404notfound/FFmpegBuild"',
      requirement: { kind: 'exactVersion', version: '3.15.0' },
    };
    const root = project.getFirstProject().firstProject;
    root.packageReferences ||= [];
    root.packageReferences.push({ value: packageID, comment: 'FFmpegBuild' });
    const nativeTarget = objects.PBXNativeTarget[target];
    nativeTarget.packageProductDependencies ||= [];
    const phase = Object.values(objects.PBXFrameworksBuildPhase).find(p => p.isa === 'PBXFrameworksBuildPhase');
    for (const name of ['avcodec', 'avformat', 'avutil', 'avfilter', 'swresample', 'swscale', 'dav1d', 'zimg', 'zvbi']) {
      const productID = project.generateUuid();
      const buildID = project.generateUuid();
      const productName = `AetherLib${name}`;
      objects.XCSwiftPackageProductDependency[productID] = {
        isa: 'XCSwiftPackageProductDependency', package: packageID, productName,
      };
      nativeTarget.packageProductDependencies.push({ value: productID, comment: productName });
      objects.PBXBuildFile[buildID] = { isa: 'PBXBuildFile', productRef: productID };
      phase.files.push({ value: buildID, comment: `${productName} in Frameworks` });
    }
    return mod;
  });
};
