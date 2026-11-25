
// ───────────────────────── Shallows: sunlight through moving water onto sand and stones ─────────────────────────
{
// One full-screen pass. The water surface is a sum of small waves plus the rings left by falling drops: a big
// drop on every kick, a middling one on every snare, and a small one for each note (placed across the pool by
// its pitch). A drop falls, strikes, throws up a bead that falls back and rings again. The
// light pattern on the bed is the focusing of the sun by that surface (how much a patch of light is squeezed
// or spread, from the second derivatives of the surface), slightly different for red, green and blue.
const FS_SHALLOWS = FSH + `
out vec4 o; uniform vec4 uDr[14];                              // each drop: x, z, size, age in seconds
float voice(float band){
  float fast=spec(band), slow=specS(band);
  return clamp(.25*fast+.3*slow+1.6*max(0.,fast-slow),0.,1.);      // the band's level, with a moderate lift on its attacks
}
const float FALL = .022, BACK = .5;                             // it strikes within one or two frames; the bead it throws up lands BACK after that
vec2 wgrad(vec2 p){                                           // the slope of the water surface at p
  vec2 g = vec2(0.); float warp = noise(vec3(p*.35, uTime*.12))*5., amp = .10+.22*uBassS;
  for (int i = 0; i < 9; i++){ float fi = float(i), ang = fi*2.399+.6, k = 1.7*pow(1.32, fi); vec2 D = vec2(cos(ang), sin(ang));
    float e=i<3?uBandE.x:(i<6?uBandE.y:uBandE.z);
    g += D*(.012+.026*amp+.052*e)*cos(k*dot(D,p)-sqrt(k*4.)*uTime*.62+warp*(.6+.2*fi)+fi*1.7); }
  for (int i = 0; i < 14; i++){ float sz = uDr[i].z, a = uDr[i].w-FALL, life = .44+.84*sz; if (sz <= 0. || a < 0. || a > life+BACK) continue;
    vec2 d = p-uDr[i].xy; float r = length(d)+1e-3, x = r-a*1.5, k = 22.-8.*sz;                          // bigger drops make broader, longer-lived rings
    float w = cos(x*k)*smoothstep(0.,.09,a)*(1.-smoothstep(life*.5, life, a))*exp(-x*x*(9.-4.*sz));
    float a2 = a-BACK, x2 = r-a2*1.5; if (a2 > 0.) w += .2*cos(x2*k)*smoothstep(0.,.12,a2)*(1.-smoothstep(life*.3, life*.7, a2))*exp(-x2*x2*9.);
    g += d/r*w*(.2+.5*sz)/(1.+r*.7); }
  return g; }
float petal(vec2 p, out vec3 pc){                              // a few petals riding the surface
  vec2 q = p+vec2(uTime*.05, uTime*.02), c = floor(q/1.7); float h = hash2(c+3.); pc = mix(vec3(1.,.82,.86), vec3(1.,.95,.8), hash2(c+9.));
  if (h < .62) return 0.;
  vec2 l = rot(h*20.+uTime*.1*(h-.8))*(q-(c+.3+.4*vec2(hash2(c+5.), hash2(c+7.)))*1.7);
  return smoothstep(.0, -.012, length(l*vec2(1., 1.9))-.07-.04*h); }
// The pool has a shore. Across the drift of the camera the bed slopes away: dry sand at your feet, a
// waterline that laps in and out with the bass, clear shallows, then deep water.
const vec2 SN = vec2(-.385, .923), SD = vec2(.923, .385);        // away from the shore, and along it
float shoreAt(vec2 p){ float al = dot(p, SD); return -1.75+.45*noise(vec3(al*.35, 3., 1.))+.18*sin(al*1.3)-.16*uBassS-.05*sin(uTime*.6+al); }
float depthAt(vec2 p){ float s = dot(p, SN)-shoreAt(p); return clamp(s*.36*(.8+.5*noise(vec3(p*.22, 2.)))+.12*(noise(vec3(p*.7, 5.))-.5)*smoothstep(0., 1., s), -.4, 2.6); }
// stones: where, how big, how tall. xy: offset from the nearest stone in units of its radius; z: its height; w: its seed (0 = none here)
vec4 stoneAt(vec2 pf){ vec2 sg = pf*1.25, sc = floor(sg); vec4 best = vec4(9., 9., 0., 0.);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 cc = sc+vec2(float(i), float(j)); float h = hash2(cc+.7); if (h < .56) continue;
    vec2 ctr = cc+.25+.5*vec2(hash2(cc+1.3), hash2(cc+2.9)), d = (sg-ctr)*vec2(1., .8+.5*hash2(cc+4.)); float r = .15+.34*(h-.56)*2.2;
    if (length(d)/r < length(best.xy)) best = vec4(d/r, r*.55, h); }
  return best; }
void main(){
  vec3 rd = viewRay(); const vec3 SUNL = vec3(.28, .51, .81);                 // the moon, low over the far water
  float ts = -uEye.y/rd.y; vec3 Ps = uEye+rd*ts; vec2 ps = Ps.xz;
  float d0 = depthAt(ps), wet = smoothstep(0., .25, d0);
  vec2 gs = wgrad(ps)*smoothstep(.0, .35, d0); vec3 n = normalize(vec3(-gs.x, 1., -gs.y));
  vec3 rr = refract(rd, n, 1./1.33);
  float path = max(d0, 0.)/max(-rr.y, .25); vec2 pf = ps+rr.xz*path;          // the point on the bed that you see: deeper water shifts it further
  float depth = max(depthAt(pf), 0.); path = depth/max(-rr.y, .25); pf = ps+rr.xz*path;
  // the bed: rippled sand and stones of different sizes, some standing clear of the water near the shore
  float rip = sin(pf.x*7.+noise(vec3(pf*1.1, 4.))*5.+pf.y*1.5);
  vec3 sand = vec3(.62,.56,.46)*(.8+.1*rip+.16*noise(vec3(pf*42., 1.)))*(.85+.3*noise(vec3(pf*.7, 6.)));
  vec4 st = stoneAt(pf); float dd = length(st.xy), stone = st.w > 0. ? smoothstep(1., .9, dd) : 0., rim = dd*dd*stone;
  vec3 sn = normalize(vec3(-st.xy, sqrt(max(1.-dd*dd, 0.))+.2));
  float shade = mix(mix(.6, 1., smoothstep(1., 1.6, length(st.xy-vec2(.1,-.12)))), .45+.75*clamp(dot(sn, normalize(vec3(.3,.5,.8))), 0., 1.), stone);
  vec3 stc = mix(vec3(.36,.36,.38), vec3(.5,.42,.34), fract(st.w*7.3))*(.65+.55*noise(vec3(pf*68., st.w)));
  vec3 bed = mix(sand, stc, stone)*shade;
  float proud = stone*smoothstep(-.02, .03, st.z*sqrt(max(1.-dd*dd, 0.))-depth);    // this much of the stone stands above the water
  // moonlight focused on the bed by the surface: strong in the shallows, fading with depth; it swells with the low end
  const float e = .02; vec2 g0 = wgrad(pf), gx = wgrad(pf+vec2(e,0.)), gy = wgrad(pf+vec2(0.,e));
  float hxx = (gx.x-g0.x)/e, hxy = (gx.y-g0.y)/e, hyy = (gy.y-g0.y)/e, c = min(depth, 1.2)*.8;
  vec3 cc3 = c*vec3(.94, 1., 1.07), det = (1.-cc3*hxx)*(1.-cc3*hyy)-cc3*cc3*hxy*hxy;
  vec3 caus = mix(vec3(1.), min(1./(abs(det)+.14), vec3(4.)), wet);
  vec3 pc; float pshadow = petal(pf-SUNL.xz*depth*.5, pc);
  vec3 hg = uHit*.3+uHitS*.7;                                                 // mostly the eased onset: light that swells, never flashes
  vec3 sun = vec3(.3,.42,.66)*(.55+.9*uBassS+.6*uHitS.x);                      // the whole bed's light follows the slow envelopes only
  vec3 col = bed*vec3(.03,.042,.075)+bed*sun*caus*.16*(1.-.6*pshadow);
  // lights under the stones. Each has its own colour and its own narrow band, so they come up one by one with
  // the notes; low, mid and high onsets strike the turquoise, violet and amber ones, strongest near the newest drop.
  vec2 cell = floor(pf/2.8); vec3 lanterns = vec3(0.), haze = vec3(0.);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec2 lc = cell+vec2(float(i), float(j)); float seed = hash2(lc+9.);
    vec2 pos = (lc+.2+.6*vec2(hash2(lc+2.), hash2(lc+4.)))*2.8, delta = pf-pos; float r2 = dot(delta, delta);
    vec3 lamp = seed < .4 ? vec3(.02,.85,.72) : (seed < .72 ? vec3(.34,.2,.98) : vec3(1.,.42,.09));
    float local = voice(.04+.91*fract(seed*7.31)), strike = seed < .4 ? hg.x : (seed < .72 ? hg.y : hg.z);
    float ph = .5+.5*sin(seed*40.+dot(pos, vec2(.7,.4)));                      // the strike reaches them unevenly
    float power = .05+2.6*local+1.7*strike*(.35+.65*ph);
    lanterns += lamp*exp(-r2*(1.6+.7*seed))*power; haze += lamp*exp(-r2*.55)*power; }
  col += lanterns*(.2+.6*caus)*(.36+stone*.58+rim*.99)*(.35+.78*shade)*(.83+.22*noise(vec3(pf*55., 2.)));
  // the water itself: it takes red first, then green, and holds a little of the coloured light as haze
  vec3 dry = bed*(vec3(.05,.065,.1)+sun*.2)+lanterns*.25*(.4+rim);
  float len = path+depth;
  col *= exp(-vec3(.75,.24,.13)*len);
  col += vec3(.004,.02,.035)*(1.-exp(-len*.8))+haze*.045*(1.-exp(-len*1.4));
  // the surface: you see through it at your feet and it turns to a mirror toward the far side
  vec3 rf = reflect(rd, n); float cosv = max(dot(n, -rd), 0.), fr = .02+.98*pow(1.-cosv, 5.);
  vec3 sky = vec3(.012,.024,.055)+vec3(.1,.16,.3)*pow(max(rf.y, 0.), .6)*.5+vec3(.5,.62,.9)*exp(-acos(clamp(dot(rf, SUNL), -1., 1.))*7.)*.5;
  col = mix(col, sky, fr*wet);
  col += vec3(.64,.8,1.)*pow(max(dot(rf, SUNL), 0.), 220.)*(1.5+1.6*hg.z)*wet;                  // the moon's glitter on the ripples; the highs sharpen it
  // stones standing proud, the dry beach, and the lapping edge between
  col = mix(col, dry, max(proud, 1.-smoothstep(-.02, .02, d0)));
  float edge = exp(-abs(d0)*38.)*(.5+.5*noise(vec3(ps*9., uTime*.5)));
  col += vec3(.4,.5,.62)*edge*(.35+.8*uBassS)+vec3(.02,.03,.05)*smoothstep(.3, 0., abs(d0))*smoothstep(-.3, 0., d0);
  float pm = petal(ps+gs*.3, pc)*wet;
  col = mix(col, pc*(vec3(.12,.14,.19)+lanterns*.3), pm);
  // the drops themselves: a streak coming down, then the bead thrown back up
  for (int i = 0; i < 14; i++){ float sz = uDr[i].z, a = uDr[i].w; if (a > FALL+BACK || sz <= 0.) continue;
    float up = a < FALL ? (1.-a/FALL)*1.5 : sz*.42*4.*((a-FALL)/BACK)*(1.-(a-FALL)/BACK), rad = (a < FALL ? .028 : .02)*(.5+.8*sz), sy = a < FALL ? 4. : 1.2;
    vec3 C = vec3(uDr[i].x, up+rad, uDr[i].y), oc = (uEye-C)*vec3(1., 1./sy, 1.), dd = normalize(rd*vec3(1., 1./sy, 1.));
    float b = dot(oc, dd), h = b*b-dot(oc, oc)+rad*rad;
    if (h > 0.){ vec3 nn = normalize((oc+dd*(-b-sqrt(h)))*vec3(1., 1./sy, 1.)); float e = 1.-max(dot(nn, -rd), 0.);
      vec3 dc = mix(vec3(.5,.66,.82), vec3(.95,.98,1.), smoothstep(-.2,.8,nn.y))*(.21+.36*e)+lanterns*.35+sun*pow(max(dot(reflect(rd, nn), SUNL), 0.), 40.)*3.;
      col = mix(col, dc, smoothstep(0., rad*rad*.4, h)*.9); }
    float ai = a-FALL; if (ai > 0. && ai < .25){ float rr = length(ps-uDr[i].xy);                           // the crown at the moment it strikes
      col += sun*exp(-pow((rr-ai*.9)/.02, 2.))*smoothstep(0., .06, ai)*(1.-ai/.25)*sz*1.2; } }
  o = vec4(col, ts+path);
}`;
scene({ id: 'shallows', name: 'Shallows', from: 'Organic', kind: 'nature', group: 'organic', pal: 0, hue: () => 0,
  about: 'A moonlit pool seen from its shore: the bed slopes from dry sand through clear shallows into deep water, with stones at every depth, some standing clear. Drops fall on the onsets and ring; lights under the stones come up one by one with their own bands and are struck by lows, mids and highs; the moon-caustics swell with the bass',
  inputs: ['spec', 'specS', 'hit (low, mid, high: n, amp, fast)', 'bandE', 'bassS'],
  cost: 'Moderate: four surface-slope evaluations a pixel (about 70 trig calls). Phones: five waves instead of nine, at reduced resolution.',
  post: { dof: { ap: 4, max: 5 }, bloom: 0.35, thr: 1.1, knee: 0.6, exp: 1.0, ca: 0.3, vig: 0.6, pulse: 0.2 },
  init() { this.p = program(VS, FS_SHALLOWS); this.dr = new Float32Array(56); this.di = 0; this.last = new Float32Array(8).fill(9);
    this.h0=A.hit[0].n; this.h1=A.hit[1].n; this.h2=A.hit[2].n; },
  draw(F, out) {
    const t = F.time, drift = [t * 0.12, t * 0.05], tgt = [drift[0], 0, drift[1] + 1.2];
    const D = this.dr, r = Math.random, drop = (x, z, size) => { D.set([tgt[0] + x, tgt[2] + z, size, 0], (this.di++ % 14) * 4); };
    for (let i = 0; i < 14; i++) D[i * 4 + 3] += F.dt;
    const H=A.hit;
    if(this.h0!==H[0].n){ this.h0=H[0].n; drop((r()-.5)*7.6,-.6+r()*5.2,.66+.32*H[0].amp); }
    if(this.h1!==H[1].n){ this.h1=H[1].n; drop((r()-.5)*8.4,-.8+r()*5.8,.38+.24*H[1].amp); }
    if(this.h2!==H[2].n){ this.h2=H[2].n; drop((r()-.5)*9.2,-1.+r()*6.2,.19+.17*H[2].amp); }
    const eye = [drift[0] + Math.sin(t * 0.06) * 0.4, 2.35, drift[1] - 3.0];              // standing at the water's edge, looking out and down
    const c = camera(eye, tgt, 0.8, Math.sin(t * 0.05) * 0.012, 0.1, 60); F.focus = Math.hypot(...sub(eye, tgt)) + 0.5;
    draw(this.p, out, T.sw, T.sh, u => { F.set(u); setCam(u, c); gl.uniform4fv(u.uDr, D); });
  } });
}
