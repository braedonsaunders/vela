// The plugin screen JSON Schema (tools/screen-schema.ts) follows the protocol's types: the committed
// schema and its digest match what the types generate, NavigateAction is a definition, and every
// screen fixture validates (as Ether validates plugin documents).
import { expect, test } from 'bun:test';
import { drift, generateSchema, validate } from '../../../tools/screen-schema';
import { SCREEN_SCHEMA_DIGEST } from '../src/resolve/screen-schema-digest';

test('the committed schema and digest match the types, and the fixtures validate', async () => {
  expect(await drift()).toEqual([]);
  expect(SCREEN_SCHEMA_DIGEST).toMatch(/^[0-9a-f]{64}$/);
});

test('the schema defines NavigateAction and refuses what the language does not have', () => {
  const schema = generateSchema();
  const defs = schema.$defs as Record<string, unknown>;
  expect(defs.NavigateAction).toBeDefined();
  const doc = { schema: 1, kind: 'screen', renderer: 19, screen: 's', page: 'p', version: '1', title: 't', presentation: 'section', sources: {},
    tree: { type: 'box', style: { 'border-top': '1px solid red' }, children: [{ type: 'hologram' }] } };
  const problems = validate(schema, doc);
  expect(problems.some(p => p.includes('/tree/style/border-top'))).toBe(true);
  expect(validate(schema, { ...doc, tree: { type: 'text', text: '{s:x}', tv: { color: '$ui.ink' } } })).toEqual([]);
  expect(validate({ $ref: '#/$defs/NavigateAction' }, { action: 'navigate', args: { page: 'game', event: 'x' } }, '', schema)).toEqual([]);
});
