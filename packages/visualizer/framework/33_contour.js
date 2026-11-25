
// ───────────────────────── Neon Cartography: a map that surveys and draws itself as the music plays ─────────────────────────
{
// An old paper map on a table under a lamp: stained, creased, drawn by hand in sepia, red and blue ink.
// The music shows as light in the ink, and each kind of feature listens to something different: contours (each
// elevation is a band and lights with it), coast and soundings, rivers, a road network, towns that are
// founded, grow street by street and fade, their names, survey marks dropped on every kick, and the route
// travelled so far. The surveyed area widens as the music fills out; a ring sweeps it on every kick.
const MAP_NAMES = ['PORT LEGATO', 'CADENCE', 'TREBLE REACH', 'LARGO BAY', 'ALLEGRO PASS', 'FERMATA', 'OCTAVE RIDGE', 'CODA',
  'VIVACE', 'ADAGIO FLATS', 'MINOR FALLS', 'SEGUE', 'TEMPO', 'RUBATO', 'ARIA SOUND', 'OSTINATO', 'NEON CARTOGRAPHY', 'SURVEY IN PROGRESS', '', ''];
const FS_MAP = FSH + `
out vec4 o; uniform sampler2D uText; uniform float uS, uHead, uFocusD; uniform vec3 uMk[8];
const float TOWN = 7.;
vec2 route(float s){ return vec2(s*.5, 2.6*sin(s*.045)+1.2*sin(s*.11)); }
vec3 vor(vec2 p){ vec2 ip = floor(p), fp = fract(p); float f1 = 9., f2 = 9., id = 0.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 g = vec2(float(i),float(j)), h = vec2(hash2(ip+g), hash2(ip+g+37.3)), r = g+.15+.7*h-fp; float d = dot(r,r);
    if (d < f1){ f2 = f1; f1 = d; id = h.x; } else if (d < f2) f2 = d; }
  return vec3(sqrt(f1), sqrt(f2), id); }
float lineW(float e, float px){ return 1.-smoothstep(px-.5, px+.5, abs(e)/max(fwidth(e), 1e-5)); }     // a line px pixels wide where e crosses zero
float land(vec2 m){ return fbm(vec3(m*.085, 1.7))+.25*noise(vec3(m*.03, 9.))-.12; }
float label(vec2 l, float idx){ if (l.x < 0. || l.x > 1. || l.y < 0. || l.y > 1.) return 0.;
  return texture(uText, (vec2(mod(idx, 4.), 4.-floor(idx/4.))+l)/vec2(4., 5.)).r; }
float inkW(float e, float px, vec2 m){ return lineW(e, px*(.75+.5*noise(vec3(m*1.9, 4.)))); }          // a pen line: its weight wavers
void main(){
  vec3 rd = viewRay(); float depth = 200.; vec3 col = vec3(.05,.04,.03), glow = vec3(0.);
  vec2 q = (gl_FragCoord.xy*2.-uRes)/uRes.y, C = route(uS);
  if (rd.y < -.01){
    float t = -uEye.y/rd.y; vec3 P = uEye+rd*t; depth = t;
    vec2 m0 = vec2(-P.x, P.z);                                           // map coordinates: east to the right, north away from you
    vec2 m = m0+.045*(vec2(noise(vec3(m0*2.3, 1.)), noise(vec3(m0*2.3, 7.)))-.5);     // the draughtsman's hand is not perfectly steady
    float dE = length(m-C), R0 = 8.5+8.*uDyn;
    float rvC = 1.-smoothstep(R0+2., R0+5., dE), rvR = 1.-smoothstep(R0-1., R0+1.5, dE), rvT = 1.-smoothstep(R0-3.5, R0-1., dE);
    float wet = smoothstep(R0-.5, R0+3.5, dE)*rvC;                       // ink is darkest where it has just been laid
    // the sheet: old paper, stained, foxed and creased where it was folded
    float fib = noise(vec3(m0*vec2(9., 70.), 2.))*.5+noise(vec3(m0*38., 5.))*.5, stain = fbm(vec3(m0*.16, 3.));
    vec3 paper = vec3(.5,.39,.24)*(.8+.25*fib)*(.6+.75*stain);
    paper *= 1.-.35*smoothstep(.78,.9, noise(vec3(m0*.9, 11.)))*noise(vec3(m0*4., 2.));                    // foxing
    vec2 fold = abs(fract(m0/vec2(11., 8.)+.5)-.5)*vec2(11., 8.); float crease = min(fold.x, fold.y);
    paper *= 1.-.28*exp(-crease*9.)+.1*exp(-pow((crease-.12)/.07, 2.));
    float ink = 0., red = 0., blue = 0.;
    // rhumb lines from the wind rose, as on an old sea chart
    vec2 rc = (floor(m/34.)+.5)*34., rdv = m-rc; float ra = atan(rdv.y, rdv.x)/TAU*16.;
    ink += (1.-smoothstep(.4,1.4,abs(fract(ra-.5)-.5)/max(fwidth(ra), 1e-5)))*.1*smoothstep(1.5, 3., length(rdv));
    // relief: form lines in sepia, and a faded tint for height
    const float SEA = .5;
    float H = land(m), fH = max(fwidth(H), 1e-5), isLand = smoothstep(-1., 1., (H-SEA)/fH);
    float elev = clamp((H-SEA)/.24, 0., 1.), sF = spec(.04+elev*.8), sS = specS(.04+elev*.8), s = mix(sS, sF, .35);
    float iso = (H-SEA)*46., fi = max(fwidth(iso), 1e-5), isoM = iso/5., fM = max(fwidth(isoM), 1e-5);
    float minor = (1.-smoothstep(.2,1.1,abs(fract(iso-.5)-.5)/fi))*(1.-smoothstep(.3,.9,fi));
    float major = 1.-smoothstep(.6,1.6,abs(fract(isoM-.5)-.5)/fM);
    ink += (minor*.45+major*.8)*isLand*rvC*(.8+.6*wet);
    paper *= mix(vec3(1.), mix(vec3(.86,.9,.7), vec3(.92,.74,.55), elev), .5*isLand*rvC);
    glow += neon(.5+elev*.45)*(minor*.5+major*1.3)*s*s*isLand*rvC;       // each height glows with its own band
    // the sea: a faded blue wash, deeper inshore; waterlines echoing the coast; the coast itself in a firm line
    float off = (SEA-H)*46.;                                             // contours' worth of distance below the shore
    paper *= mix(vec3(1.), vec3(.5,.74,.78), (1.-isLand)*rvC*(.45+.4*exp(-off*.35)));
    float wl = (1.-smoothstep(.3,1.3,abs(fract(off*.5-.5-uTime*.02*(.5+uBassS))-.5)/max(fwidth(off*.5), 1e-5)))*smoothstep(4.5, .5, off)*(1.-isLand);
    blue += wl*.5*rvC; glow += neon(.62)*wl*uBassS*uBassS*.5*rvC;          // the waterlines stir with the bass
    ink += (1.-smoothstep(1.2, 2.8, abs(H-SEA)/fH))*.9*rvC;
    // rivers, in blue ink; the mids run down them
    float rv = noise(vec3(m*.07+13., 4.))-.5, rl = inkW(rv, 1.3, m)*isLand*smoothstep(.02,.2,elev)*rvC;
    blue += rl*.8; glow += neon(.62)*rl*uMid*uMid*(.5+.5*sin(noise(vec3(m*.25, 8.))*40.-uTime*3.))*1.3;
    // roads in red-brown; over water they are ferry lines, dashed. Strong beats send light out along them
    vec3 vr = vor(m/3.4); float er = vr.y-vr.x, dash = mix(smoothstep(.4,.6,fract((m.x+m.y)*1.6)), 1., isLand), road = inkW(er, 1.2, m)*dash*rvR;
    red += road*.6; glow += (neon(.12)*.6+.4)*road*ring(dE, 5., 1.1, 2.8)*.9*uAccent;
    // towns: founded, grown street by street, and in time faded from the map; each one listens to a band of its own
    vec3 vs = vor(m/.62); float st = lineW(vs.y-vs.x, .9), streets = 0., mark = 0., lab = 0.; vec3 tg = vec3(0.); vec2 tc = floor(m/TOWN);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
      vec2 c = tc+vec2(float(i), float(j)); float h1 = hash2(c+5.), h2 = hash2(c+71.), h3 = hash2(c+113.);
      vec2 T = (c+.25+.5*vec2(h1,h2))*TOWN;
      float ph = fract(uS*(.035+.02*h3)+h3*7.), life = smoothstep(0.,.2,ph)*(1.-smoothstep(.8,1.,ph)), g = smoothstep(0.,.55,ph);
      float d = length(m-T), rad = (.5+2.7*g)*(.7+.6*h1), fd = max(fwidth(d), 1e-5), tb = spec(.05+h2*.75), inTown = smoothstep(rad, rad-.5, d)*life;
      streets = max(streets, inTown*(1.+1.5*smoothstep(rad-.8, rad-.1, d)));
      tg += neon(.1+h2*.8)*inTown*tb*tb;                                  // its streets light with its band
      mark = max(mark, life*((1.-smoothstep(.07, .07+fd*1.5, d))+(1.-smoothstep(.5,1.8,abs(d-.16-.1*tb)/fd))));
      lab = max(lab, label(vec2((m0.x-T.x-.4)/3.7, (m0.y-T.y)/.575+.5), floor(h2*16.))*life*smoothstep(.2,.45,ph));
    }
    ink += st*streets*.4*isLand*rvT; glow += tg*st*isLand*rvT*1.2;
    red += mark*rvT; ink += lab*rvT*.9;
    // survey marks: one is made on every kick, larger for a harder one, and fades as the ink dries
    for (int i = 0; i < 8; i++){ vec2 d2 = abs(m-uMk[i].xy); float a = uPulse[i], f2 = max(fwidth(m.x), 1e-5), sz = uMk[i].z;
      float cr2 = max((1.-smoothstep(f2*.6, f2*1.6, d2.x))*step(d2.y, .3*sz), (1.-smoothstep(f2*.6, f2*1.6, d2.y))*step(d2.x, .3*sz));
      float rr = length(m-uMk[i].xy); cr2 += 1.-smoothstep(.5,1.8,abs(rr-.14*sz)/max(fwidth(rr), 1e-5));
      float lf = smoothstep(0.,.12,a)*(1.-smoothstep(2.,2.9,a)); red += cr2*lf*.9; glow += neon(.9)*cr2*lf*(1.-smoothstep(0.,.8,a))*1.2; }
    // the route travelled, in red, and where you are
    float sP = m.x/.5, dz = m.y-route(sP).y;
    red += lineW(dz, 1.4)*smoothstep(.3,.5,fract(sP*.9))*smoothstep(uS, uS-.6, sP)*(1.-smoothstep(uS-2., uS-26., sP))*.9;
    float fe = max(fwidth(dE), 1e-5), here = (1.-smoothstep(.06, .06+fe*1.5, dE))+(1.-smoothstep(.5,1.6,abs(dE-.17)/fe));
    red += here; glow += neon(.9)*here*(.3+.7*uKick);
    // lay the inks on the paper: sepia, a faded red, a faded blue; they have soaked in unevenly
    float soak = .75+.4*noise(vec3(m0*3.3, 9.));
    col = paper;
    col = mix(col, vec3(.1,.2,.28), clamp(blue*soak, 0., 1.)*.8);
    col = mix(col, vec3(.36,.08,.05), clamp(red*soak, 0., 1.)*.9);
    col = mix(col, vec3(.07,.045,.025), clamp(ink*soak, 0., 1.)*.92);
    col *= .42+.7*exp(-dE*dE*.006);                                       // lamplight on the table, falling off
    col += glow*.8;
  }
  // the title and the compass, drawn on the sheet's margin in the same ink
  float ov = label(vec2((q.x+uAspect-.07)/.66, (q.y+.9)/.1), 16.)*.9 + label(vec2((q.x+uAspect-.07)/.55, (q.y+.96)/.085), 17.)*.6;
  vec2 cq = q-vec2(uAspect-.19, -.74), nq = rot(uHead)*cq; float cr = length(cq);
  ov += (1.-smoothstep(.0015,.004,abs(cr-.1)))*.8 + (1.-smoothstep(.2,.3,abs(fract(atan(nq.x, nq.y)/TAU*16.-.5)-.5)))*step(abs(cr-.091), .006)*.6;
  float needle = (1.-smoothstep(0.,.003, abs(nq.x)-.014*(1.-abs(nq.y)/.078)))*step(cr, .078);
  ov += needle*(nq.y > 0. ? 1. : .35);
  col = mix(col, vec3(.06,.04,.02), clamp(ov, 0., 1.)*.85); depth = mix(depth, uFocusD, clamp(ov, 0., 1.));
  o = vec4(col, depth);
}`;
scene({ id: 'contour', name: 'Neon Cartography', from: 'Neon', kind: 'field', group: 'refined', pal: 5,
  about: 'A worn old map that draws itself: each height glows with its own band, waterlines stir with the bass, rivers run with the mids, every town listens to a band of its own, strong beats send light down the roads, and each kick leaves a survey mark',
  inputs: ['spec', 'specS', 'bassS', 'mid', 'kick', 'accent', 'pulse', 'dyn', 'travel', 'kickAmp'],
  cost: 'Moderate: one full-screen pass (two Voronoi lookups, nine town cells, one fbm) plus depth of field. Needs a text atlas from the platform. Phones: no depth of field.',
  post: { dof: { ap: 5, max: 6 }, bloom: 0.5, thr: 0.62, spread: 0.68, ca: 0.3, vig: 0.75, grain: 0.03, pulse: 0.1 },
  init() { this.p = program(VS, FS_MAP); this.text = textAtlas(MAP_NAMES, 4, 256, 40, 'italic 600 23px "Baskerville", "Palatino", "Book Antiqua", Georgia, serif');
    this.mk = new Float32Array(24); this.last = new Float32Array(8).fill(9); },
  draw(F, out) {
    const t = F.time, s = F.travel, C = [s * 0.5, 2.6 * Math.sin(s * 0.045) + 1.2 * Math.sin(s * 0.11)];
    for (let i = 0; i < 8; i++) { if (A.pulse[i] < this.last[i]) { const a = Math.random() * 6.283, r = 1.5 + Math.random() * 4.5; this.mk[i * 3] = C[0] + 2 + Math.cos(a) * r; this.mk[i * 3 + 1] = C[1] + Math.sin(a) * r * 0.8; this.mk[i * 3 + 2] = 0.5 + 0.9 * Math.min(1, A.kickAmp / 3) * Math.random() + 0.3 * Math.random(); } this.last[i] = A.pulse[i]; }
    const head = 0.3 * Math.sin(t * 0.04), D = 18.5 + 3 * A.dyn, el = 1.0;
    const em = [C[0] + Math.sin(head) * D * Math.cos(el), C[1] - Math.cos(head) * D * Math.cos(el)];
    const c = camera([-em[0], D * Math.sin(el), em[1]], [-C[0], 0, C[1]], 0.6, 0, 0.5, 200);
    draw(this.p, out, T.sw, T.sh, u => { F.set(u); setCam(u, c); bindTex(3, this.text.t); gl.uniform1i(u.uText, 3);
      gl.uniform1f(u.uS, s); gl.uniform1f(u.uHead, head); gl.uniform1f(u.uFocusD, D); gl.uniform3fv(u.uMk, this.mk); });
    F.focus = D;
  } });
}
