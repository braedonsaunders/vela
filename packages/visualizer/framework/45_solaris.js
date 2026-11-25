
// ───────────────────────── Solaris Relic: a broken shell of obsidian plates standing off a small star ─────────────────────────
{
// The plates are Voronoi cells baked once into an octahedral texture (edge distance, cell id). The shell is
// drawn as a stack of five thin layers; the cracks are cut out with alpha-to-coverage, so you look straight
// through them at the star and at the lit inside of the far wall.
const SOL_BAKE = HEAD + LIB + `
in vec2 uv; out vec4 o;
void main(){ vec3 d = octDir(uv); vec3 c = cells(d*2.5+.3*vec3(noise(d*2.6), noise(d*2.6+5.3), noise(d*2.6+9.1))); o = vec4(c.y-c.x, c.z, c.x, 1.); }`;
const SOL_FN = `
uniform sampler2D uCells; uniform float uLayer;
const float THICK = .1;
vec2 plate(vec3 d){ vec2 q = octUV(d); return vec2(textureLod(uCells, q, 0.).r, texelFetch(uCells, ivec2(clamp(q, 0., .9999)*1024.), 0).g); }
float crackW(){ return .05+.035*uBassS+.03*uKick; }
float liftOf(float id){ float s = specS(.02+id*.78); return .04+.46*s*s+.1*uKick; }`;
const VS_SOL = VSH + SOL_FN + `
out vec3 vW, vD; out float vDepth, vId;
void main(){
  vec3 d = octDir(aUV); vec2 pl = plate(d);
  vD = d; vId = pl.y; vW = d*(1.+liftOf(pl.y)-uLayer*THICK);
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_SOL = FSH + SOL_FN + `
in vec3 vW, vD; in float vDepth, vId; out vec4 o;
void main(){
  vec3 d = normalize(vD); vec2 pl = plate(d); float edge = pl.x, id = pl.y, w = crackW();
  float fe = max(fwidth(edge), 1e-4), cover = smoothstep(w-fe, w+fe, edge);
  if (cover < .02) discard;
  float s = spec(.02+id*.78), rim = exp(-(edge-w)*34.);
  vec3 fire = neon(.08)*.7+.3, deep = neon(.0);
  vec3 col;
  if (uLayer < .01){
    // the outer face: polished obsidian, bevelled toward its edges, catching a cool key light and the star's glow at the rim
    vec3 n = d, v = normalize(uEye-vW);
    vec3 px = dFdx(vW), py = dFdy(vW); float hb = smoothstep(w, w+.14, edge), hx = dFdx(hb), hy = dFdy(hb);
    vec3 r1 = cross(py, n), r2 = cross(n, px); float det = dot(px, r1);
    n = normalize(n*abs(det)-.07*sign(det)*(hx*r1+hy*r2));
    vec3 L = normalize(vec3(-.55,.5,.67)); float ndl = max(dot(n,L),0.), fr = pow(1.-max(dot(n,v),0.), 3.);
    float grain = noise(d*38.)*noise(d*90.);
    col = vec3(.012,.012,.016)*(.4+2.2*ndl)*(.6+1.2*grain) + vivid(.62)*(pow(max(dot(reflect(-L,n),v),0.), 30.)*.5*ndl+fr*.07);
    col += mix(deep, fire, rim)*rim*(.06+.9*s*s+.5*uKick);                        // the edges glow with the plate's band
  } else {
    // the layers underneath make the plate's sides and its underside, lit hot by the star
    col = mix(deep, fire, uLayer*uLayer)*(.03+.3*uLayer*uLayer)*(.35+1.6*s*s+.8*uBass+.9*uKick)*(.5+.5*rim);
  }
  o = vec4(col, cover);
}`;
const VS_SOL_STAR = VSH + `out vec3 vD; void main(){ vD = octDir(aUV); gl_Position = uVP*vec4(vD*(.56+.03*uBassS+.03*uKick), 1.); }`;
const FS_SOL_STAR = FSH + `
in vec3 vD; out vec4 o;
void main(){ vec3 d = normalize(vD), v = normalize(uEye-d*.56);
  vec3 q = d*5.+vec3(0.,uTime*.12,0.); float g = noise(q+noise(q*2.+uTime*.2)*1.2)*.6+noise(q*3.1-uTime*.15)*.4;   // boiling granules
  float limb = pow(1.-max(dot(d,v),0.), 2.);
  vec3 col = mix(neon(.0), neon(.08)*.6+.4, smoothstep(.25,.75,g))*(.7+1.5*g*g)*(.7+1.1*uBass+1.6*uKick) + (neon(.08)*.5+.5)*limb*.9;
  o = vec4(col, 1.); }`;
const VS_SOL_RING = VSH + `
uniform mat3 uTilt; out vec2 vP; out vec3 vW;
void main(){ float a = aUV.x*TAU, r = mix(1.9, 3.05, aUV.y); vP = aUV; vW = uTilt*vec3(cos(a)*r, 0., sin(a)*r); gl_Position = uVP*vec4(vW, 1.); }`;
const FS_SOL_RING = FSH + `
in vec2 vP; in vec3 vW; out vec4 o;
void main(){
  float u = vP.x, v = vP.y, s = spec(.03+v*.8), sS = specS(.03+v*.8);
  // streaks drawn round the ring: each radius is a band, and the inner ones turn faster
  float a = u*TAU, sp = uTime*(.5-.3*v);
  float st = noise(vec3(cos(a-sp)*7., sin(a-sp)*7., v*26.))*.6+noise(vec3(cos(a-sp*1.4)*19., sin(a-sp*1.4)*19., v*60.))*.4;
  float prof = smoothstep(0.,.12,v)*smoothstep(1.,.45,v);
  float pulse = ring(v, .5, .09, 1.8);                                              // each kick: a wave runs out through the ring
  vec3 col = mix(neon(.08), neon(.0), v)*pow(st, 3.)*prof*(.03+.55*sS*sS+.35*s*s+.8*pulse) + neon(.0)*prof*pulse*.05;
  o = vec4(col, 1.); }`;
const FS_SOL_BG = FSH + `
out vec4 o;
void main(){ vec3 rd = viewRay(); vec3 col = vec3(.0015,.002,.005) + vivid(.62)*.012*fbm(rd*2.3+3.) + stars(rd)*.8;
  float tca = -dot(uEye, rd), b = length(cross(uEye, rd));
  if (tca > 0.) col += (neon(.08)*.6+neon(.0)*.4)*exp(-max(b-1.1,0.)*5.5)*(.05+.12*uBassS+.16*uKick);   // light leaking round the shell
  o = vec4(col, 1.); }`;
scene({ id: 'solaris', name: 'Solaris Relic', from: 'Neon', kind: 'sphere', group: 'refined', pal: 0,
  about: 'A broken shell of obsidian plates standing off a small star: each plate lifts with its band, and the light pours out through the gaps',
  inputs: ['specS', 'spec', 'bassS', 'bass', 'kick', 'pulse'],
  cost: 'Moderate: the shell is five layers of a 256 grid (650k triangles) with alpha-to-coverage. Phones: three layers of a 128 grid.',
  post: { bloom: 0.6, thr: 0.9, knee: 0.7, spread: 0.74, ca: 0.6 },
  init() { this.bg = program(VS, FS_SOL_BG); this.shell = program(VS_SOL, FS_SOL); this.star = program(VS_SOL_STAR, FS_SOL_STAR); this.ring = program(VS_SOL_RING, FS_SOL_RING);
    this.cells = target(1024, 1024, HDR ? gl.RGBA16F : gl.RGBA8); draw(program(VS, SOL_BAKE), this.cells, 1024, 1024);
    const a = 0.34, b = 0.3, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    this.tilt = [cb, sb, 0, -sb * ca, cb * ca, sa, sb * sa, -cb * sa, ca]; },
  draw(F, out) {
    const t = F.time, c = camera(orbit(t * 0.085, 0.2 + Math.sin(t * 0.055) * 0.2, 5.3 - A.bassS * 0.12), [0, 0, 0], 0.72, 0, 0.1, 80);
    const set = u => { F.set(u); setCam(u, c); bindTex(3, this.cells.t); gl.uniform1i(u.uCells, 3); };
    beginMS(); quad(this.bg, set);
    gl.enable(gl.DEPTH_TEST); mesh(this.star, grid(64), set);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    for (let l = 0; l < 5; l++) mesh(this.shell, grid(256), u => { set(u); gl.uniform1f(u.uLayer, l / 4); });
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    mesh(this.ring, grid(128), u => { set(u); gl.uniformMatrix3fv(u.uTilt, false, this.tilt); });
    endMS(out);
  } });
}
