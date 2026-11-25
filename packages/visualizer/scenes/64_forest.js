
// ───────────────────────── Deep Forest: tall trees in backlight, wind running through the canopy with the music ─────────────────────────
{
// Real geometry, drawn with 4× MSAA and depth of field: 72 trunks (tapered, flared at the root, leaning),
// three limbs on each, 10,000 foliage cards gathered into crowns and understory, shafts of sun standing
// between the trunks, and pollen. The wind is the low end: each low onset sends a gust back through the wood.
// Every crown listens to a band of its own and glows with it; the shafts are bands too; highs set the leaves
// trembling and the pollen sparkling.
const FOR_TREES = 72, FOR_CARDS = 130, FOR_FERNS = 1400, FOR_SHAFTS = 24, FOR_POLLEN = 2600;
const FOREST_FN = `
const vec3 FSUN = vec3(.3145, .6093, .7279);               // toward the sun: ahead, above, a little to the right
vec3 fsunC(){ return mix(vec3(1.,.86,.55), neon(.1), .08)*(.7+.35*uDyn+.3*uBassS+.1*uHitS.x); }
vec3 fogC(vec3 v){ float s = pow(max(dot(v, FSUN), 0.), 3.); return mix(vec3(.016,.03,.024), vec3(.3,.38,.22), .08+.92*s)*(.55+.35*uDyn)+fsunC()*s*s*.4; }
// tree i: where it stands, how thick, how tall, how it leans
void tree(float i, out vec3 base, out float rad, out float ht, out vec2 lean){
  uint id = uint(i)*7u+11u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), h4 = hashu(id+3u), h5 = hashu(id+4u);
  float z = 3.+pow(h1, 1.25)*66., side = h2 < .5 ? -1. : 1.;
  base = vec3(side*(1.8+pow(h3, 1.4)*(7.+z*.22))+sin(z*.13)*1.2, 0., z);        // either side of a path that winds a little
  rad = .2+.42*h4*h4+.12*step(.9, h5); ht = 15.+11.*h5+rad*8.;
  lean = (vec2(hashu(id+5u), hashu(id+6u))-.5)*1.8; }
vec3 trunkAt(vec3 base, vec2 lean, float y, float ht){ float t = y/ht; return base+vec3(lean.x*t*t, y, lean.y*t*t); }
// the wind at p: a steady breath with the low end, and each beat's gust running back through the wood (four seconds, front to back)
float gustAt(vec3 p){ return .2+.95*hist(.03+.05*noise(vec3(p.x*.1, 0., 2.)), clamp((p.z-2.)/75., 0., 1.))+.3*uBassS; }`;
const VS_TRUNK = VSP + FOREST_FN + `
out vec3 vW, vN; out vec2 vBark; out float vDepth;
void main(){
  vec3 base; float rad, ht; vec2 lean; tree(float(gl_InstanceID), base, rad, ht, lean);
  int q = gl_VertexID/6, k = gl_VertexID%6; ivec2 c = ivec2(q%10+((k == 1 || k == 2 || k == 4) ? 1 : 0), q/10+((k == 2 || k == 4 || k == 5) ? 1 : 0));
  float t = float(c.y)/9., y = (t*t*.9+t*.1)*ht, a = float(c.x)/10.*TAU;                          // rings crowd toward the root
  float r = rad*(1.-.55*t)*(1.+.9*exp(-y*1.6)*(1.+.35*sin(a*3.+base.x*5.)))*(1.+.06*sin(a*2.+y*.7));   // taper, root flare, a little out of round
  vec3 ctr = trunkAt(base, lean, y, ht); ctr.xz += vec2(.75, .3)*gustAt(base)*t*t*.22;
  vN = vec3(cos(a), 0., sin(a)); vW = ctr+vN*r; vBark = vec2(a*rad*5.+base.x, y);
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const VS_LIMB = VSP + FOREST_FN + `
out vec3 vW, vN; out vec2 vBark; out float vDepth;
void main(){
  float ti = float(gl_InstanceID/3); uint id = uint(gl_InstanceID)*4u+101u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u);
  vec3 base; float rad, ht; vec2 lean; tree(ti, base, rad, ht, lean);
  int q = gl_VertexID/6, k = gl_VertexID%6; ivec2 c = ivec2(q%6+((k == 1 || k == 2 || k == 4) ? 1 : 0), q/6+((k == 2 || k == 4 || k == 5) ? 1 : 0));
  float t = float(c.y)/4., a = float(c.x)/6.*TAU, y0 = ht*(.42+.3*h1), az = h2*TAU, len = 3.+4.*h3+rad*5.;
  vec3 ax = normalize(vec3(cos(az), .55+.3*h3, sin(az))), s0 = trunkAt(base, lean, y0, ht);
  vec3 ctr = s0+ax*len*t+vec3(0., -.6*t*t, 0.); ctr.xz += vec2(.75, .3)*gustAt(base)*(y0/ht)*(y0/ht)*.22+vec2(.75,.3)*gustAt(ctr)*t*.12;
  vec3 u = normalize(cross(ax, vec3(0., 1., .01))), w = cross(ax, u); vN = u*cos(a)+w*sin(a);
  vW = ctr+vN*rad*.34*(1.-.75*t); vBark = vec2(a*rad*2.+h1*9., t*len);
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_BARK = FSH + FOREST_FN + `
in vec3 vW, vN; in vec2 vBark; in float vDepth; out vec4 o;
void main(){
  float b = noise(vec3(vBark.x*1.3, vBark.y*.3, 1.))*.6+noise(vec3(vBark.x*4.1, vBark.y*1.1, 5.))*.4, ridge = smoothstep(.36,.62,b);   // long furrows
  vec3 n = normalize(vN), v = normalize(uEye-vW), sc = fsunC();
  float fine = noise(vec3(vBark*vec2(11., 2.6), 2.)), crack = smoothstep(.5, .3, b)*smoothstep(.35, .6, noise(vec3(vBark.x*2.6, vBark.y*.5, 8.)));
  vec3 bark = mix(vec3(.012,.01,.008), vec3(.3,.21,.13), ridge)*(.45+.9*fine)*(1.-.7*crack);
  float moss = smoothstep(.5,.75, noise(vec3(vW.x*.8, vW.y*.45, vW.z*.8)))*smoothstep(5., .3, vW.y);
  bark = mix(bark, vec3(.06,.13,.03)*(.5+.9*ridge), moss*.85);
  float lit = max(dot(n, FSUN), 0.), rim = pow(1.-max(dot(n, v), 0.), 3.)*smoothstep(-.6, .5, dot(n, FSUN));      // the sun is behind them: it catches their edges
  vec3 col = bark*(vec3(.05,.085,.06)+sc*lit*1.5)*(.55+.6*ridge)+sc*(bark*6.+.04)*rim*(.5+.5*ridge);
  col *= .5+.5*smoothstep(0., 2.5, vW.y);
  float dist = length(vW-uEye); col = mix(col, fogC(-v), 1.-exp(-dist*.022));
  o = vec4(col, vDepth);
}`;
// Foliage: each card is a spray of small pointed leaves. uMode 0: gathered into the crowns; 1: ferns and seedlings on the floor.
const VS_FOLIAGE = VSP + FOREST_FN + `
uniform float uMode; out vec2 vUV; out vec3 vW; out vec4 vI; out float vDepth;
void main(){
  uint id = uint(gl_InstanceID)*6u+3u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), h4 = hashu(id+3u), h5 = hashu(id+4u), h6 = hashu(id+5u);
  vec3 ctr; float sz, lit, inner, band, wsc;
  if (uMode < .5){
    float ti = float(gl_InstanceID/${FOR_CARDS}); vec3 base; float rad, ht; vec2 lean; tree(ti, base, rad, ht, lean);
    float cr = 3.+rad*6., low = step(.7, h5), yc = mix(ht*(.55+.4*h4), ht*(.22+.3*h4), low), cz = h2*2.-1., sr = sqrt(1.-cz*cz);
    vec3 dirc = vec3(cos(h1*TAU)*sr, cz*.75+.12, sin(h1*TAU)*sr); inner = mix(pow(h3, .45), .5+.4*h3, low);   // most of them out in the shell of the crown
    ctr = trunkAt(base, lean, yc, ht)+dirc*cr*inner*vec3(1., .6, 1.);
    sz = 1.3+1.3*h6; lit = smoothstep(-.5, .8, dot(normalize(dirc), FSUN)); band = fract(ti*.618+.07); wsc = .5+yc/ht;
  } else {
    float z = 2.+pow(h1, 1.4)*40., side = h2 < .5 ? -1. : 1.;
    ctr = vec3(side*(1.+h3*h3*(6.+z*.2))+sin(z*.13)*1.2, .25+.5*h4, z); inner = .6+.4*h4;
    sz = .55+.75*h6; lit = .05+.5*h5*h5; band = h5; wsc = .35;
  }
  float g = gustAt(ctr), sway = g*(.1+.1*h4)*wsc;
  ctr.xz += vec2(.75, .3)*sway+vec2(sin(uTime*1.7+h1*40.), cos(uTime*1.3+h2*40.))*.02*(1.+4.*uBandE.z+3.*uHitS.z); ctr.y -= sway*.22;
  float a1 = h1*TAU+sin(uTime*(1.6+2.*h4)+h2*30.)*.16*(.4+g+2.*uHitS.z), a2 = h6*TAU;                      // the cards tremble; the highs set them off
  vec3 u = normalize(vec3(cos(a1), .35*sin(a2*3.), sin(a1))), up = normalize(vec3(sin(a2)*.7, 1., cos(a2)*.7)), w = normalize(cross(u, up));
  vec2 q = vec2(float(gl_VertexID == 1 || gl_VertexID == 2 || gl_VertexID == 4), float(gl_VertexID == 2 || gl_VertexID == 4 || gl_VertexID == 5));
  sz *= smoothstep(2.2, 5.5, length(ctr-uEye));                                 // nothing hangs right in front of the lens
  vW = ctr+(u*(q.x-.5)+w*(q.y-.5))*sz; vUV = q; vI = vec4(h3*31.+h5*7., lit, inner, band);
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_FOLIAGE = FSH + FOREST_FN + `
in vec2 vUV; in vec3 vW; in vec4 vI; in float vDepth; out vec4 o;
void main(){
  vec2 g = vUV*5., c = floor(g); float m = 0., tone = 0.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 cc = c+vec2(float(i), float(j)); if (cc.x < 0. || cc.x > 4. || cc.y < 0. || cc.y > 4.) continue;
    float h = hash2(cc+vI.x); vec2 l = rot(h*TAU)*(g-cc-.5-(vec2(hash2(cc+vI.x+3.), hash2(cc+vI.x+5.))-.5)*.55);
    float leaf = length(vec2(l.x*2.6, l.y))-.47+.3*abs(l.y);                                              // a pointed oval
    if (leaf < 0. && h > .3){ m = 1.; tone = h+.35*smoothstep(.0, .06, abs(l.x)); } }
  if (m < .5) discard;
  vec3 v = normalize(vW-uEye), sc = fsunC(); float toSun = pow(max(dot(v, FSUN), 0.), 2.), bandv = spec(.04+vI.w*.78), bs = specS(.04+vI.w*.78);
  vec3 dark = mix(vec3(.006,.02,.008), vec3(.05,.13,.03), vI.y)*(.35+.8*vI.z)*(.6+.6*tone);            // leaf seen by reflected light
  vec3 glowc = mix(vec3(.3,.55,.07), vec3(.8,.78,.18), tone*.6)*sc*(.06+1.3*toSun)*(.15+.85*vI.z)*vI.y;        // and by the sun coming through it
  vec3 col = dark*(.8+.6*uMidS)+glowc*(.3+1.6*bs*bs+.45*max(bandv-bs, 0.)+.3*uHitS.y*vI.y);           // each crown glows with its own band
  float dist = length(vW-uEye); col = mix(col, fogC(v), 1.-exp(-dist*.022));
  o = vec4(col, vDepth);
}`;
const FS_FOREST_BG = FSH + FOREST_FN + `
out vec4 o;
void main(){ vec3 rd = viewRay(); vec3 col = fogC(rd); float depth = 200.;
  col += fsunC()*exp(-acos(clamp(dot(rd, FSUN), -1., 1.))*3.2)*.5;                                          // the bright gap where the sun is
  if (rd.y < -.002){ float t = -uEye.y/rd.y; vec3 p = uEye+rd*t; depth = t;
    float litter = noise(vec3(p.xz*3.1, 1.))*.5+noise(vec3(p.xz*11., 4.))*.3+noise(vec3(p.xz*.6, 7.))*.2;
    float path = exp(-pow((p.x-sin(p.z*.13)*1.2)/1.1, 2.));
    vec3 g = mix(mix(vec3(.03,.045,.018), vec3(.09,.075,.035), litter), vec3(.13,.105,.06), path*.7)*(.6+.6*litter);
    // sun flecks that fall through the canopy and move with it
    float fl = smoothstep(.56,.72, noise(vec3(p.xz*.45+vec2(.75,.3)*gustAt(p)*.5, uTime*.05)))*smoothstep(.3,.7, noise(vec3(p.xz*1.6, 3.+uTime*.07)));
    g += fsunC()*g*fl*(4.+7.*spec(.1+.6*fract(p.z*.07)));
    col = mix(g*(.6+.5*uDyn), fogC(rd), 1.-exp(-t*.022)); }
  o = vec4(col, depth); }`;
// Shafts of sun standing between the trunks: thin sheets along the light, each one a band.
const VS_SHAFT = VSP + FOREST_FN + `
out vec3 vS; out float vBand;
void main(){ uint id = uint(gl_InstanceID)*4u+77u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), h4 = hashu(id+3u);
  vec3 foot = vec3((h1-.5)*(9.+18.*h2), 0., 5.+h2*42.);
  vec2 q = vec2(float(gl_VertexID == 1 || gl_VertexID == 2 || gl_VertexID == 4), float(gl_VertexID == 2 || gl_VertexID == 4 || gl_VertexID == 5));
  vec3 side = normalize(cross(FSUN, foot-uEye)), p = foot+FSUN*(q.y*24./FSUN.y)+side*(q.x-.5)*(.9+1.6*h3);
  vS = vec3(q, length(foot-uEye)); vBand = h4; gl_Position = uVP*vec4(p, 1.); }`;
const FS_SHAFT = FSH + FOREST_FN + `
in vec3 vS; in float vBand; out vec4 o;
void main(){ float x = vS.x*2.-1., prof = exp(-x*x*3.5)*smoothstep(0., .08, vS.y)*smoothstep(1., .55, vS.y);
  float dust = .55+.45*noise(vec3(vS.x*7.+vBand*30., vS.y*3.-uTime*.08, vBand*9.));
  float b = spec(.05+vBand*.8), bs = specS(.05+vBand*.8);
  o = vec4(fsunC()*prof*dust*(.035+.55*bs*bs+.25*max(b-bs, 0.)+.08*uHitS.x)*exp(-vS.z*.018), 0.); }`;
const VS_POLLEN = VSP + FOREST_FN + `
uniform float uDpr, uFocus, uWindT; out vec3 vCol;
void main(){ uint id = uint(gl_VertexID)*4u+9u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), h4 = hashu(id+3u);
  vec3 p = vec3(mod(h1*26.+uWindT*(.4+.5*h4), 26.)-13., .3+h2*9.+.3*sin(uTime*(.3+h4)+h3*20.), 1.+h3*30.);
  gl_Position = uVP*vec4(p, 1.); float d = max(gl_Position.w, .05), size = max(1.5, abs(d-uFocus)/d*8.)*uDpr; gl_PointSize = min(size, 26.);
  float edge = smoothstep(0., 2., 13.-abs(p.x)), tw = spec(.6+.38*h4);
  vCol = fsunC()*(.5+1.5*step(.9, h4))*(.12+2.6*tw*tw+.4*uHit.z+.9*uHitS.z)*edge*(2./(size*size))*(.6+.4*sin(uTime*(1.+h1*3.)+h2*40.))*exp(-d*.03); }`;
scene({ id: 'forest', name: 'Deep Forest', from: 'Organic', kind: 'nature', group: 'organic', pal: 3, hue: () => 0,
  about: 'Tall trees in backlight: each low onset sends a gust back through the wood, every crown glows with a band of its own, the shafts of sun between the trunks are bands too, and the highs set the leaves trembling and the pollen sparkling',
  inputs: ['hist', 'spec', 'specS', 'bandE', 'hit', 'hitS', 'dyn'],
  cost: 'Moderate: about 110k triangles with alpha-tested foliage under 4× MSAA, plus depth of field. Phones: half the foliage cards and no depth of field.',
  post: { dof: { ap: 5, max: 9 }, bloom: 0.5, thr: 0.95, knee: 0.7, spread: 0.72, exp: 1.05, ca: 0.3, vig: 0.75, pulse: 0.2 },
  init() { this.bg = program(VS, FS_FOREST_BG); this.trunk = program(VS_TRUNK, FS_BARK); this.limb = program(VS_LIMB, FS_BARK); this.fol = program(VS_FOLIAGE, FS_FOLIAGE);
    this.shaft = program(VS_SHAFT, FS_SHAFT); this.pollen = program(VS_POLLEN, FS_POINT); this.windT = 0; },
  draw(F, out) {
    const t = F.time; this.windT += F.dt * (0.3 + 1.2 * A.hitLvl[0] + 0.8 * A.hitSlow[0]);
    const eye = [Math.sin(t * 0.045) * 0.6, 1.75 + Math.sin(t * 0.03) * 0.08, Math.sin(t * 0.027) * 0.8];        // a slow, small drift; the wood does the moving
    const c = camera(eye, [eye[0] * 0.3 + Math.sin(t * 0.02) * 0.6, 6.2, 16], 1.02, 0, 0.1, 400), focus = 11;
    const set = u => { F.set(u); setCam(u, c); }, inst = (prog, verts, n, extra) => { gl.useProgram(prog.p); set(prog.u); extra && extra(prog.u); gl.drawArraysInstanced(gl.TRIANGLES, 0, verts, n); };
    F.focus = focus;
    beginMS(); quad(this.bg, set);
    gl.enable(gl.DEPTH_TEST);
    inst(this.trunk, 540, FOR_TREES); inst(this.limb, 144, FOR_TREES * 3);
    inst(this.fol, 6, FOR_TREES * FOR_CARDS, u => gl.uniform1f(u.uMode, 0)); inst(this.fol, 6, FOR_FERNS, u => gl.uniform1f(u.uMode, 1));
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.colorMask(true, true, true, false);   // light is added; the depth kept in alpha is left alone
    inst(this.shaft, 6, FOR_SHAFTS);
    points(this.pollen, FOR_POLLEN, u => { set(u); gl.uniform1f(u.uDpr, F.px); gl.uniform1f(u.uFocus, focus); gl.uniform1f(u.uWindT, this.windT % 100000); });
    endMS(out);
  } });
}
