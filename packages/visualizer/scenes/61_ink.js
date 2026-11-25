
// ───────────────────────── Ink in Water: ink entering a lit tank from every side, unfurling and lingering ─────────────────────────
{
const INK_W = 256, INK_H = 160, INK_DW = 1024, INK_DH = 640;
// Each kick lets ink in somewhere new: dropped from above, pushed in from a side wall, rising from the floor,
// or bled into the middle. uDropP is where and which ink; uDropV is the push it arrives with and how it spreads.
const INK_COMMON = `
in vec2 uv; out vec4 o; uniform sampler2D uVel, uDye; uniform float uDt, uAsp; uniform float uJetAge[8]; uniform vec4 uDropP[8], uDropV[8];
float land(float a){ return (1.-exp(-a*45.))*exp(-a*11.)*1.25; }     // the jet opens within two frames instead of in one, then tails off
vec3 inkOf(float k){ k = mod(k, 3.); return clamp(vec3(max(1.-abs(k), 1.-abs(k-3.)), 1.-abs(k-1.), 1.-abs(k-2.)), 0., 1.); }`;
const FS_INK_FORCE = HEAD + LIB + INK_COMMON + `
void main(){
  vec2 v = texture(uVel, uv).xy; vec3 ink = texture(uDye, uv).rgb;
  v.y += (ink.r*.16-ink.b*.14)*uDt; v.x += (.5-uv.x)*ink.g*.2*uDt;            // the low ink rises from the floor, the high ink sinks from the surface, the mid ink is drawn in from the walls
  for (int i = 0; i < 8; i++){ float a = uJetAge[i]; if (a > .3) continue; vec2 d = (uv-uDropP[i].xy)*vec2(uAsp, 1.); float g = exp(-dot(d,d)/.0045);
    v += (uDropV[i].xy+uDropV[i].z*d/(length(d)+.02))*g*land(a)*uDt*(15.+16.*uDropV[i].w); }
  vec2 p = uv*vec2(uAsp, 1.); float t = uTime*.07;
  v += vec2(cos(p.y*2.3+t)+.5*cos(p.y*5.1-t*1.7), sin(p.x*1.9-t*1.3)+.5*sin(p.x*4.3+t*2.1))*uDt*.01*(.3+1.2*uMidS);   // the mids stir the tank, gently
  o = vec4(v, 0., 1.);
}`;
const FS_INK_DYE = HEAD + LIB + INK_COMMON + `
void main(){
  vec3 dye = texture(uDye, uv).rgb*exp(-uDt*.032);                           // it thins out only over a minute, so colours build up in layers
  // each band also seeps in steadily from its own side for as long as it sounds: lows from the floor, mids from the walls, highs from the surface
  float nx = noise(vec3(uv.x*9., uTime*.15, 1.)), ny = noise(vec3(uv.y*9., uTime*.15, 5.));
  dye.r += uBandE.x*uBandE.x*exp(-uv.y*uv.y/.012)*smoothstep(.28,.78,nx)*uDt*1.35;
  dye.g += uBandE.y*uBandE.y*(exp(-uv.x*uv.x/.008)+exp(-(1.-uv.x)*(1.-uv.x)/.008))*smoothstep(.28,.78,ny)*uDt*1.2;
  dye.b += uBandE.z*uBandE.z*exp(-(1.-uv.y)*(1.-uv.y)/.012)*smoothstep(.32,.82,nx)*uDt*1.65;
  for (int i = 0; i < 8; i++){ float a = uJetAge[i]; if (a > .3) continue; vec2 d = (uv-uDropP[i].xy)*vec2(uAsp, 1.);
    vec2 dir=normalize(uDropV[i].xy), per=vec2(-dir.y,dir.x);
    float along=dot(d,dir), across=dot(d,per);
    float tendril=sin(along*75.+uDropP[i].z)*.010;
    float w=.018+.032*uDropV[i].w;
    float plume=exp(-pow(along/.095,2.)-pow((across-tendril)/w,2.));
    plume+=.72*exp(-pow((along-.035)/.075,2.)-pow((across+tendril*2.)/(w*.72),2.));
    dye+=inkOf(uDropP[i].w)*plume*land(a)*uDt*(32.+28.*uDropV[i].w); }
  o = vec4(min(dye, vec3(1.5)), 1.);
}`;
const FS_INK = FSH + COVER + `
out vec4 o; uniform sampler2D uDye; uniform float uJetAge[8]; uniform vec4 uDropP[8], uDropV[8]; const vec2 TX = 1./vec2(${INK_DW}., ${INK_DH}.);
void main(){
  vec2 sc = gl_FragCoord.xy/uRes, uv = cover(sc, 1.6), q = sc-.5;
  vec3 dye = texture(uDye, uv).rgb;
  vec3 gx = texture(uDye, uv+vec2(TX.x*2.,0.)).rgb-texture(uDye, uv-vec2(TX.x*2.,0.)).rgb, gy = texture(uDye, uv+vec2(0.,TX.y*2.)).rgb-texture(uDye, uv-vec2(0.,TX.y*2.)).rgb;
  vec2 g = vec2(dot(gx, vec3(1.)), dot(gy, vec3(1.)));
  // a tank lit from behind: soft, slightly cool light, brighter in the middle
  vec3 bg = mix(vec3(.74,.79,.84), vec3(.93,.94,.95), exp(-dot(q,q)*2.6))*(.82+.1*uLevelS);
  bg *= 1.+.05*sin(uv.y*40.+uTime+noise(vec3(uv*6., uTime*.2))*6.)*smoothstep(.75, 1., uv.y);       // light playing just under the surface
  vec3 c0 = mix(vec3(.04,.12,.5), neon(.0), .08), c1 = mix(vec3(.78,.05,.3), neon(.33), .08), c2 = mix(vec3(.98,.5,.04), neon(.66), .08);   // lows indigo, mids crimson, highs amber
  vec3 T = exp(-(dye.r*-log(max(c0, .03))+dye.g*-log(max(c1, .03))+dye.b*-log(max(c2, .03)))*1.1);
  // Narrow bands pick out existing filaments, leaving the pale water undisturbed.
  float pitch=clamp(.10+.78*uv.y+.06*sin(uv.x*16.),0.,1.);
  float edge=clamp(length(g)*2.+dot(dye,vec3(.08)),0.,1.);
  float lift=clamp(spec(pitch)-specS(pitch),0.,.55);
  vec3 col=bg*T+edge*lift*mix(vec3(.22,.36,.64),vec3(.53,.13,.24),uv.y)*.35;
  // The fluid needs a few frames to carry new pigment away from a nozzle. Show the first curl at the
  // nozzle immediately, then hand it off to the advected dye. Each band has a separate side and colour,
  // so isolated low/mid/high attacks make three genuinely different change images.
  for(int i=0;i<8;i++){
    float a=uJetAge[i]; if(a>.48) continue;
    vec2 d=(uv-uDropP[i].xy)*vec2(1.6,1.), dir=normalize(uDropV[i].xy), per=vec2(-dir.y,dir.x);
    float along=dot(d,dir), across=dot(d,per), grow=smoothstep(-.018,.105,along)*(1.-smoothstep(.105,.34,along));
    float curl=sin(along*48.+uDropP[i].z)*(.012+.018*smoothstep(0.,.18,a));
    float ribbon=exp(-pow((across-curl)/(.018+.038*a),2.))*grow;
    float mouth=exp(-dot(d,d)/(.0018+.012*a*a));
    float familyBoost=uDropP[i].w>1.5?1.38:1.;
    float fresh=(ribbon*.72+mouth)*exp(-a*6.2)*(1.15+.85*uDropV[i].w)*familyBoost;
    vec3 ic=uDropP[i].w<.5?vec3(.035,.12,.76):(uDropP[i].w<1.5?vec3(.92,.035,.28):vec3(1.,.48,.025));
    col=mix(col,ic*.42,clamp(fresh*.72,0.,.84)); col+=ic*fresh*.16;
  }
  // each ink lights up, wherever it has spread, when its own band is struck
  vec3 have=dye/(1.+dye);
  vec3 hg=uHit*.45+uHitS*.55;                                                 // mostly the eased envelope: a glow, not a flash
  col+=(vec3(.1,.3,.95)*have.r*hg.x+vec3(.95,.15,.4)*have.g*hg.y+vec3(1.,.7,.15)*have.b*hg.z)*.2;
  col *= 1.+clamp(dot(g, vec2(.5, .8))*.35, -.25, .3);                       // the plumes have body: lit on one side, shaded on the other
  col *= 1.-smoothstep(.985, 1., uv.y)*.25;                                  // the waterline
  o = vec4(col*(1.-.55*dot(q,q)), 1.);
}`;
scene({ id: 'ink', name: 'Ink in Water', from: 'Organic', kind: 'fluid', group: 'organic', pal: 0, hue: () => 0,
  about: 'A lit tank where each part of the music has its own ink and its own side: low hits push indigo up from the floor, mids bring crimson in from the walls, highs drop amber from the surface, and each band seeps in for as long as it sounds, so the tank fills and the colours layer',
  inputs: ['hit (low, mid, high: n, amp)', 'bandE', 'spec', 'specS', 'midS', 'levelS'],
  cost: 'Moderate: a 256×160 fluid solve (18 pressure iterations) and a 1024×640 dye field. Phones: 128×80 with 10 iterations and a 512×320 dye field.',
  post: { bloom: 0.06, thr: 1.6, exp: 1.0, ca: 0.15, vig: 0.3, grain: 0.02, pulse: 0 },
  init() { this.force = program(VS, FS_INK_FORCE); this.dye = program(VS, FS_INK_DYE); this.show = program(VS, FS_INK);
    this.fluid = new Fluid(INK_W, INK_H, INK_DW, INK_DH); this.P = new Float32Array(32); this.V = new Float32Array(32); this.last = new Float32Array(8).fill(9); this.n = 0; this.age = new Float32Array(8).fill(9); this.sn = A.snares; this.nn = A.notes; this.noteAt = -1; this.beat=A.beat; this.h0 = A.hit[0].n; this.h1 = A.hit[1].n; this.h2 = A.hit[2].n; this.side = false; },
  draw(F, out) {
    // Each band has its own ink and its own side of the tank, so you can read the music by colour and place:
    // low hits push indigo up from the floor, mid hits bring crimson in from a wall, high hits drop amber from the surface.
    for (let j = 0; j < 8; j++) this.age[j] += F.dt;
    const r = Math.random, jet = (x, y, dx, dy, dye, strength) => { const i = this.n++ % 8; this.age[i] = 0; this.P.set([x, y, this.n * 2.4, dye], i * 4); this.V.set([dx, dy, 0.12, strength], i * 4); };
    const H = A.hit;
    if (H[0].n !== this.h0) { this.h0 = H[0].n; jet(0.12 + r() * 0.76, 0.07, (r() - 0.5) * 0.5, 1.1, 0, 0.35 + 0.65 * H[0].amp); }
    if (H[1].n !== this.h1) { this.h1 = H[1].n; const left = (this.side = !this.side); jet(left ? 0.09 : 0.91, 0.2 + r() * 0.6, left ? 1 : -1, (r() - 0.5) * 0.5, 1, 0.5 + 0.5 * H[1].amp); }
    if (H[2].n !== this.h2) { this.h2 = H[2].n; jet(0.1 + r() * 0.8, 0.94, (r() - 0.5) * 0.3, -0.9, 2, 0.45 + 0.55 * H[2].amp); }
    this.fluid.step(F.dt, { force: this.force, dye: this.dye, set: u => { F.set(u); gl.uniform1fv(u.uJetAge, this.age); gl.uniform4fv(u.uDropP, this.P); gl.uniform4fv(u.uDropV, this.V); }, keepV: 0.984, vort: 6, iters: 18, wall: 0.03 });
    draw(this.show, out, T.sw, T.sh, u => { F.set(u); bindTex(3, this.fluid.d[0].t); gl.uniform1i(u.uDye, 3); gl.uniform1fv(u.uJetAge, this.age); gl.uniform4fv(u.uDropP, this.P); gl.uniform4fv(u.uDropV, this.V); });
  } });
}
