import { expect, test } from 'bun:test';
const withPictureInPicture = require('../../../apps/vela/plugins/android-picture-in-picture');

async function manifest(activity: Record<string, string>) {
  const config: any = withPictureInPicture({ name: 'Vela', slug: 'vela' });
  const modResults = { manifest: { application: [{ $: {}, activity: [{ $: { 'android:name': '.Other' } }, { $: activity }] }] } };
  const result = await config.mods.android.manifest({ ...config, modResults, modRequest: { projectRoot: '/fixture', platform: 'android', modName: 'manifest' } });
  return result.modResults.manifest.application[0].activity;
}

test('the main activity declares picture-in-picture and keeps itself through the window resize', async () => {
  const [other, main] = await manifest({ 'android:name': '.MainActivity', 'android:configChanges': 'keyboard|orientation|screenSize|uiMode' });
  expect(main.$['android:supportsPictureInPicture']).toBe('true');
  expect(main.$['android:resizeableActivity']).toBe('true');
  const changes = main.$['android:configChanges'].split('|');
  for (const change of ['keyboard', 'uiMode', 'screenSize', 'smallestScreenSize', 'screenLayout', 'orientation']) expect(changes).toContain(change);
  expect(new Set(changes).size).toBe(changes.length);
  expect(other.$['android:supportsPictureInPicture']).toBeUndefined();
});

test('a manifest without the main activity is refused rather than built without the window', async () => {
  await expect(manifest({ 'android:name': '.Elsewhere' })).rejects.toThrow('MainActivity');
});
