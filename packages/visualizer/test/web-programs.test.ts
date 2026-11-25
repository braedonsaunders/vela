import { expect, test } from 'bun:test';
import { webPrograms } from '../web/programs';

test('the web host submits all links before reading their uniforms and reuses shared shaders', () => {
  const events: string[] = [];
  const location = {};
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, LINK_STATUS: 3, ACTIVE_UNIFORMS: 4,
    createShader: () => ({}), createProgram: () => ({}), attachShader() {}, compileShader() {},
    shaderSource: (_shader: unknown, source: string) => events.push('compile ' + source),
    linkProgram: () => events.push('link'), flush() {},
    getProgramParameter: (_program: unknown, which: number) => {
      events.push('read'); return which === 3 ? true : 1;
    },
    getActiveUniform: () => ({ name: 'uColors[0]' }), getUniformLocation: () => location,
  };
  const program = webPrograms(gl as unknown as WebGL2RenderingContext);
  const first = program('vertex', 'forest');
  const second = program('vertex', 'map');
  expect(events).toEqual(['compile vertex', 'compile forest', 'link', 'compile map', 'link']);
  expect(first.u.uColors).toBe(location);
  expect(first.u.uUnused).toBeNull();
  expect(first.u).toBe(first.u);
  expect(events.filter(e => e === 'read')).toHaveLength(2);
  expect(second.u.uColors).toBe(location);
  expect(events.filter(e => e === 'read')).toHaveLength(4);
});
