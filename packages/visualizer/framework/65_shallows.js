
// ───────────────────────── Shallows: sunlight through moving water onto sand and stones ─────────────────────────
{
// One full-screen pass. The water surface is a sum of small waves plus the rings left by falling drops: a big
// drop on every kick, a middling one on every snare, and a small one for each note (placed across the pool by
// its pitch). A drop falls, strikes, throws up a bead that falls back and rings again. The
// light pattern on the bed is the focusing of the sun by that surface (how much a patch of light is squeezed
// or spread, from the second derivatives of the surface), slightly different for red, green and blue.
const FS_SHALLOWS = FSH + `
out vec4 o; uniform vec4 uDr[14];                              // each drop: x, z, size, age in seconds
const float FALL = .09, BACK = .5;                             // it strikes FALL after it is let go; the bead it throws up lands BACK after that
vec2 wgrad(vec2 p){                                           // the slope of the water surface at p
  vec2 g = vec2(0.); float warp = noise(vec3(p*.35, uTime*.12))*5., amp = .45+1.1*uBassS+.4*uDyn;
  for (int i = 0; i < 9; i++){ float fi = float(i), ang = fi*2.399+.6, k = 1.7*pow(1.32, fi); vec2 D = vec2(cos(ang), sin(ang));
    g += D*.05*(i < 5 ? amp : .5+1.7*uHighS)*cos(k*dot(D,p)-sqrt(k*4.)*uTime*1.1+warp*(.6+.2*fi)+fi*1.7); }
  for (int i = 0; i < 14; i++){ float sz = uDr[i].z, a = uDr[i].w-FALL, life = .9+2.3*sz; if (a < 0. || a > life+BACK) continue;
    vec2 d = p-uDr[i].xy; float r = length(d)+1e-3, x = r-a*1.5, k = 22.-8.*sz;                          // bigger drops make broader, longer-lived rings
    float w = cos(x*k)*smoothstep(0.,.12,a)*(1.-smoothstep(life*.5, life, a))*exp(-x*x*(9.-4.*sz));
    float a2 = a-BACK, x2 = r-a2*1.5; if (a2 > 0.) w += .45*cos(x2*k)*smoothstep(0.,.12,a2)*(1.-smoothstep(life*.3, life*.7, a2))*exp(-x2*x2*9.);
    g += d/r*w*(.2+.5*sz)/(1.+r*.7); }
  return g; }
float petal(vec2 p, out vec3 pc){                              // a few petals riding the surface
  vec2 q = p+vec2(uTime*.05, uTime*.02), c = floor(q/1.7); float h = hash2(c+3.); pc = mix(vec3(1.,.82,.86), vec3(1.,.95,.8), hash2(c+9.));
  if (h < .62) return 0.;
  vec2 l = rot(h*20.+uTime*.1*(h-.8))*(q-(c+.3+.4*vec2(hash2(c+5.), hash2(c+7.)))*1.7);
  return smoothstep(.0, -.012, length(l*vec2(1., 1.9))-.07-.04*h); }
void main(){
  vec3 rd = viewRay(); const vec3 SUNL = vec3(.32, .86, .4);
  float ts = -uEye.y/rd.y; vec3 Ps = uEye+rd*ts; vec2 ps = Ps.xz;
  vec2 gs = wgrad(ps); vec3 n = normalize(vec3(-gs.x, 1., -gs.y));
  vec3 rr = refract(rd, n, 1./1.33);
  float depth = .55+.4*noise(vec3(ps*.16, 2.)), path = depth/max(-rr.y, .2); vec2 pf = ps+rr.xz*path;      // the point on the bed that you see
  // the bed: rippled sand, scattered stones
  float rip = sin(pf.x*7.+noise(vec3(pf*1.1, 4.))*5.+pf.y*1.5);
  vec3 sand = vec3(.78,.67,.48)*(.82+.1*rip+.14*noise(vec3(pf*42., 1.)))*(.9+.2*noise(vec3(pf*.7, 6.)));
  vec2 sg = pf*1.9, sc = floor(sg), sf = fract(sg); float stone = 0., shade = 1.; vec3 stc = vec3(.4);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 cc = sc+vec2(float(i), float(j)); float h = hash2(cc+.7);
    if (h < .58) continue; vec2 ctr = cc+.25+.5*vec2(hash2(cc+1.3), hash2(cc+2.9)), d = (sg-ctr)*vec2(1., .8+.5*hash2(cc+4.)); float r = .12+.2*(h-.58)*2.2, dd = length(d)/r;
    if (dd < 1.){ stone = smoothstep(1., .9, dd); stc = mix(vec3(.42,.4,.38), vec3(.6,.48,.36), hash2(cc+6.))*(.75+.5*hash2(cc+8.));
      shade = .6+.55*clamp(dot(normalize(vec3(-d/r, sqrt(max(1.-dd*dd, 0.)))), normalize(vec3(.4,.5,.8))), 0., 1.); }
    else shade = min(shade, mix(.6, 1., smoothstep(1., 1.5, length(d-vec2(.06,-.08))/r))); }               // and its shadow on the sand
  vec3 bed = mix(sand, stc, stone)*shade;
  // the light: where the surface focuses the sun, and where it spreads it
  const float e = .02; vec2 g0 = wgrad(pf), gx = wgrad(pf+vec2(e,0.)), gy = wgrad(pf+vec2(0.,e));
  float hxx = (gx.x-g0.x)/e, hxy = (gx.y-g0.y)/e, hyy = (gy.y-g0.y)/e, c = depth*.62;
  vec3 cc3 = c*vec3(.94, 1., 1.07), det = (1.-cc3*hxx)*(1.-cc3*hyy)-cc3*cc3*hxy*hxy;
  vec3 caus = min(1./(abs(det)+.14), vec3(4.));
  vec3 pc; float pshadow = petal(pf-SUNL.xz*depth*.5, pc);
  vec3 sun = mix(vec3(1.,.95,.84), neon(.12), .1)*(.65+.5*uLevelS+.2*uKick);
  vec3 col = bed*(vec3(.17,.26,.3)+sun*caus*.48*(1.-.6*pshadow));
  // water takes the red out with depth, and scatters a little green-blue back
  col *= exp(-vec3(.42,.1,.05)*(path+depth)*.8);
  col = mix(col, mix(vec3(.04,.24,.26), neon(.55)*.2, .15), 1.-exp(-(path+depth)*.16));
  // the surface itself: sky, and sparks of sun on the ripples
  float cosv = max(dot(n, -rd), 0.), fr = .02+.98*pow(1.-cosv, 5.); vec3 rf = reflect(rd, n);
  col = mix(col, mix(vec3(.5,.66,.82), vec3(.9,.94,1.), smoothstep(.2,.9,rf.y)), fr);
  col += sun*pow(max(dot(rf, SUNL), 0.), 500.)*18.*(.6+1.2*uHigh);
  float pm = petal(ps+gs*.3, pc);
  col = mix(col, pc*(.55+.5*sun)*(.8+.3*noise(vec3(ps*30., 1.))), pm);
  // the drops themselves: a streak coming down, then the bead thrown back up
  for (int i = 0; i < 14; i++){ float sz = uDr[i].z, a = uDr[i].w; if (a > FALL+BACK || sz <= 0.) continue;
    float up = a < FALL ? (1.-a/FALL)*1.5 : sz*.42*4.*((a-FALL)/BACK)*(1.-(a-FALL)/BACK), rad = (a < FALL ? .028 : .02)*(.5+.8*sz), sy = a < FALL ? 4. : 1.2;
    vec3 C = vec3(uDr[i].x, up+rad, uDr[i].y), oc = (uEye-C)*vec3(1., 1./sy, 1.), dd = normalize(rd*vec3(1., 1./sy, 1.));
    float b = dot(oc, dd), h = b*b-dot(oc, oc)+rad*rad;
    if (h > 0.){ vec3 nn = normalize((oc+dd*(-b-sqrt(h)))*vec3(1., 1./sy, 1.)); float e = 1.-max(dot(nn, -rd), 0.);
      vec3 dc = mix(vec3(.5,.66,.82), vec3(.95,.98,1.), smoothstep(-.2,.8,nn.y))*(.5+.5*e)+sun*pow(max(dot(reflect(rd, nn), SUNL), 0.), 40.)*3.;
      col = mix(col, dc, smoothstep(0., rad*rad*.4, h)*.9); }
    float ai = a-FALL; if (ai > 0. && ai < .25){ float rr = length(ps-uDr[i].xy);                           // the crown at the moment it strikes
      col += sun*exp(-pow((rr-ai*.9)/.02, 2.))*(1.-ai/.25)*sz*1.2; } }
  o = vec4(col, ts+path);
}`;
scene({ id: 'shallows', name: 'Shallows', from: 'Organic', kind: 'nature', group: 'organic', pal: 0, hue: () => 0,
  about: 'Sunlight through clear moving water onto sand and stones: drops fall into it with the music (big on the kick, smaller on the snare, a little one for every note, placed by its pitch) and their rings sweep the light across the bed',
  inputs: ['bassS', 'highS', 'levelS', 'high', 'kick', 'pulse', 'snares, notes (onsets)', 'dyn'],
  cost: 'Moderate: four surface-slope evaluations a pixel (about 70 trig calls). Phones: five waves instead of nine, at reduced resolution.',
  post: { dof: { ap: 4, max: 5 }, bloom: 0.35, thr: 1.1, knee: 0.6, exp: 1.0, ca: 0.3, vig: 0.6, pulse: 0.2 },
  init() { this.p = program(VS, FS_SHALLOWS); this.dr = new Float32Array(56).fill(99); this.di = 0; this.last = new Float32Array(8).fill(9); this.sn = A.snares; this.nn = A.notes; },
  draw(F, out) {
    const t = F.time, drift = [t * 0.12, t * 0.05], tgt = [drift[0], 0, drift[1] + 1.2];
    const D = this.dr, r = Math.random, drop = (x, z, size) => { D.set([tgt[0] + x, tgt[2] + z, size, 0], (this.di++ % 14) * 4); };
    for (let i = 0; i < 14; i++) D[i * 4 + 3] += F.dt;
    newPulses(this.last, () => drop((r() - 0.5) * 3.6, (r() - 0.5) * 2.4, 0.65 + 0.35 * Math.min(1, A.kickAmp / 3)));       // kicks: the big drops
    if (A.snares !== this.sn) { this.sn = A.snares; drop((r() - 0.5) * 5, (r() - 0.5) * 3.2, 0.45); }
    if (A.notes !== this.nn) { this.nn = A.notes; drop((A.noteBand - 0.45) * 9, (r() - 0.5) * 3.4 + 0.3, 0.12 + 0.22 * A.noteAmp); }   // notes: small ones, placed by pitch
    const eye = [drift[0] + Math.sin(t * 0.06) * 0.5, 3.1, drift[1] - 1.9];
    const c = camera(eye, tgt, 0.78, Math.sin(t * 0.05) * 0.04, 0.1, 60); F.focus = Math.hypot(...sub(eye, tgt)) + 0.5;
    draw(this.p, out, T.sw, T.sh, u => { F.set(u); setCam(u, c); gl.uniform4fv(u.uDr, D); });
  } });
}
