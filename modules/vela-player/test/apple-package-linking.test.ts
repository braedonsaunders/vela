import { expect, test } from 'bun:test';
const withApplePlayer = require('../../../apps/vela/plugins/apple-player');

function project() {
  const configs: Record<string, any> = {
    appDebug: { buildSettings: {} }, appRelease: { buildSettings: {} },
    projectDebug: { buildSettings: { OTHER_LDFLAGS: ['"$(inherited)"', '-lCustom'] } },
    testsDebug: { buildSettings: { OTHER_LDFLAGS: ['"$(inherited)"', '-framework', 'XCTest'] } },
  };
  const objects: any = { XCBuildConfiguration: configs,
    XCConfigurationList: { app: { buildConfigurations: [{ value: 'appDebug' }, { value: 'appRelease' }] } },
    PBXNativeTarget: { app: { buildConfigurationList: 'app', buildPhases: [{ value: 'frameworks' }], packageProductDependencies: [] } },
    PBXFrameworksBuildPhase: { frameworks: { files: [] } }, PBXBuildFile: {},
  };
  let serial = 0;
  return { configs, objects, hash: { project: { objects } }, pbxXCBuildConfigurationSection: () => configs,
    getFirstTarget: () => ({ uuid: 'app' }), getFirstProject: () => ({ firstProject: {} }), generateUuid: () => serial++ === 0 ? 'package' : `id${serial}` };
}
async function apply(p: ReturnType<typeof project>) {
  const config: any = withApplePlayer({ name: 'Vela', slug: 'vela' });
  await config.mods.ios.xcodeproj({ ...config, modResults: p, modRequest: { projectRoot: '/fixture', platform: 'ios', modName: 'xcodeproj' } });
}

test('Apple uses pinned Aether FFmpeg without static provider overrides', async () => {
  const p = project();
  await apply(p);
  expect(p.configs.appRelease.buildSettings.OTHER_LDFLAGS).toBeUndefined();
  expect(p.objects.XCRemoteSwiftPackageReference.package.requirement).toEqual({ kind: 'exactVersion', version: '3.15.0' });
  expect(p.configs.projectDebug.buildSettings.OTHER_LDFLAGS).toEqual(['"$(inherited)"', '-lCustom']);
  expect(p.configs.testsDebug.buildSettings.OTHER_LDFLAGS).toEqual(['"$(inherited)"', '-framework', 'XCTest']);
});

test('upgrading removes static FFmpeg flags and preserves Aether dynamic products and unrelated flags', async () => {
  const p = project();
  p.configs.projectDebug.buildSettings.OTHER_LDFLAGS = ['"$(inherited)"', '-framework', 'Libavcodec', '-framework', 'Libavformat', '-Wl', '-dead_strip_dylibs', '-lCustom'];
  p.objects.XCRemoteSwiftPackageReference = { package: { repositoryURL: 'https://github.com/superuser404notfound/FFmpegBuild' } };
  p.objects.XCSwiftPackageProductDependency = { ffmpeg: { package: 'package', productName: 'AetherLibavcodec' } };
  p.objects.PBXBuildFile.old = { productRef: 'ffmpeg' };
  p.objects.PBXFrameworksBuildPhase.frameworks.files = [{ value: 'old' }];
  p.objects.PBXNativeTarget.app.packageProductDependencies = [{ value: 'ffmpeg' }];
  await apply(p);
  expect(p.configs.projectDebug.buildSettings.OTHER_LDFLAGS).toEqual(['"$(inherited)"', '-lCustom']);
  expect(p.objects.PBXNativeTarget.app.packageProductDependencies).toContainEqual({ value: 'ffmpeg' });
  expect(p.objects.PBXNativeTarget.app.packageProductDependencies).toHaveLength(9);
  expect(p.objects.PBXFrameworksBuildPhase.frameworks.files).toContainEqual({ value: 'old' });
  expect(p.objects.PBXFrameworksBuildPhase.frameworks.files).toHaveLength(9);
});

test('repeated prebuilds retain exactly one copy of each dynamic package product', async () => {
  const p = project();
  await apply(p);
  await apply(p);
  expect(p.objects.PBXNativeTarget.app.packageProductDependencies).toHaveLength(9);
  expect(p.objects.PBXFrameworksBuildPhase.frameworks.files).toHaveLength(9);
});

test('Apple transport permits explicitly selected public HTTP servers after prebuild', async () => {
  const config: any = withApplePlayer({ name: 'Vela', slug: 'vela' });
  const result = await config.mods.ios.infoPlist({ ...config,
    modResults: { NSAppTransportSecurity: { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true } },
    modRequest: { projectRoot: '/fixture', platform: 'ios', modName: 'infoPlist' } });
  expect(result.modResults.NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: true });
});

test('the object-audio decoder is pinned exactly beside FFmpeg', async () => {
  const p = project();
  await apply(p);
  const refs = Object.values(p.objects.XCRemoteSwiftPackageReference) as { repositoryURL: string; requirement: unknown }[];
  expect(refs.find(ref => ref.repositoryURL.includes('LibTrueHD'))?.requirement).toEqual({ kind: 'exactVersion', version: '3.2.0' });
  await apply(p);
  expect(refs.length).toBe(Object.values(p.objects.XCRemoteSwiftPackageReference).length);
});

test('every prebuild gives the Pods project AetherEngine traits exactly once', async () => {
  const config: any = withApplePlayer({ name: 'Vela', slug: 'vela' });
  const podfile = async (contents: string) => (await config.mods.ios.podfile({ ...config,
    modResults: { path: '/fixture/Podfile', contents, language: 'rb' },
    modRequest: { projectRoot: '/fixture', platform: 'ios', modName: 'podfile' } })).modResults.contents as string;
  const once = await podfile("target 'Vela' do\n  post_install do |installer|\n  end\nend\n");
  const twice = await podfile(once);
  expect(twice).toBe(once);
  expect(once.match(/post_integrate/g)?.length).toBe(1);
  for (const trait of withApplePlayer.AETHER_TRAITS) expect(once).toContain(trait);
  expect(withApplePlayer.AETHER_TRAITS).toEqual(['TrueHDObjectAudio', 'DTSXObjectAudio', 'DolbyVisionFelCurves']);
});
