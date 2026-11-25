
// ───────────────────────── Incense: a thread of smoke rising from an ember, combed by the music ─────────────────────────
{
const SMK_W = 256, SMK_H = 160, SMK_DW = 1024, SMK_DH = 640;
const SMK_COMMON = `
in vec2 uv; out vec4 o; uniform sampler2D uVel, uDye; uniform float uDt, uAsp; uniform vec3 uTip; uniform float uSide[8];`;
const FS_SMK_FORCE = HEAD + LIB + SMK_COMMON + `
void main(){
  vec2 v = texture(uVel, uv).xy; float den = texture(uDye, uv).r;
  v.y += den*(.45+.85*uBassS)*uDt;                                           // warm smoke rises, faster when the bass is full
  vec2 d = (uv-uTip.xy)*vec2(uAsp, 1.);
  v += vec2(0., 1.)*exp(-dot(d,d)/.0004)*uDt*(4.5+2.5*uLevelS);
  for (int i = 0; i < 8; i++){ float a = uPulse[i]; if (a > .9) continue;       // each kick: a breath of air across the column
    float front=uv.y-.27-a*.95;
    float gust=exp(-front*front/.043)*exp(-a*4.);
    v.x+=uSide[i]*gust*uDt*2.85;
    v.y+=uSide[i]*gust*(uv.x-.47)*uDt*.80; }
  vec2 p = uv*vec2(uAsp, 1.); float t = uTime*.2;
  v += vec2(sin(p.y*4.+t)+.6*sin(p.y*9.-t*1.6), 0.)*uDt*.02*(.3+1.5*uHighS)*smoothstep(.2,.5,uv.y);   // the room's own small draughts
  v.x += uDt*(sin(uv.y*15.+t)*uSnare*.92 + sin(uv.y*24.-t)*uHigh*.23)*smoothstep(.20,.68,uv.y);
  float height = smoothstep(.16,.75,uv.y);
  v.x += (tanh((uv.x-uTip.x)*16.)*.33 + sin(uv.y*11.-t)*.14)*height*uDt*min(den,1.);
  o = vec4(v, 0., 1.);
}`;
const FS_SMK_DYE = HEAD + LIB + SMK_COMMON + `
void main(){
  vec3 s = texture(uDye, uv).rgb; s.r *= exp(-uDt*.09); s.g *= exp(-uDt*1.1);     // r: smoke, g: its heat near the ember
  vec2 d = (uv-uTip.xy)*vec2(uAsp, 1.); float g = exp(-dot(d,d)/.00009);
  s.r += g*uDt*(9.+10.*uLevelS+10.*uKick+12.*uAccent); s.g += g*uDt*14.;
  s.r *= 1.-uDt*2.*smoothstep(.9, 1., uv.y);
  o = vec4(min(s, vec3(4.)), 1.);
}`;
const FS_SMK = FSH + COVER + `
out vec4 o; uniform sampler2D uDye; uniform vec2 uLight; uniform vec3 uTip; const vec2 TX = 1./vec2(${SMK_DW}., ${SMK_DH}.);
void main(){
  vec2 sc = gl_FragCoord.xy/uRes, uv = cover(sc, 1.6), q = sc-.5, p = uv*vec2(1.6, 1.);
  vec3 s = texture(uDye, uv).rgb;
  vec2 g = vec2(texture(uDye, uv+vec2(TX.x*2.5,0.)).r-texture(uDye, uv-vec2(TX.x*2.5,0.)).r, texture(uDye, uv+vec2(0.,TX.y*2.5)).r-texture(uDye, uv-vec2(0.,TX.y*2.5)).r);
  // a dark room: a little warm light low down, and one cool lamp off to the right
  vec3 col = vec3(.006,.005,.006)+vec3(.05,.03,.018)*exp(-pow((uv.y-.05)/.3, 2.))*(.4+.3*uBassS)*exp(-pow(q.x/.5, 2.));
  col += mix(vec3(.02,.03,.05), neon(.62)*.04, .4)*exp(-length((sc-vec2(.95,.75))*vec2(1.6,1.))*2.4);
  float a = 1.-exp(-s.r*2.2);
  float lit = clamp(.5-dot(g, normalize(vec2(1., .35)))*1.1, 0., 1.);        // lit from the right: each fold of smoke has a bright and a dark side
  vec3 sm = mix(mix(vec3(.3,.34,.42), neon(.62)*.4, .25), mix(vec3(.9,.94,1.), neon(.55), .15), lit)*(.5+.5*uLevelS+.35*uKick);
  float band=clamp((uv.y-uTip.y)*1.16,.04,.94);
  float pitch=spec(band), transient=max(0.,pitch-specS(band));
  sm+=vec3(.32,.38,.48)*(.26*pitch+1.35*transient)*(.4+.6*lit);
  // The light catches folds at treble and midrange attacks without pushing the smoke sideways.
  float foldLight=clamp(.23+3.*length(g),0.,1.);
  sm+=foldLight*(vec3(.25,.33,.48)*uLight.y+vec3(.38,.22,.12)*uLight.x);
  sm = mix(sm, vec3(1.,.55,.25)*1.4, clamp(s.g*.5, 0., 1.));                 // near the ember the smoke glows warm
  col = mix(col, sm, a*.85);
  // the stick and its ember
  vec2 tp = uTip.xy*vec2(1.6, 1.), base = tp+vec2(.42, -.5), ab = base-tp, pa = p-tp; float h = clamp(dot(pa,ab)/dot(ab,ab), 0., 1.), ds = length(pa-ab*h);
  col = mix(col, vec3(.1,.065,.045)*(.5+2.5*exp(-h*10.)), smoothstep(.0035, .002, ds));
  float de = length(p-tp);
  col += vec3(1.,.42,.12)*(smoothstep(.007,.003,de)*(4.+6.*uBass+8.*uKickL)+exp(-de*42.)*(.25+.5*uBass+.6*uKick));
  o = vec4(col*(1.-.6*dot(q,q)), 1.);
}`;
scene({ id: 'incense', name: 'Incense', from: 'Organic', kind: 'fluid', group: 'organic', pal: 0, hue: () => 0,
  about: 'A thread of smoke rising from an ember in a dark room: bass makes it climb, each kick breathes across it, and it folds and breaks in a real fluid simulation',
  inputs: ['bassS', 'levelS', 'highS', 'bass', 'kick', 'kickL', 'accent', 'pulse', 'notes (onsets)'],
  cost: 'Moderate: a 256×160 fluid solve (18 pressure iterations) and a 1024×640 smoke field. Phones: 128×80 with 10 iterations.',
  post: { bloom: 0.5, thr: 0.9, knee: 0.6, exp: 1.1, ca: 0.25, vig: 0.6, grain: 0.03 },
  init() { this.force = program(VS, FS_SMK_FORCE); this.dye = program(VS, FS_SMK_DYE); this.show = program(VS, FS_SMK);
    this.fluid = new Fluid(SMK_W, SMK_H, SMK_DW, SMK_DH); this.side = new Float32Array(8); this.last = new Float32Array(8).fill(9); this.flip = 1; this.nn = A.notes; this.kink = 0; this.wob = 0; },
  draw(F, out) {
    const t = F.time;
    const tip = [.47, .13, 0];
    newPulses(this.last, i => { this.flip = -this.flip; this.side[i] = this.flip * (.55 + .8*Math.min(1,A.kickAmp/3)); });
    const set = u => { F.set(u); gl.uniform3fv(u.uTip, tip); gl.uniform1fv(u.uSide, this.side); };
    this.fluid.step(F.dt, { force: this.force, dye: this.dye, set, keepV: 0.979, vort: 2.5 + 5 * A.highS, iters: 18, wall: 0 });
    let mids=0,highs=0;
    for(let i=90;i<256;i++){
      const attack=Math.max(0,A.bands[i]-A.bandsS[i]);
      if(i<173)mids=Math.max(mids,attack);else highs=Math.max(highs,attack);
    }
    draw(this.show, out, T.sw, T.sh, u => { set(u); gl.uniform2f(u.uLight,3*mids,4*highs); bindTex(3, this.fluid.d[0].t); gl.uniform1i(u.uDye, 3); });
  } });
}
