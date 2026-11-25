import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const xcode = require('xcode');
const withTopShelf = require('../app.plugin.js');
const { addExtensionTarget } = withTopShelf;

// The smallest project Expo's template resembles: an app target, its groups and configurations.
const FIXTURE = `// !$*UTF8*$!
{
	archiveVersion = 1;
	classes = {};
	objectVersion = 54;
	objects = {

/* Begin PBXFileReference section */
		A1 /* Vela.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Vela.app; sourceTree = BUILT_PRODUCTS_DIR; };
/* End PBXFileReference section */

/* Begin PBXGroup section */
		G0 = {isa = PBXGroup; children = (G1 /* Products */, ); sourceTree = "<group>"; };
		G1 /* Products */ = {isa = PBXGroup; children = (A1 /* Vela.app */, ); name = Products; sourceTree = "<group>"; };
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		T1 /* Vela */ = {isa = PBXNativeTarget; buildConfigurationList = L1; buildPhases = (P1 /* Sources */, ); buildRules = (); dependencies = (); name = Vela; productName = Vela; productReference = A1 /* Vela.app */; productType = "com.apple.product-type.application"; };
/* End PBXNativeTarget section */

/* Begin PBXProject section */
		R1 /* Project object */ = {isa = PBXProject; attributes = {}; buildConfigurationList = L0; compatibilityVersion = "Xcode 3.2"; mainGroup = G0; productRefGroup = G1 /* Products */; projectDirPath = ""; projectRoot = ""; targets = (T1 /* Vela */, ); };
/* End PBXProject section */

/* Begin PBXSourcesBuildPhase section */
		P1 /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
/* End PBXSourcesBuildPhase section */

/* Begin XCBuildConfiguration section */
		C0 /* Release */ = {isa = XCBuildConfiguration; buildSettings = {}; name = Release; };
		C1 /* Release */ = {isa = XCBuildConfiguration; buildSettings = {PRODUCT_NAME = Vela; }; name = Release; };
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		L0 = {isa = XCConfigurationList; buildConfigurations = (C0 /* Release */, ); defaultConfigurationName = Release; };
		L1 = {isa = XCConfigurationList; buildConfigurations = (C1 /* Release */, ); defaultConfigurationName = Release; };
/* End XCConfigurationList section */
	};
	rootObject = R1 /* Project object */;
}
`;

let dir = '';
function project() {
  dir = mkdtempSync(join(tmpdir(), 'top-shelf-'));
  const file = join(dir, 'project.pbxproj');
  require('node:fs').writeFileSync(file, FIXTURE);
  const value = xcode.project(file);
  value.parseSync();
  return value;
}
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

const live = (section: Record<string, any>) => Object.entries(section ?? {}).filter(([key]) => !key.endsWith('_comment')).map(([, value]) => value);

describe('the extension target', () => {
  test('is built before the app and embedded in its PlugIns', () => {
    const p = project();
    expect(addExtensionTarget(p, { bundleId: 'app.ether.vela.topshelf' })).toBe(true);
    const objects = p.hash.project.objects;
    const targets = live(objects.PBXNativeTarget);
    const extension = targets.find(t => t.name === 'VelaTopShelfExtension');
    expect(extension.productType).toBe('"com.apple.product-type.app-extension"');
    const product = objects.PBXFileReference[extension.productReference];
    expect(product.path).toBe('VelaTopShelfExtension.appex');
    const app = objects.PBXNativeTarget.T1;
    expect(app.dependencies).toHaveLength(1);
    const embed = app.buildPhases.map((ref: any) => objects.PBXCopyFilesBuildPhase?.[ref.value]).find(Boolean);
    expect(embed.dstSubfolderSpec).toBe(13);
    expect(objects.PBXBuildFile[embed.files[0].value].fileRef).toBe(extension.productReference);
    const settings = live(objects.XCBuildConfiguration).filter(c => c.buildSettings.PRODUCT_BUNDLE_IDENTIFIER === '"app.ether.vela.topshelf"');
    expect(settings).toHaveLength(2);
    expect(settings[0].buildSettings).toMatchObject({ SDKROOT: 'appletvos', TARGETED_DEVICE_FAMILY: 3, INFOPLIST_FILE: '"VelaTopShelfExtension/VelaTopShelfExtension-Info.plist"',
      CODE_SIGN_ENTITLEMENTS: '"VelaTopShelfExtension/VelaTopShelfExtension.entitlements"', APPLICATION_EXTENSION_API_ONLY: 'YES' });
    // The project still writes and parses.
    const again = xcode.project(join(dir, 'project.pbxproj'));
    require('node:fs').writeFileSync(join(dir, 'project.pbxproj'), p.writeSync());
    again.parseSync();
    expect(live(again.hash.project.objects.PBXNativeTarget).map(t => t.name).sort()).toEqual(['Vela', 'VelaTopShelfExtension']);
  });

  test('a second prebuild over the same project adds nothing', () => {
    const p = project();
    addExtensionTarget(p, { bundleId: 'app.ether.vela.topshelf' });
    const before = p.writeSync();
    expect(addExtensionTarget(p, { bundleId: 'app.ether.vela.topshelf' })).toBe(false);
    expect(p.writeSync()).toBe(before);
  });
});

describe('the config plugin', () => {
  const config = () => ({ name: 'Vela', slug: 'vela', version: '0.2.63', ios: { bundleIdentifier: 'app.ether.vela' } });
  const saved = process.env.EXPO_TV;
  afterEach(() => { if (saved === undefined) delete process.env.EXPO_TV; else process.env.EXPO_TV = saved; });

  test('changes nothing for iPhone, iPad or Android', () => {
    delete process.env.EXPO_TV;
    const result = withTopShelf(config());
    expect(result).toEqual(config());
  });

  test('on Apple TV shares one App Group between the app and the extension', async () => {
    process.env.EXPO_TV = '1';
    const result: any = withTopShelf(config());
    const entitlements = await result.mods.ios.entitlements({ ...result, modResults: {}, modRequest: { platform: 'ios', modName: 'entitlements' } });
    expect(entitlements.modResults['com.apple.security.application-groups']).toEqual(['group.app.ether.vela']);
    const info = await result.mods.ios.infoPlist({ ...result, modResults: {}, modRequest: { platform: 'ios', modName: 'infoPlist' } });
    expect(info.modResults.VelaAppGroup).toBe('group.app.ether.vela');
    dir = mkdtempSync(join(tmpdir(), 'top-shelf-'));
    await result.mods.ios.dangerous({ ...result, modResults: {}, modRequest: { platform: 'ios', modName: 'dangerous', platformProjectRoot: dir, projectRoot: dir } });
    const plist = readFileSync(join(dir, 'VelaTopShelfExtension/VelaTopShelfExtension-Info.plist'), 'utf8');
    expect(plist).toContain('<string>com.apple.tv-top-shelf</string>');
    expect(plist).toContain('<string>group.app.ether.vela</string>');
    expect(plist).toContain('<string>0.2.63</string>');
    expect(readFileSync(join(dir, 'VelaTopShelfExtension/VelaTopShelfExtension.entitlements'), 'utf8')).toContain('<string>group.app.ether.vela</string>');
    expect(readFileSync(join(dir, 'VelaTopShelfExtension/VelaTopShelfExtension.swift'), 'utf8')).toContain('class ContentProvider: TVTopShelfContentProvider');
  });
});
