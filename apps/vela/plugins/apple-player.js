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
    }
    // The pod imports the product; the app must also link it so SwiftPM embeds
    // its transitive dynamic FFmpeg frameworks and resource bundle.
    const project = mod.modResults;
    const objects = project.hash.project.objects;
    const target = project.getFirstTarget().uuid;
    const packageID = project.generateUuid();
    const productID = project.generateUuid();
    const buildID = project.generateUuid();
    objects.XCRemoteSwiftPackageReference ||= {};
    objects.XCSwiftPackageProductDependency ||= {};
    objects.XCRemoteSwiftPackageReference[packageID] = {
      isa: 'XCRemoteSwiftPackageReference',
      repositoryURL: '"https://github.com/superuser404notfound/AetherEngine"',
      requirement: { kind: 'exactVersion', version: '7.70.0' },
    };
    const root = project.getFirstProject().firstProject;
    root.packageReferences ||= [];
    root.packageReferences.push({ value: packageID, comment: 'AetherEngine' });
    objects.XCSwiftPackageProductDependency[productID] = {
      isa: 'XCSwiftPackageProductDependency', package: packageID, productName: 'AetherEngine',
    };
    objects.PBXNativeTarget[target].packageProductDependencies ||= [];
    objects.PBXNativeTarget[target].packageProductDependencies.push({ value: productID, comment: 'AetherEngine' });
    objects.PBXBuildFile[buildID] = { isa: 'PBXBuildFile', productRef: productID };
    const phase = Object.values(objects.PBXFrameworksBuildPhase).find(p => p.isa === 'PBXFrameworksBuildPhase');
    phase.files.push({ value: buildID, comment: 'AetherEngine in Frameworks' });
    return mod;
  });
};
