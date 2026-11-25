// bun packages/visualizer/tools/build-web.ts [--check]
// The browser compiles this ordinary ES module with the rest of the application. Scene programs and
// per-frame logic come from the same source as the native host. No runtime source evaluation or fetch.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const scenes = join(root, 'scenes');
const destination = join(root, 'web/renderer.js');
const parts = readdirSync(scenes).filter(name => /^\d\d_.*\.js$/.test(name) && name !== '11_synth.js' && name !== '95_ui.js').sort();
const output = [
  '// Generated from packages/visualizer/scenes by tools/build-web.ts.',
  "import { frameBudget } from './frame-budget';",
  "import { webPrograms } from './programs';",
  'export function createRenderer(canvas, gl, stage) {',
  'let innerWidth = stage.width, innerHeight = stage.height;',
  'const renderModes = () => {};',
];

function replace(source: string, from: string, to: string): string {
  if (!source.includes(from)) throw new Error('Framework changed near ' + from);
  return source.replace(from, () => to);
}
// Interpolate the desktop compiler variant into a GLSL string, retaining the authors' original
// shader text on constrained displays and in the 30 FPS background.
function desktopShader(source: string, authored: string, desktop: string, condition = 'desktopLoops'): string {
  return replace(source, authored, '${' + condition + ' ? ' + JSON.stringify(desktop) + ' : ' + JSON.stringify(authored) + '}');
}
for (const name of parts) {
  let code = readFileSync(join(scenes, name), 'utf8');
  if (name === '10_audio.js') {
    // The app owns the audio context. Omit the standalone player's transport, demo and microphone.
    const from = code.indexOf('function audioInit()'), until = code.indexOf('// One-pole follower');
    if (from < 0 || until <= from) throw new Error('Audio framework boundaries changed');
    code = code.slice(0, from) + code.slice(until);
    code = replace(code, "const QS = new URLSearchParams(location.search), MUTED = QS.has('mute');", '');
    code = replace(code, '  A.analyser.getFloatFrequencyData(A.freq);', '');
    code = replace(code, '  A.analyser.getFloatTimeDomainData(A.time);', '');
    if (code.includes('function analyseHits(')) code = replace(code, '  A.fast.getFloatFrequencyData(A.fastF);', '');
  }
  if (name === '20_gl.js') {
    const start = code.indexOf('const HDR =');
    if (start < 0) throw new Error('WebGL framework header changed');
    code = code.slice(start);
    code = replace(code, 'const LIB = `', "const desktopLoops = !stage.constrained && (stage.sceneId === 'sea' || stage.sceneId === 'aurora');\nconst LIB = `${desktopLoops ? 'uniform ivec2 uNoisePulseCounts;' : ''}");
    code = desktopShader(code, 'i < 8; i++){ float a = uPulse', 'i < uNoisePulseCounts.y; i++){ float a = uPulse');
    code = desktopShader(code, 'i < 4; i++){ s += a*noise', 'i < uNoisePulseCounts.x; i++){ s += a*noise', "desktopLoops && stage.sceneId === 'sea'");
    const compiler = code.indexOf('function compile('), post = code.indexOf('const POST =');
    if (compiler < 0 || post <= compiler) throw new Error('WebGL program setup changed');
    code = code.slice(0, compiler) + 'const program = webPrograms(gl);\n' + code.slice(post);
    code = replace(code, 'DPR = Math.min(window.devicePixelRatio || 1, 2);', 'DPR = 1;');
    // Query the selected format, since MAX_SAMPLES alone can exceed its supported sample count.
    code = replace(code, 'const SAMPLES = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));',
      `const colorSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, HDR ? gl.RGBA16F : gl.RGBA8, gl.SAMPLES);
const depthSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES);
const SAMPLES = Array.from(colorSamples).find(n => n <= (stage.constrained ? 2 : 4) && depthSamples.includes(n)) || 0;`);
    code = replace(code, 'Math.min(1, Math.sqrt(BUDGET * budgetScale / (w * h)))', 'Math.sqrt(budgetScale)');
    code = replace(code, 'const int N = 32;', 'const int N = ${stage.constrained ? 12 : 32};');
    for (const result of ['{ t, f, w, h }', '{ f, c, d, w, h }']) {
      code = replace(code, '  return ' + result + ';', "  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Unsupported visualizer framebuffer');\n  return " + result + ';');
    }
  }
  if (name === '25_helpers.js') code = replace(code, 'n = o.iters || 18', "n = stage.constrained && stage.sceneId === 'incense' ? 10 : (o.iters || 18)");
  // ANGLE can unroll and inline the nested noise functions into hundreds of milliseconds of
  // cold shader compilation. Supply the author's exact counts as uniforms to keep the loops.
  if (name === '34_sea.js') {
    code = desktopShader(code, 'const vec3 WV[7]', 'uniform ivec2 uSeaLayers;\nconst vec3 WV[7]');
    code = desktopShader(code, 'i < 7; i++', 'i < uSeaLayers.x; i++');
    code = desktopShader(code, 'i < 3; i++', 'i < uSeaLayers.y; i++');
    code = replace(code, 'F.set(u); setCam(u, c);', 'F.set(u); setCam(u, c); if (desktopLoops) gl.uniform2i(u.uSeaLayers, 7, 3);');
  }
  if (name === '53_aurora.js') {
    code = desktopShader(code, 'uniform float uYaw;', 'uniform float uYaw; uniform ivec3 uAuroraLayers;');
    code = desktopShader(code, 's < 14; s++', 's < uAuroraLayers.x; s++');
    code = desktopShader(code, 'i < 4; i++', 'i < uAuroraLayers.y; i++');
    code = desktopShader(code, 'col = (sky(qm, .5)*.6+sky(qm+vec2(0.,.03), .5)*.25+sky(qm+vec2(0.,.07), .5)*.15);',
      'const vec3 offsets=vec3(0.,.03,.07), weights=vec3(.6,.25,.15); col=vec3(0.);\n    for (int i=0; i<uAuroraLayers.z; i++) col+=sky(qm+vec2(0.,offsets[i]),.5)*weights[i];');
    code = replace(code, 'gl.uniform2f(u.uRes, lo.w, lo.h);', 'if (desktopLoops) gl.uniform3i(u.uAuroraLayers, 14, 4, 3); gl.uniform2f(u.uRes, lo.w, lo.h);');
    code = replace(code, 'gl.uniform1f(u.uYaw, yaw); bindTex(3, lo.t);', 'if (desktopLoops) gl.uniform3i(u.uAuroraLayers, 14, 4, 3); gl.uniform1f(u.uYaw, yaw); bindTex(3, lo.t);');
  }
  if (name === '50_silk.js') code = replace(code, 'SILK_W = 2048, SILK_H = 1024', 'SILK_W = stage.constrained ? 512 : 2048, SILK_H = stage.constrained ? 256 : 1024');
  if (name === '62_incense.js') {
    for (const [suffix, value] of [['W', 256], ['H', 160], ['DW', 1024], ['DH', 640]] as const)
      code = replace(code, 'SMK_' + suffix + ' = ' + value, 'SMK_' + suffix + ' = stage.constrained ? ' + value / 2 + ' : ' + value);
  }
  if (code.includes("scene({ id: 'wheat'")) code = replace(code, 'WHEAT_N = 72000', 'WHEAT_N = stage.constrained ? 18000 : 72000');
  if (name === '90_engine.js') {
    code = replace(code, 'gl.uniform1f(u.uTime, time);', 'if (desktopLoops) gl.uniform2i(u.uNoisePulseCounts, 4, 8);\n      gl.uniform1f(u.uTime, time);');
    code = replace(code, "addEventListener('resize', resize); resize();", 'resize();');
    code = replace(code, "QS.has('perf')", 'stage.measure');
  }
  output.push('// ' + name, code);
}
output.push(readFileSync(join(root, 'web/host.inc.js'), 'utf8'), '}\n');
const text = output.join('\n').replace(/[ \t]+$/gm, '');
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== text) throw new Error('Regenerate the web visualizer with bun packages/visualizer/tools/build-web.ts');
} else writeFileSync(destination, text);
