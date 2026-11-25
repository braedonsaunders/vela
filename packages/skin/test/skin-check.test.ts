import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { analyzeDocument, analyzeLoadedDocument } from '../../../tools/skin-check';
import type { ScreenDocument } from '../../protocol/screen';
import type { SkinDocument } from '../../protocol/skin';

const root = resolve(import.meta.dir, '../../..');

describe('skin-check JSON report (analyzeDocument / analyzeLoadedDocument)', () => {
  test('produces a complete JSON report for a valid screen document (news/index)', async () => {
    const report = await analyzeDocument(join(root, 'packages/protocol/fixtures/screens/news/index.json'));
    expect(report.ok).toBe(true);
    expect(report.kind).toBe('screen');
    expect(report.id).toBe('news/index');
    expect(report.screen).toBe('news');
    expect(report.page).toBe('index');
    expect(report.presentation).toBe('section');
    expect(report.schema.valid).toBe(true);
    expect(report.schema.schema).toBe(1);
    expect(report.schema.renderer).toBe(19);
    expect(report.limits.valid).toBe(true);
    expect(report.limits.bytes).toBeGreaterThan(100);
    expect(report.limits.nodes).toBe(38);
    expect(report.literalColours.valid).toBe(true);
    expect(report.literalColours.refused).toEqual([]);
    expect(report.tokens.valid).toBe(true);
    expect(report.tokens.uiUsed).toContain('radiusCard');
    expect(report.icons.valid).toBe(true);
    expect(report.icons.used).toContain('bell');
    expect(report.actions.valid).toBe(true);
    expect(report.actions.declared).toEqual(['follow-topic']);
    expect(report.actions.used).toEqual(['navigate', 'plugin']);
    expect(report.actions.pluginUsed).toEqual(['follow-topic']);
    expect(report.slots.valid).toBe(true);
    expect(report.slots.presentationSlot).toBe('section');
    expect(report.budgets.valid).toBe(true);
    expect(report.budgets.viewports).toHaveLength(3);
    expect(report.errors).toEqual([]);
  });

  test('produces a complete JSON report for a valid skin document (cinematic.ts)', async () => {
    const report = await analyzeDocument(join(root, 'packages/protocol/fixtures/skins/cinematic.ts'));
    expect(report.ok).toBe(true);
    expect(report.kind).toBe('skin');
    expect(report.id).toBe('cinematic-doc');
    expect(report.schema.valid).toBe(true);
    expect(report.limits.valid).toBe(true);
    expect(report.literalColours.swatches).toHaveLength(5);
    expect(report.tokens.uiDeclared).toContain('accent');
    expect(report.budgets.valid).toBe(true);
    expect(report.budgets.viewports.map(v => v.viewport)).toEqual(['desktop', 'phone', 'tv']);
  });

  test('reports refused literal colours, unknown tokens, unknown icons, undeclared actions, and budget violations', async () => {
    const badDoc: ScreenDocument = {
      schema: 1,
      kind: 'screen',
      renderer: 19,
      screen: 'test',
      page: 'bad',
      version: '1.0.0',
      title: 'Bad',
      presentation: 'page',
      sources: {},
      actions: { declaredAction: {} },
      palette: { badColour: 'not-a-colour' },
      tree: {
        type: 'box',
        style: {
          color: '#ff3366',
          'background-color': '$unknownToken',
          'border-color': '$ui.nonExistentUi',
          position: 'fixed',
        },
        press: {
          action: 'plugin',
          args: { name: 'undeclaredAction' },
        },
        children: [
          { type: 'icon', symbol: 'not-an-icon-symbol' },
        ],
      },
    };

    const report = await analyzeLoadedDocument(badDoc);
    expect(report.ok).toBe(false);
    expect(report.literalColours.valid).toBe(false);
    expect(report.literalColours.refused).toEqual([{ at: 'tree.style.color', colour: '#ff3366' }]);
    expect(report.tokens.valid).toBe(false);
    expect(report.tokens.unknown).toContain('$unknownToken');
    expect(report.tokens.unknown).toContain('$ui.nonExistentUi');
    expect(report.icons.valid).toBe(false);
    expect(report.icons.unknown).toContain('not-an-icon-symbol');
    expect(report.actions.valid).toBe(false);
    expect(report.actions.undeclaredPlugin).toEqual(['undeclaredAction']);
    expect(report.budgets.portability.some(p => p.row === 'position' && p.level === 'error')).toBe(true);
  });

  test('supports built-in vela experience documents, velaUseProblems, and skin experience overrides', async () => {
    const velaDoc: ScreenDocument = {
      schema: 1,
      kind: 'screen',
      owner: 'vela',
      experience: 'listen',
      renderer: 20,
      screen: 'listen',
      page: 'index',
      version: '1.0.0',
      title: 'Listen',
      presentation: 'section',
      sources: {
        now: { from: 'vela.nowPlaying' },
      },
      tree: {
        type: 'box',
        style: { color: '$ui.ink' },
        press: { action: 'plugin', args: { name: 'vela.play' } },
        children: [{ type: 'text', text: 'Listen' }],
      },
    };

    const screenReport = await analyzeLoadedDocument(velaDoc);
    expect(screenReport.ok).toBe(true);
    expect(screenReport.owner).toBe('vela');
    expect(screenReport.experience).toBe('listen');
    expect(screenReport.actions.velaUseErrors).toEqual([]);

    // Plugin document (no owner) trying to press vela.play or pass literal to vela.title is refused by velaUseProblems
    const illegalPluginDoc: ScreenDocument = {
      schema: 1,
      kind: 'screen',
      renderer: 20,
      screen: 'rogue',
      page: 'index',
      version: '1.0.0',
      title: 'Rogue',
      presentation: 'section',
      sources: {
        stolen: { from: 'vela.title', id: 'literal-id' },
      },
      tree: {
        type: 'box',
        press: { action: 'plugin', args: { name: 'vela.play' } },
      },
    };

    const rogueReport = await analyzeLoadedDocument(illegalPluginDoc);
    expect(rogueReport.ok).toBe(false);
    expect(rogueReport.actions.velaUseErrors).toContain('source stolen (vela.title) argument id is not a {context.*} hole');
    expect(rogueReport.actions.velaUseErrors).toContain('a plugin document cannot press the local action vela.play');

    // Skin document with an override of a non-existent built-in page reports checkExperienceOverrides findings
    const skinWithExperiences: SkinDocument = {
      schema: 1,
      renderer: 20,
      id: 'exp-skin',
      name: 'Exp Skin',
      version: '1.0.0',
      swatches: ['#000000'],
      experiences: {
        listen: {
          pages: {
            nonExistentPage: {
              type: 'box',
              style: { color: '$ui.accent' },
            },
          },
        },
      },
    };

    const skinReport = await analyzeLoadedDocument(skinWithExperiences);
    expect(skinReport.slots.experiences).toEqual(['listen/nonExistentPage']);
    expect(skinReport.tokens.uiUsed).toContain('accent');
    expect(skinReport.slots.experienceOverrides?.some(f => f.page === 'nonExistentPage' && f.level === 'error')).toBe(true);
  });
});
