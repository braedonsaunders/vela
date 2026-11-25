// The Top Shelf extension, added at an Apple TV prebuild (EXPO_TV=1) and nowhere else: a TV Services
// target (extension/VelaTopShelfExtension.swift) embedded in the app, and an App Group the app writes the
// Continue Watching snapshot into and the extension reads it from. iPhone, iPad and Android
// prebuilds are left exactly as they were.
const fs = require('fs');
const path = require('path');
const { withDangerousMod, withEntitlementsPlist, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

// Not `VelaTopShelf`: that is the app-side pod's module, and a target of the same name would shadow it.
const TARGET = 'VelaTopShelfExtension';
const GROUP_KEY = 'VelaAppGroup';
const APP_GROUPS = 'com.apple.security.application-groups';
const DEPLOYMENT_TARGET = '18.0';
const SOURCE = path.join(__dirname, '..', 'extension', `${TARGET}.swift`);

const isTV = () => /^(1|true|yes|on)$/i.test(process.env.EXPO_TV ?? '');
/** The app's bundle ID and what follows from it: the extension's bundle ID and the shared group. */
function identities(config) {
  const app = config.ios?.bundleIdentifier;
  if (!app) throw new Error('top-shelf: ios.bundleIdentifier is required');
  return { app, extension: `${app}.topshelf`, group: `group.${app}` };
}

const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function infoPlist({ name, version, build, group }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>$(DEVELOPMENT_LANGUAGE)</string>
	<key>CFBundleDisplayName</key>
	<string>${xml(name)}</string>
	<key>CFBundleExecutable</key>
	<string>$(EXECUTABLE_NAME)</string>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$(PRODUCT_NAME)</string>
	<key>CFBundlePackageType</key>
	<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
	<key>CFBundleShortVersionString</key>
	<string>${xml(version)}</string>
	<key>CFBundleVersion</key>
	<string>${xml(build)}</string>
	<key>${GROUP_KEY}</key>
	<string>${xml(group)}</string>
	<key>UIRequiredDeviceCapabilities</key>
	<array>
		<string>arm64</string>
	</array>
	<key>NSExtension</key>
	<dict>
		<key>NSExtensionPointIdentifier</key>
		<string>com.apple.tv-top-shelf</string>
		<key>NSExtensionPrincipalClass</key>
		<string>$(PRODUCT_MODULE_NAME).ContentProvider</string>
	</dict>
</dict>
</plist>
`;
}
function entitlements(group) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>${APP_GROUPS}</key>
	<array>
		<string>${xml(group)}</string>
	</array>
</dict>
</plist>
`;
}

/** The extension's files under ios/VelaTopShelfExtension, written fresh at every prebuild. */
function writeExtensionFiles(iosRoot, { name, version, build, group }) {
  const folder = path.join(iosRoot, TARGET);
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(SOURCE, path.join(folder, `${TARGET}.swift`));
  fs.writeFileSync(path.join(folder, `${TARGET}-Info.plist`), infoPlist({ name, version, build, group }));
  fs.writeFileSync(path.join(folder, `${TARGET}.entitlements`), entitlements(group));
}

const quoted = value => `"${value}"`;
const unquote = value => String(value ?? '').replace(/^"(.*)"$/, '$1');

/**
 * The extension target in the app's Xcode project, built and embedded (PlugIns) with the app.
 * Written object by object: the xcode package's addTarget names the product without `.appex` and
 * leaves the target dependency out of projects that have none yet. Adding it twice does nothing.
 */
function addExtensionTarget(project, { bundleId, deploymentTarget = DEPLOYMENT_TARGET }) {
  const objects = project.hash.project.objects;
  const section = name => (objects[name] ||= {});
  const add = (sectionName, value, comment) => {
    const uuid = project.generateUuid();
    section(sectionName)[uuid] = value;
    section(sectionName)[`${uuid}_comment`] = comment;
    return uuid;
  };
  const targets = section('PBXNativeTarget');
  if (Object.keys(targets).some(key => !key.endsWith('_comment') && unquote(targets[key].name) === TARGET)) return false;
  const app = project.getFirstTarget();
  if (!app) throw new Error('top-shelf: the project has no app target');

  const file = (name, type) => add('PBXFileReference', { isa: 'PBXFileReference', lastKnownFileType: type, path: quoted(name), sourceTree: quoted('<group>') }, name);
  const swift = file(`${TARGET}.swift`, 'sourcecode.swift');
  const plist = file(`${TARGET}-Info.plist`, 'text.plist.xml');
  const entitlement = file(`${TARGET}.entitlements`, 'text.plist.entitlements');
  const product = add('PBXFileReference', { isa: 'PBXFileReference', explicitFileType: quoted('wrapper.app-extension'), includeInIndex: 0,
    path: `${TARGET}.appex`, sourceTree: 'BUILT_PRODUCTS_DIR' }, `${TARGET}.appex`);

  const group = add('PBXGroup', { isa: 'PBXGroup', children: [
    { value: swift, comment: `${TARGET}.swift` }, { value: plist, comment: `${TARGET}-Info.plist` }, { value: entitlement, comment: `${TARGET}.entitlements` },
  ], path: TARGET, sourceTree: quoted('<group>') }, TARGET);
  const root = project.getFirstProject().firstProject;
  const main = section('PBXGroup')[root.mainGroup];
  main.children.push({ value: group, comment: TARGET });
  const productsGroup = section('PBXGroup')[root.productRefGroup];
  productsGroup?.children.push({ value: product, comment: `${TARGET}.appex` });

  const sourceFile = add('PBXBuildFile', { isa: 'PBXBuildFile', fileRef: swift, fileRef_comment: `${TARGET}.swift` }, `${TARGET}.swift in Sources`);
  const phase = (isa, name, files) => ({ value: add(isa, { isa, buildActionMask: 2147483647, files, runOnlyForDeploymentPostprocessing: 0 }, name), comment: name });
  const buildPhases = [
    phase('PBXSourcesBuildPhase', 'Sources', [{ value: sourceFile, comment: `${TARGET}.swift in Sources` }]),
    phase('PBXFrameworksBuildPhase', 'Frameworks', []),
    phase('PBXResourcesBuildPhase', 'Resources', []),
  ];

  const settings = {
    APPLICATION_EXTENSION_API_ONLY: 'YES',
    CODE_SIGN_ENTITLEMENTS: quoted(`${TARGET}/${TARGET}.entitlements`),
    CURRENT_PROJECT_VERSION: 1,
    GENERATE_INFOPLIST_FILE: 'NO',
    INFOPLIST_FILE: quoted(`${TARGET}/${TARGET}-Info.plist`),
    LD_RUNPATH_SEARCH_PATHS: quoted('$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks'),
    PRODUCT_BUNDLE_IDENTIFIER: quoted(bundleId),
    PRODUCT_NAME: quoted('$(TARGET_NAME)'),
    SDKROOT: 'appletvos',
    SKIP_INSTALL: 'YES',
    SWIFT_VERSION: '5.0',
    TARGETED_DEVICE_FAMILY: 3,
    TVOS_DEPLOYMENT_TARGET: deploymentTarget,
  };
  const configurations = ['Debug', 'Release'].map(name => ({ value: add('XCBuildConfiguration', { isa: 'XCBuildConfiguration',
    buildSettings: { ...settings, ...(name === 'Debug' ? { SWIFT_ACTIVE_COMPILATION_CONDITIONS: quoted('DEBUG $(inherited)'), SWIFT_OPTIMIZATION_LEVEL: quoted('-Onone') } : { SWIFT_COMPILATION_MODE: 'wholemodule' }) },
    name }, name), comment: name }));
  const configurationList = add('XCConfigurationList', { isa: 'XCConfigurationList', buildConfigurations: configurations,
    defaultConfigurationIsVisible: 0, defaultConfigurationName: 'Release' }, `Build configuration list for PBXNativeTarget "${TARGET}"`);

  const target = add('PBXNativeTarget', { isa: 'PBXNativeTarget', buildConfigurationList: configurationList,
    buildConfigurationList_comment: `Build configuration list for PBXNativeTarget "${TARGET}"`, buildPhases, buildRules: [], dependencies: [],
    name: TARGET, productName: TARGET, productReference: product, productReference_comment: `${TARGET}.appex`,
    productType: quoted('com.apple.product-type.app-extension') }, TARGET);
  root.targets.push({ value: target, comment: TARGET });
  root.attributes ||= {};
  root.attributes.TargetAttributes ||= {};
  root.attributes.TargetAttributes[target] = { CreatedOnToolsVersion: '16.0' };

  // The app builds the extension first and embeds it in PlugIns.
  const proxy = add('PBXContainerItemProxy', { isa: 'PBXContainerItemProxy', containerPortal: project.hash.project.rootObject,
    containerPortal_comment: 'Project object', proxyType: 1, remoteGlobalIDString: target, remoteInfo: TARGET }, 'PBXContainerItemProxy');
  const dependency = add('PBXTargetDependency', { isa: 'PBXTargetDependency', target, target_comment: TARGET, targetProxy: proxy,
    targetProxy_comment: 'PBXContainerItemProxy' }, 'PBXTargetDependency');
  const appTarget = targets[app.uuid];
  appTarget.dependencies ||= [];
  appTarget.dependencies.push({ value: dependency, comment: 'PBXTargetDependency' });
  const embedFile = add('PBXBuildFile', { isa: 'PBXBuildFile', fileRef: product, fileRef_comment: `${TARGET}.appex`,
    settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] } }, `${TARGET}.appex in Embed Foundation Extensions`);
  const embed = add('PBXCopyFilesBuildPhase', { isa: 'PBXCopyFilesBuildPhase', buildActionMask: 2147483647, dstPath: quoted(''), dstSubfolderSpec: 13,
    files: [{ value: embedFile, comment: `${TARGET}.appex in Embed Foundation Extensions` }], name: quoted('Embed Foundation Extensions'),
    runOnlyForDeploymentPostprocessing: 0 }, 'Embed Foundation Extensions');
  appTarget.buildPhases.push({ value: embed, comment: 'Embed Foundation Extensions' });
  return true;
}

function withTopShelf(config) {
  if (!isTV()) return config;
  const { extension, group } = identities(config);
  config = withEntitlementsPlist(config, mod => {
    const groups = Array.isArray(mod.modResults[APP_GROUPS]) ? mod.modResults[APP_GROUPS] : [];
    if (!groups.includes(group)) mod.modResults[APP_GROUPS] = [...groups, group];
    return mod;
  });
  config = withInfoPlist(config, mod => {
    mod.modResults[GROUP_KEY] = group;
    return mod;
  });
  config = withDangerousMod(config, ['ios', mod => {
    writeExtensionFiles(mod.modRequest.platformProjectRoot, {
      name: config.name, version: config.version ?? '1.0.0', build: config.ios?.buildNumber ?? '1', group,
    });
    return mod;
  }]);
  return withXcodeProject(config, mod => {
    addExtensionTarget(mod.modResults, { bundleId: extension });
    return mod;
  });
}

module.exports = withTopShelf;
module.exports.addExtensionTarget = addExtensionTarget;
module.exports.identities = identities;
module.exports.TARGET = TARGET;
