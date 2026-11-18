// Exact engine and LGPL FFmpeg pins survive every Expo prebuild.
const { withPodfileProperties, withXcodeProject } = require('expo/config-plugins');
module.exports = function withApplePlayer(config) {
  config = withPodfileProperties(config, mod => {
    mod.modResults['ios.deploymentTarget'] = '18.0';
    return mod;
  });
  return withXcodeProject(config, mod => {
    const project = mod.modResults;
    for (const section of Object.values(project.pbxXCBuildConfigurationSection())) {
      if (!section.buildSettings) continue;
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
    return mod;
  });
};
