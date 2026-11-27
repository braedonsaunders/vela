import { test } from '@e2e-dev/web';
import { signInMockViewer } from './sign-in';

for (const suite of ['film', 'gallery', 'music', 'quality-cap', 'read', 'see-all', 'trailer-embed']) {
  const name = `mock-${suite}`;
  test.setup(`Mock release gate: sign in for ${suite}`, { sessions: [name] }, async ({ app, screen, session }) => {
    await signInMockViewer(app, screen);
    await session.save(name);
  });
}
