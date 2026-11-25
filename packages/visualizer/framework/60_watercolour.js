
// ═════════════════════════ Organic scenes ═════════════════════════
// ───────────────────────── Watercolour: wet paint blooming and bleeding on cold-pressed paper ─────────────────────────
{
// A small simulation on a 960×600 sheet: three pigments and the wetness of the paper. Wet paint drifts and
// spreads; where a new drop lands it pushes the wash outward; pigment fades slowly so the sheet keeps renewing.
// The picture is paper seen through the paint (pigments subtract light), with the pigment gathered at the
// edges of each wash and settled into the tooth of the paper, the way real watercolour dries.
const WC_W = 960, WC_H = 600;
const WC_PAINT = `
vec3 paintOf(float k){ k = mod(k, 3.); return clamp(vec3(max(1.-abs(k), 1.-abs(k-3.)), 1.-abs(k-1.), 1.-abs(k-2.)), 0., 1.); }`;
// Three kinds of mark, one for each part of the music:
//   washes   low frequencies (every kick): big, pale, wet, with no edge to speak of; they bleed and merge
//   strokes  mids (every note that starts): a loaded brush drawn quickly across the sheet, bristle-streaked,
//            running dry toward its end; its colour comes from the pitch of the note
//   dots     highs: single dots on the hats, a flicked splatter on the snares
const FS_WC_SIM = HEAD + LIB + WC_PAINT + `
in vec2 uv; out vec4 o;
uniform sampler2D uState; uniform float uDt; uniform vec4 uDropP[8], uSpl[4], uStk[6], uStk2[6], uDot[8];
const float ASP = 1.6, DUR = .5;
float psi(vec2 p){ return noise(vec3(p*3.2, uTime*.05)); }
float land(float a){ return smoothstep(0.,.08,a)*(1.-smoothstep(.15,.55,a)); }           // paint leaves the brush over a moment, never all at once
void main(){
  vec2 p = uv*vec2(ASP, 1.), tx = 1./vec2(${WC_W}., ${WC_H}.); const float e = .02;
  // wet paint wanders: a slow, divergence-free drift; each fresh wash pushes outward from where it lands
  vec2 v = vec2(psi(p+vec2(0.,e))-psi(p-vec2(0.,e)), psi(p-vec2(e,0.))-psi(p+vec2(e,0.)))/(2.*e)*.011*(.5+uMidS);
  for (int i = 0; i < 8; i++){ float a = uPulse[i]; if (a > 1.2) continue; vec2 d = (uv-uDropP[i].xy)*vec2(ASP, 1.); float R = uDropP[i].z;
    v += d/(length(d)+1e-4)*exp(-dot(d,d)/(R*R*1.6))*smoothstep(0.,.1,a)*(1.-smoothstep(.2,1.,a))*.09; }
  float wet0 = texture(uState, uv).a;
  vec2 src = uv-v/vec2(ASP, 1.)*uDt*(.25+wet0);
  vec4 s = texture(uState, src);
  vec4 av = (texture(uState, src+vec2(tx.x*1.5,0.))+texture(uState, src-vec2(tx.x*1.5,0.))+texture(uState, src+vec2(0.,tx.y*1.5))+texture(uState, src-vec2(0.,tx.y*1.5)))*.25;
  float k = clamp(s.a*uDt*34., 0., .6); s.rgb = mix(s.rgb, av.rgb, k); s.a = mix(s.a, av.a, k*.6);      // wet-in-wet: paint spreads where the paper is wet
  // washes
  for (int i = 0; i < 8; i++){ float a = uPulse[i]; if (a > .7) continue; vec2 d = (uv-uDropP[i].xy)*vec2(ASP, 1.); float r = length(d);
    vec2 dn = d/(r+1e-4); float rr = r/(uDropP[i].z*(.6+.5*noise(vec3(dn*.9, uDropP[i].w*7.))+.3*noise(vec3(dn*3.1, uDropP[i].w*3.))));
    s.rgb += paintOf(uDropP[i].w)*smoothstep(1., 0., rr)*land(a)*uDt*1.9; s.a = max(s.a, smoothstep(1.25, .5, rr)*smoothstep(0.,.1,a)); }
  // strokes
  for (int i = 0; i < 6; i++){ float a = uStk[i].w; if (a > DUR) continue; float u = a/DUR, ez = 1.-(1.-u)*(1.-u), ang = uStk[i].z, L = uStk2[i].x, w = uStk2[i].y, cv = uStk2[i].z;
    vec2 dir = vec2(cos(ang), sin(ang)), per = vec2(-dir.y, dir.x), head = uStk[i].xy*vec2(ASP, 1.)+L*(ez*dir+cv*ez*ez*per), tg = normalize(dir+2.*cv*ez*per), nm = vec2(-tg.y, tg.x);
    vec2 d = p-head; float al = dot(d, tg), ac = dot(d, nm)/w; if (abs(ac) > 1.2 || abs(al) > w) continue;
    float load = 1.-.8*u, bris = smoothstep(.62-.5*load, .78-.5*load, noise(vec3(ac*4.5+ang*9., ang*31., ez*L*26.))*.6+noise(vec3(ac*13., ang*7., ez*L*70.))*.4+.25*load);   // the bristles show as the brush runs dry
    float foot = smoothstep(1., .82, abs(ac))*smoothstep(w, w*.4, abs(al));
    s.rgb += paintOf(uStk2[i].w)*foot*bris*(.5+.5*load)*uDt*38.; s.a = max(s.a, foot*.2); }
  // dots (hats) and splatter (snares)
  for (int i = 0; i < 8; i++){ float a = uDot[i].w; if (a > .4) continue; float dd = length((uv-uDot[i].xy)*vec2(ASP, 1.))/uDot[i].z;
    s.rgb += (paintOf(float(i)*1.3)*.6+.5)*smoothstep(1., .7, dd)*land(a)*uDt*9.; s.a = max(s.a, smoothstep(1.3, .8, dd)*.3*smoothstep(0.,.1,a)); }
  for (int j = 0; j < 4; j++){ float a = uSpl[j].w; if (a > .5) continue; vec2 q = (uv-uSpl[j].xy)*vec2(ASP, 1.)/.03, c = floor(q); float sd = uSpl[j].z;
    float h = hash2(c+sd*17.), keep = step(.74, h)*smoothstep(8., 1., length(c)+3.*hash2(c+sd*5.));
    float dd = length(q-c-.12-.76*vec2(hash2(c+sd), hash2(c+sd+3.)));
    s.rgb += paintOf(sd*3.+h)*smoothstep(.12+.3*h, .04, dd)*keep*land(a)*uDt*7.; s.a = max(s.a, smoothstep(.5, .1, dd)*keep*.5*smoothstep(0.,.1,a)); }
  s.a = max(s.a-uDt*.04, 0.);                                              // the paper dries
  s.rgb = min(s.rgb*exp(-uDt*.024), vec3(3.));                             // and old paint fades, so the sheet keeps renewing
  o = s;
}`;
const FS_WC = FSH + COVER + `
out vec4 o; uniform sampler2D uState;
float tooth(vec2 p){ return noise(vec3(p*150., 1.))*.45+noise(vec3(p*64., 5.))*.35+noise(vec3(p*vec2(22., 300.), 9.))*.2; }
void main(){
  vec2 uv = cover(gl_FragCoord.xy/uRes, 1.6), p = uv*vec2(1.6, 1.), e = 1.5/vec2(${WC_W}., ${WC_H}.);
  vec4 s = texture(uState, uv);
  vec3 gx = texture(uState, uv+vec2(e.x,0.)).rgb-texture(uState, uv-vec2(e.x,0.)).rgb, gy = texture(uState, uv+vec2(0.,e.y)).rgb-texture(uState, uv-vec2(0.,e.y)).rgb;
  float th = tooth(p), dens = dot(s.rgb, vec3(1.)), edge = length(vec2(dot(gx, vec3(1.)), dot(gy, vec3(1.))));
  vec3 pig = s.rgb*(1.+(.5-th)*.6*(1.-.6*s.a)) + s.rgb/max(dens, 1e-3)*edge*2.6*(1.-.5*s.a);   // settled in the hollows, gathered at the edges
  // three paints; what they do not absorb is what you see
  vec3 c0 = mix(vec3(.1,.24,.7), neon(.0), .1), c1 = mix(vec3(.82,.13,.27), neon(.33), .1), c2 = mix(vec3(.96,.66,.14), neon(.66), .1);
  vec3 T = exp(-(pig.r*-log(max(c0, .04))+pig.g*-log(max(c1, .04))+pig.b*-log(max(c2, .04)))*.85);
  vec3 paper = vec3(.93,.905,.85)*(.9+.14*th)*(1.-.07*s.a);
  paper *= .97+.03*noise(vec3(p*vec2(3., 60.), 3.));                         // faint laid lines
  vec2 q = gl_FragCoord.xy/uRes-.5;
  o = vec4(paper*T*(1.02-.5*dot(q,q)), 1.);
}`;
scene({ id: 'wash', name: 'Watercolour', from: 'Organic', kind: 'paint', group: 'organic', pal: 0, hue: () => 0,
  about: 'Wet paint on cold-pressed paper, with a brush for each part of the music: big soft washes on the low end, quick bristled strokes for every note (coloured by its pitch), dots and splatter for the hats and snares',
  inputs: ['midS', 'bassS', 'pulse', 'notes, hats, snares (onsets)', 'noteBand', 'noteAmp', 'hatAmp'],
  cost: 'Light: one 960×600 simulation pass and one full-screen pass. Phones: a 640×400 sheet.',
  post: { bloom: 0.08, thr: 1.6, exp: 1.0, ca: 0.15, vig: 0.35, grain: 0.03, pulse: 0 },
  init() { this.sim = program(VS, FS_WC_SIM); this.show = program(VS, FS_WC);
    this.a = simTarget(WC_W, WC_H); this.b = simTarget(WC_W, WC_H);
    this.drops = new Float32Array(32); this.spl = new Float32Array(16).fill(9); this.stk = new Float32Array(24).fill(9); this.stk2 = new Float32Array(24); this.dot = new Float32Array(32).fill(9);
    this.last = new Float32Array(8).fill(9); this.sn = A.snares; this.nn = A.notes; this.hn = A.hats; this.si = 0; this.ki = 0; this.di = 0; },
  draw(F, out) {
    const t = F.time, r = Math.random, D = this.drops, S = this.spl, K = this.stk, K2 = this.stk2, O = this.dot;
    // the hand wanders the sheet slowly; strokes and dots fall near it, so the picture has a centre that moves
    const hand = [0.5 + 0.34 * Math.sin(t * 0.13 + Math.sin(t * 0.07) * 2), 0.5 + 0.3 * Math.sin(t * 0.17 + 1.3 + Math.cos(t * 0.05) * 2)];
    for (let j = 0; j < 4; j++) S[j * 4 + 3] += F.dt;
    for (let j = 0; j < 6; j++) K[j * 4 + 3] += F.dt;
    for (let j = 0; j < 8; j++) O[j * 4 + 3] += F.dt;
    newPulses(this.last, i => D.set([0.08 + r() * 0.84, 0.1 + r() * 0.8, 0.14 + 0.12 * A.bassS + 0.06 * r(), r() * 3], i * 4));
    if (A.notes !== this.nn) { this.nn = A.notes; const j = this.ki++ % 6, len = 0.1 + 0.2 * A.noteAmp + 0.08 * r();
      K.set([hand[0] + (r() - 0.5) * 0.3, hand[1] + (r() - 0.5) * 0.36, r() * 6.283, 0], j * 4); K2.set([len, 0.007 + 0.014 * A.noteAmp + 0.005 * r(), (r() - 0.5) * 0.9, A.noteBand * 3.4 + r() * 0.4], j * 4); }
    if (A.hats !== this.hn) { this.hn = A.hats; O.set([hand[0] + (r() - 0.5) * 0.5, hand[1] + (r() - 0.5) * 0.5, 0.003 + 0.006 * A.hatAmp + 0.002 * r(), 0], (this.di++ & 7) * 4); }
    if (A.snares !== this.sn) { this.sn = A.snares; S.set([hand[0] + (r() - 0.5) * 0.4, hand[1] + (r() - 0.5) * 0.4, r(), 0], (this.si++ & 3) * 4); }
    draw(this.sim, this.b, WC_W, WC_H, u => { F.set(u); bindTex(3, this.a.t); gl.uniform1i(u.uState, 3); gl.uniform1f(u.uDt, Math.min(F.dt, 1 / 30));
      gl.uniform4fv(u.uDropP, D); gl.uniform4fv(u.uSpl, S); gl.uniform4fv(u.uStk, K); gl.uniform4fv(u.uStk2, K2); gl.uniform4fv(u.uDot, O); });
    [this.a, this.b] = [this.b, this.a];
    draw(this.show, out, T.sw, T.sh, u => { F.set(u); bindTex(3, this.a.t); gl.uniform1i(u.uState, 3); });
  } });
}
