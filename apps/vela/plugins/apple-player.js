// Keep deployment and package integration reproducible across Expo prebuilds.
const { withPodfileProperties, withXcodeProject } = require('expo/config-plugins');
module.exports = function withApplePlayer(config) {
  config = withPodfileProperties(config, mod => {
    mod.modResults['ios.deploymentTarget'] = '18.0';
    return mod;
  });
  return withXcodeProject(config, mod => {
    const project = mod.modResults;
    const objects = project.hash.project.objects;
    const target = objects.PBXNativeTarget[project.getFirstTarget().uuid];
    const appConfigs = new Set(objects.XCConfigurationList[target.buildConfigurationList].buildConfigurations.map(ref => ref.value));
    const libraries = ['avcodec', 'avformat', 'avutil', 'avfilter', 'avdevice', 'swresample', 'swscale', 'dav1d'];
    const clean = value => String(value).replaceAll('"', '');
    for (const [id, section] of Object.entries(project.pbxXCBuildConfigurationSection())) {
      if (!section.buildSettings) continue;
      section.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '18.0';
      section.buildSettings.TVOS_DEPLOYMENT_TARGET = '18.0';
      if (!appConfigs.has(id)) {
        const flags = section.buildSettings.OTHER_LDFLAGS;
        if (Array.isArray(flags) && (flags.some(value => clean(value) === 'AetherLibavcodec') ||
          (flags.some(value => clean(value) === 'Libavcodec') && flags.some(value => clean(value).includes('dead_strip_dylibs'))))) {
          const remaining = [];
          for (let i = 0; i < flags.length; i++) {
            const value = clean(flags[i]);
            if (value === '-framework' && /^(?:Aether)?Lib(?:av|sw|dav1d|zimg|zvbi)/.test(clean(flags[i + 1]))) { i++; continue; }
            if (value === '-Wl' && clean(flags[i + 1]) === '-dead_strip_dylibs') { i++; continue; }
            if (value.includes('dead_strip_dylibs')) continue;
            remaining.push(flags[i]);
          }
          section.buildSettings.OTHER_LDFLAGS = remaining;
          delete section.buildSettings.LD_GENERATE_MAP_FILE;
        }
        continue;
      }
      // Both engines are static. Resolve every av_* reference against MPVKit's
      // FFmpeg; Aether's protocol-free binaries cannot serve mpv.
      section.buildSettings.OTHER_LDFLAGS = [
        ...libraries.flatMap(name => ['-framework', `Lib${name}`]),
        '"-Wl,-dead_strip_dylibs"',
        '"$(inherited)"',
      ];
      section.buildSettings.LD_GENERATE_MAP_FILE = 'YES';
    }
    objects.XCRemoteSwiftPackageReference ||= {};
    let packageID = Object.keys(objects.XCRemoteSwiftPackageReference).find(id =>
      String(objects.XCRemoteSwiftPackageReference[id]?.repositoryURL || '').includes('superuser404notfound/FFmpegBuild'));
    if (!packageID) {
      packageID = project.generateUuid();
      objects.XCRemoteSwiftPackageReference[packageID] = {
        isa: 'XCRemoteSwiftPackageReference',
        repositoryURL: '"https://github.com/superuser404notfound/FFmpegBuild"',
      };
      const root = project.getFirstProject().firstProject;
      root.packageReferences ||= [];
      root.packageReferences.push({ value: packageID, comment: 'FFmpegBuild' });
    }
    objects.XCRemoteSwiftPackageReference[packageID].requirement = { kind: 'exactVersion', version: '3.15.0' };
    // The pod compiles Aether with this package's headers. Do not link its dynamic
    // FFmpeg products into the app: both engines use the one static MPVKit build.
    // Also remove products written by older versions of this plugin.
    const products = objects.XCSwiftPackageProductDependency || {};
    const removedProducts = new Set(Object.keys(products).filter(id => products[id]?.package === packageID));
    const removedFiles = new Set(Object.keys(objects.PBXBuildFile || {}).filter(id =>
      removedProducts.has(objects.PBXBuildFile[id]?.productRef)));
    for (const target of Object.values(objects.PBXNativeTarget || {})) {
      if (target.packageProductDependencies) {
        target.packageProductDependencies = target.packageProductDependencies.filter(ref => !removedProducts.has(ref.value));
      }
    }
    for (const phase of Object.values(objects.PBXFrameworksBuildPhase || {})) {
      if (phase.files) phase.files = phase.files.filter(ref => !removedFiles.has(ref.value));
    }
    for (const id of removedFiles) { delete objects.PBXBuildFile[id]; delete objects.PBXBuildFile[`${id}_comment`]; }
    for (const id of removedProducts) { delete products[id]; delete products[`${id}_comment`]; }
    return mod;
  });
};
