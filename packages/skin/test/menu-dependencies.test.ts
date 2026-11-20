import { expect, test } from 'bun:test';
import { resolveDocument } from '../src/resolve';
import { sameRouteHost } from '../src/route-host';
import type { SkinHost } from '../src/host';
import { cinematicDoc } from '../../protocol/fixtures/skins/cinematic';
import mochi from '../../protocol/fixtures/skins/mochi/document';
import marquee from '../../protocol/fixtures/skins/marquee/document';
import jellytwin from '../../protocol/fixtures/skins/jellytwin/document';
import index from '../../protocol/fixtures/skins/index/document';
import lounge from '../../protocol/fixtures/skins/lounge/document';
import latenight from '../../protocol/fixtures/skins/latenight/document';
import kids from '../../protocol/fixtures/skins/kids/document';
import broadcast from '../../protocol/fixtures/skins/broadcast/document';

test('built-in home routes remain independent of the shell profile menu', () => {
  for (const document of [cinematicDoc, mochi, marquee, jellytwin, index, lounge, latenight, kids, broadcast]) {
    const doc = resolveDocument(document, 1280);
    const a = { doc, env: { flags: [] } } as unknown as SkinHost;
    const b = { ...a, env: { ...a.env, flags: ['menu'] } };
    expect(sameRouteHost(a, b, [doc.routes.home, doc.libraryViews]), document.name).toBe(true);
  }
});
