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
    PBXNativeTarget: { app: { buildConfigurationList: 'app', packageProductDependencies: [] } },
    PBXFrameworksBuildPhase: { frameworks: { files: [] } }, PBXBuildFile: {},
  };
  return { configs, objects, hash: { project: { objects } }, pbxXCBuildConfigurationSection: () => configs,
    getFirstTarget: () => ({ uuid: 'app' }), getFirstProject: () => ({ firstProject: {} }), generateUuid: () => 'package' };
}
async function apply(p: ReturnType<typeof project>) {
  const config: any = withApplePlayer({ name: 'Vela', slug: 'vela' });
  await config.mods.ios.xcodeproj({ ...config, modResults: p, modRequest: { projectRoot: '/fixture', platform: 'ios', modName: 'xcodeproj' } });
}

test('FFmpeg belongs to the app link, while project and UI-test linker flags stay intact', async () => {
  const p = project();
  await apply(p);
  expect(p.configs.appRelease.buildSettings.OTHER_LDFLAGS).toContain('Libavcodec');
  expect(p.configs.projectDebug.buildSettings.OTHER_LDFLAGS).toEqual(['"$(inherited)"', '-lCustom']);
  expect(p.configs.testsDebug.buildSettings.OTHER_LDFLAGS).toEqual(['"$(inherited)"', '-framework', 'XCTest']);
});

test('upgrading removes global FFmpeg flags and app package products without dropping unrelated flags', async () => {
  const p = project();
  p.configs.projectDebug.buildSettings.OTHER_LDFLAGS = ['"$(inherited)"', '-framework', 'Libavcodec', '-framework', 'Libavformat', '-Wl', '-dead_strip_dylibs', '-lCustom'];
  p.objects.XCRemoteSwiftPackageReference = { package: { repositoryURL: 'https://github.com/superuser404notfound/FFmpegBuild' } };
  p.objects.XCSwiftPackageProductDependency = { ffmpeg: { package: 'package', productName: 'AetherLibavcodec' } };
  p.objects.PBXBuildFile.old = { productRef: 'ffmpeg' };
  p.objects.PBXFrameworksBuildPhase.frameworks.files = [{ value: 'old' }];
  p.objects.PBXNativeTarget.app.packageProductDependencies = [{ value: 'ffmpeg' }];
  await apply(p);
  expect(p.configs.projectDebug.buildSettings.OTHER_LDFLAGS).toEqual(['"$(inherited)"', '-lCustom']);
  expect(p.objects.PBXNativeTarget.app.packageProductDependencies).toEqual([]);
  expect(p.objects.PBXFrameworksBuildPhase.frameworks.files).toEqual([]);
});
