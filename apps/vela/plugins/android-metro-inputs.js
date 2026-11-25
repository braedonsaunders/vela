// React Native tracks JS under the Expo app root. Metro also bundles workspace
// sources and assets, including the shipped skin fixtures and visualizer previews.
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withAndroidMetroInputs(config) {
  return withAppBuildGradle(config, mod => {
    if (!mod.modResults.contents.includes("withPropertyName('velaMetroWorkspace')")) {
      mod.modResults.contents += `
tasks.withType(com.facebook.react.tasks.BundleHermesCTask).configureEach {
    def workspace = new File(rootProject.projectDir, '../../..')
    inputs.files(fileTree(workspace) {
        include 'bun.lock', 'package.json', 'apps/vela/package.json', 'apps/vela/app.json', 'apps/vela/assets/**'
        include 'packages/*/package.json', 'packages/*/src/**', 'modules/*/package.json', 'modules/*/src/**'
        include 'packages/protocol/*.ts', 'packages/protocol/fixtures/skins/**'
        include 'packages/visualizer/scenes.json', 'packages/visualizer/thumbnails.ts', 'packages/visualizer/thumbnails/**'
        include 'modules/vela-player/web/metro*.js', 'modules/vela-player/web/source-transform.ts', 'modules/vela-player/web/engine/**'
        exclude '**/node_modules/**', '**/build/**'
    }).withPropertyName('velaMetroWorkspace').withPathSensitivity(PathSensitivity.RELATIVE)
}
`;
    }
    // Metro copies the current assets into an existing task output. Drop that
    // output before rebundling so removing a preview also removes it from the APK.
    if (!mod.modResults.contents.includes('// Vela Metro generated resources')) {
      mod.modResults.contents += `
// Vela Metro generated resources
tasks.withType(com.facebook.react.tasks.BundleHermesCTask).configureEach {
    doFirst { bundle -> bundle.resourcesDir.get().asFile.deleteDir() }
}
`;
    }
    return mod;
  });
};
