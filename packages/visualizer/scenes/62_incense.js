
// ───────────────────────── Incense: three sticks, three smokes, one for each part of the music ─────────────────────────
{
// Three incense sticks stand in a dark room. The left one is the bass, the middle one the mids, the right
// one the highs: each gives off smoke of its own colour as fast as its band is sounding, and puffs on its
// band's onsets. The smoke rises, spreads into a wide fan and lingers; kicks breathe across the room.
const SMK_W = 256, SMK_H = 160, SMK_DW = 1024, SMK_DH = 640;
const SMK_COMMON = `
in vec2 uv; out vec4 o; uniform sampler2D uVel, uDye; uniform float uDt, uAsp; uniform vec3 uTip[3]; uniform float uSide[8];
vec3 own(int i){ return vec3(float(i == 0), float(i == 1), float(i == 2)); }`;
const FS_SMK_FORCE = HEAD + LIB + SMK_COMMON + `
void main(){
  vec2 v = texture(uVel, uv).xy; vec3 sm = texture(uDye, uv).rgb; float den = dot(sm, vec3(1.));
  v.y += (sm.r*(.4+.9*uBandE.x)+sm.g*(.45+.8*uBandE.y)+sm.b*(.5+.8*uBandE.z))*uDt;      // each smoke rises faster while its own band sounds
  for (int i = 0; i < 3; i++){ vec2 d = (uv-uTip[i].xy)*vec2(uAsp, 1.);
    v += vec2(0., 1.)*exp(-dot(d,d)/.0004)*uDt*(3.5+3.*uBandE[i]+4.*uHitS[i]); }                 // the draught of each ember; an onset puffs it
  for (int i = 0; i < 8; i++){ float a = uPulse[i]; if (a > .9) continue;                        // each kick: a breath of air across the room, alternating sides
    float front = uv.y-.27-a*.95, gust = exp(-front*front/.043)*exp(-a*4.);
    v.x += uSide[i]*gust*uDt*1.6; }
  // higher up the columns lean apart, so the smoke opens into a wide fan and fills the room
  float height = smoothstep(.2,.8,uv.y);
  v.x += (tanh((uv.x-.5)*5.)*.2+sin(uv.y*11.-uTime*.2)*.1)*height*uDt*min(den, 1.);
  v.x += uDt*(sin(uv.y*15.+uTime*.2)*uHitS.z*.5+sin(uv.y*24.-uTime*.2)*uBandE.z*.15)*smoothstep(.2,.68,uv.y);   // highs set it trembling
  o = vec4(v, 0., 1.);
}`;
const FS_SMK_DYE = HEAD + LIB + SMK_COMMON + `
void main(){
  vec3 s = texture(uDye, uv).rgb*exp(-uDt*.07);                              // it lingers: about fifteen seconds
  for (int i = 0; i < 3; i++){ vec2 d = (uv-uTip[i].xy)*vec2(uAsp, 1.);
    s += own(i)*exp(-dot(d,d)/.00011)*uDt*(3.+16.*uBandE[i]*uBandE[i]+22.*uHit[i]); }             // quiet band: a thread; loud band: a column; an onset: a puff
  s *= 1.-uDt*2.*smoothstep(.93, 1., uv.y);
  o = vec4(min(s, vec3(3.)), 1.);
}`;
const FS_SMK = FSH + COVER + `
out vec4 o; uniform sampler2D uDye; uniform vec3 uTip[3]; const vec2 TX = 1./vec2(${SMK_DW}., ${SMK_DH}.);
void main(){
  vec2 sc = gl_FragCoord.xy/uRes, uv = cover(sc, 1.6), q = sc-.5, p = uv*vec2(1.6, 1.);
  vec3 s = texture(uDye, uv).rgb; float den = dot(s, vec3(1.));
  vec3 gx = texture(uDye, uv+vec2(TX.x*2.5,0.)).rgb-texture(uDye, uv-vec2(TX.x*2.5,0.)).rgb, gy = texture(uDye, uv+vec2(0.,TX.y*2.5)).rgb-texture(uDye, uv-vec2(0.,TX.y*2.5)).rgb;
  vec2 g = vec2(dot(gx, vec3(1.)), dot(gy, vec3(1.)));
  // a dark room: a little warm light low down, and one cool lamp off to the right
  vec3 col = vec3(.006,.005,.006)+vec3(.05,.03,.018)*exp(-pow((uv.y-.05)/.3, 2.))*(.4+.3*uBassS)*exp(-pow(q.x/.6, 2.));
  col += mix(vec3(.02,.03,.05), neon(.62)*.04, .4)*exp(-length((sc-vec2(.95,.75))*vec2(1.6,1.))*2.4);
  // three smokes, each its own colour, drifting slowly through the palette; where they meet they mix
  float hue = uTime*.012;
  vec3 c0 = mix(vec3(1.,.62,.36), neon(.08+hue), .45), c1 = mix(vec3(.55,.75,1.), neon(.42+hue), .45), c2 = mix(vec3(.72,1.,.78), neon(.75+hue), .45);
  vec3 tintc = (c0*s.r+c1*s.g+c2*s.b)/max(den, 1e-3);
  float a = 1.-exp(-den*2.), lit = clamp(.5-dot(g, normalize(vec2(1., .35)))*1.1, 0., 1.);        // lit from the right: every fold has a bright and a dark side
  vec3 glow = (c0*s.r*uHit.x+c1*s.g*uHit.y+c2*s.b*uHit.z)/max(den, 1e-3);                         // each smoke brightens on its own band's onsets
  vec3 smc = tintc*(.22+.75*lit)*(.55+.5*uLevelS)+glow*(.35+.4*lit);
  col = mix(col, smc, a*.9);
  // the sticks and their embers
  for (int i = 0; i < 3; i++){ vec2 tp = uTip[i].xy*vec2(1.6, 1.), base = tp+vec2(.1*(float(i)-1.)+.06, -.5), ab = base-tp, pa = p-tp; float h = clamp(dot(pa,ab)/dot(ab,ab), 0., 1.), ds = length(pa-ab*h);
    col = mix(col, vec3(.1,.065,.045)*(.5+2.5*exp(-h*10.)), smoothstep(.0035, .002, ds));
    float de = length(p-tp); vec3 ec = i == 0 ? c0 : (i == 1 ? c1 : c2);
    col += mix(vec3(1.,.42,.12), ec, .35)*(smoothstep(.007,.003,de)*(3.+7.*uBandE[i]+9.*uHit[i])+exp(-de*42.)*(.2+.5*uBandE[i]+.8*uHit[i])); }
  o = vec4(col*(1.-.6*dot(q,q)), 1.);
}`;
scene({ id: 'incense', name: 'Incense', from: 'Organic', kind: 'fluid', group: 'organic', pal: 0, hue: () => 0,
  about: 'Three incense sticks in a dark room, one each for bass, mids and highs: each gives off its own colour of smoke as fast as its band sounds and puffs on its onsets; the smokes rise, fan out, mix and slowly change colour',
  inputs: ['bandE', 'hit', 'hitS', 'bassS', 'levelS', 'pulse'],
  cost: 'Moderate: a 256×160 fluid solve (18 pressure iterations) and a 1024×640 smoke field. Phones: 128×80 with 10 iterations.',
  post: { bloom: 0.5, thr: 0.9, knee: 0.6, exp: 1.1, ca: 0.25, vig: 0.6, grain: 0.03, pulse: 0.2 },
  init() { this.force = program(VS, FS_SMK_FORCE); this.dye = program(VS, FS_SMK_DYE); this.show = program(VS, FS_SMK);
    this.fluid = new Fluid(SMK_W, SMK_H, SMK_DW, SMK_DH); this.side = new Float32Array(8); this.last = new Float32Array(8).fill(9); this.flip = 1;
    this.tips = new Float32Array([0.27, 0.15, 0, 0.5, 0.11, 0, 0.73, 0.16, 0]); },
  draw(F, out) {
    newPulses(this.last, i => { this.flip = -this.flip; this.side[i] = this.flip * (0.45 + 0.6 * Math.min(1, A.kickAmp / 3)); });
    const set = u => { F.set(u); gl.uniform3fv(u.uTip, this.tips); gl.uniform1fv(u.uSide, this.side); };
    this.fluid.step(F.dt, { force: this.force, dye: this.dye, set, keepV: 0.985, vort: 2.5 + 4 * A.hitLvl[2], iters: 18, wall: 0 });
    draw(this.show, out, T.sw, T.sh, u => { set(u); bindTex(3, this.fluid.d[0].t); gl.uniform1i(u.uDye, 3); });
  } });
}
