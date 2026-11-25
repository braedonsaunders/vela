
// ───────────────────────── Neon Cartography: a map that surveys and draws itself as the music plays ─────────────────────────
{
// A flat sheet seen at an angle, like a map on a light table. Everything on it is a line: contours (each
// elevation is a band and lights with it), coast and soundings, rivers, a road network, towns that are
// founded, grow street by street and fade, their names, survey marks dropped on every kick, and the route
// travelled so far. The surveyed area widens as the music fills out; a ring sweeps it on every kick.
const MAP_NAMES = ['PORT LEGATO', 'CADENCE', 'TREBLE REACH', 'LARGO BAY', 'ALLEGRO PASS', 'FERMATA', 'OCTAVE RIDGE', 'CODA',
  'VIVACE', 'ADAGIO FLATS', 'MINOR FALLS', 'SEGUE', 'TEMPO', 'RUBATO', 'ARIA SOUND', 'OSTINATO', 'NEON CARTOGRAPHY', 'SURVEY IN PROGRESS', '', ''];
const FS_MAP = FSH + `
out vec4 o; uniform sampler2D uText; uniform float uS, uHead, uFocusD; uniform vec2 uMk[8];
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
void main(){
  vec3 rd = viewRay(); float depth = 200.; vec3 col = vec3(.002,.004,.008);
  vec2 q = (gl_FragCoord.xy*2.-uRes)/uRes.y, C = route(uS);
  if (rd.y < -.01){
    float t = -uEye.y/rd.y; vec3 P = uEye+rd*t; depth = t;
    vec2 m = vec2(-P.x, P.z);                                            // map coordinates: east to the right, north away from you
    float dE = length(m-C), R0 = 8.5+8.*uDyn+.5*uKick;
    float rvC = 1.-smoothstep(R0+2., R0+5., dE), rvR = 1.-smoothstep(R0-1., R0+1.5, dE), rvT = 1.-smoothstep(R0-3.5, R0-1., dE);
    float wet = smoothstep(R0-.5, R0+3.5, dE)*rvC;                       // lines are brightest where they have just been drawn
    float ping = ring(dE, 9., .35, 1.8);                                 // each kick: a survey ring sweeps out from where you are
    float glow = 1.+1.8*ping+1.6*wet+.6*uDrop;
    // the sheet and its graticule
    vec2 gr = m/2.5, gf = abs(fract(gr-.5)-.5)/max(fwidth(gr), 1e-5), gr2 = m/12.5, gf2 = abs(fract(gr2-.5)-.5)/max(fwidth(gr2), 1e-5);
    col += neon(.55)*((1.-smoothstep(.4,1.4,min(gf.x,gf.y)))*.016+(1.-smoothstep(.6,1.8,min(gf2.x,gf2.y)))*.05);
    col += vec3(.003,.005,.008)*noise(vec3(m*3., 2.));
    // relief: contours, each elevation a band
    const float SEA = .5;
    float H = land(m), fH = max(fwidth(H), 1e-5), isLand = smoothstep(-1., 1., (H-SEA)/fH);
    float elev = clamp((H-SEA)/.24, 0., 1.), s = spec(.04+elev*.8);
    float iso = (H-SEA)*46., fi = max(fwidth(iso), 1e-5), isoM = iso/5., fM = max(fwidth(isoM), 1e-5);
    float minor = (1.-smoothstep(.3,1.3,abs(fract(iso-.5)-.5)/fi))*(1.-smoothstep(.3,.9,fi));
    float major = 1.-smoothstep(.7,1.9,abs(fract(isoM-.5)-.5)/fM);
    vec3 lc = neon(.5+elev*.45);
    col += (lc*(minor*(.06+.65*s*s)+major*(.26+1.3*s*s))+lc*elev*elev*.014)*isLand*rvC*glow;
    // water: a wash, wave hatching near the shore, and the coast as the brightest line
    vec3 wc = neon(.62); float deep = clamp((SEA-H)/.22, 0., 1.), hy = m.y*3.+sin(m.x*1.3)*.3, fh = max(fwidth(hy), 1e-5);
    float hatch = (1.-smoothstep(.2,.9,abs(fract(hy-.5)-.5)/fh))*(1.-smoothstep(.2,.7,fh));
    col += wc*(.01+.022*deep+hatch*.035*(1.-deep))*(1.-isLand)*rvC;
    col += (wc*.6+.4)*(1.-smoothstep(1., 2.4, abs(H-SEA)/fH))*(.45+.8*uBassS)*rvC*glow;
    // rivers
    float rv = noise(vec3(m*.07+13., 4.))-.5;
    col += (wc*.7+.3)*lineW(rv, 1.3)*isLand*smoothstep(.02,.2,elev)*(.3+.3*sin(noise(vec3(m*.25, 8.))*40.-uTime*3.))*rvC*glow;
    // roads: a network between places; over water they are ferry lines, dashed
    vec3 vr = vor(m/3.4); float er = vr.y-vr.x;
    float dash = mix(smoothstep(.4,.6,fract((m.x+m.y)*1.6)), 1., isLand);
    vec3 rc = neon(.12)*.55+.45;
    col += rc*(lineW(er, 1.1)*dash*(.3+.4*uLevel)*(1.+2.*ping+2.*wet)+exp(-er*30.)*.02*isLand)*rvR;
    // towns: founded, grown street by street, and in time faded from the map
    vec3 vs = vor(m/.62); float st = lineW(vs.y-vs.x, .9), streets = 0., mark = 0., lab = 0.; vec2 tc = floor(m/TOWN);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
      vec2 c = tc+vec2(float(i), float(j)); float h1 = hash2(c+5.), h2 = hash2(c+71.), h3 = hash2(c+113.);
      vec2 T = (c+.25+.5*vec2(h1,h2))*TOWN;
      float ph = fract(uS*(.035+.02*h3)+h3*7.), life = smoothstep(0.,.2,ph)*(1.-smoothstep(.8,1.,ph)), g = smoothstep(0.,.55,ph);
      float d = length(m-T), rad = (.5+2.7*g)*(.7+.6*h1), fd = max(fwidth(d), 1e-5);
      streets = max(streets, smoothstep(rad, rad-.5, d)*life*(1.+2.5*smoothstep(rad-.8, rad-.1, d)));       // brightest at the growing edge
      mark = max(mark, life*((1.-smoothstep(.08, .08+fd*1.5, d))+(1.-smoothstep(.5,1.8,abs(d-.2)/fd))+ring(d, 2.4, .06, 1.3)*.45*exp(-d*.7)));
      lab = max(lab, label(vec2((m.x-T.x-.4)/3.7, (m.y-T.y)/.575+.5), floor(h2*16.))*life*smoothstep(.2,.45,ph));
    }
    col += rc*st*streets*.45*isLand*rvT;
    col += (neon(.9)*.5+.5)*mark*rvT*(1.+uKick);
    col += vec3(.9,.95,1.)*lab*rvT*.85;
    // survey marks: one is dropped on every kick, and fades
    for (int i = 0; i < 8; i++){ vec2 d2 = abs(m-uMk[i]); float a = uPulse[i], f2 = max(fwidth(m.x), 1e-5);
      float cross2 = max((1.-smoothstep(f2*.6, f2*1.6, d2.x))*step(.06, d2.y)*step(d2.y, .26), (1.-smoothstep(f2*.6, f2*1.6, d2.y))*step(.06, d2.x)*step(d2.x, .26));
      float rr = length(m-uMk[i]); cross2 += 1.-smoothstep(.5,1.8,abs(rr-.1-.12*smoothstep(0.,.5,a))/max(fwidth(rr), 1e-5));
      col += (neon(.9)*.6+.4)*cross2*smoothstep(0.,.12,a)*(1.-smoothstep(2.,2.9,a))*.8; }
    // the route travelled, and where you are
    float sP = m.x/.5, dz = m.y-route(sP).y;
    col += (neon(.9)*.7+.3)*lineW(dz, 1.4)*smoothstep(.3,.5,fract(sP*.9))*smoothstep(uS, uS-.6, sP)*(1.-smoothstep(uS-2., uS-26., sP))*.9;
    float fe = max(fwidth(dE), 1e-5);
    col += vec3(1.)*((1.-smoothstep(.06, .06+fe*1.5, dE))+(1.-smoothstep(.5,1.6,abs(dE-.17-.1*uKick)/fe)))*.9;
  }
  // the cartouche and the compass sit on the glass, in focus
  float ov = label(vec2((q.x+uAspect-.07)/.66, (q.y+.9)/.1), 16.)*.55 + label(vec2((q.x+uAspect-.07)/.55, (q.y+.96)/.085), 17.)*.3*(.6+.4*sin(uTime*2.));
  vec2 cq = q-vec2(uAspect-.19, -.74), nq = rot(uHead)*cq; float cr = length(cq);
  ov += (1.-smoothstep(.0015,.004,abs(cr-.1)))*.7 + (1.-smoothstep(.2,.3,abs(fract(atan(nq.x, nq.y)/TAU*16.-.5)-.5)))*step(abs(cr-.091), .006)*.5;
  float needle = (1.-smoothstep(0.,.003, abs(nq.x)-.014*(1.-abs(nq.y)/.078)))*step(cr, .078);
  ov += needle*(nq.y > 0. ? 1. : .25);
  col += vec3(.75,.9,1.)*ov*.7; depth = mix(depth, uFocusD, clamp(ov, 0., 1.));
  o = vec4(col, depth);
}`;
scene({ id: 'contour', name: 'Neon Cartography', from: 'Neon', kind: 'field', group: 'refined', pal: 5,
  about: 'A map that draws itself: contours light with their bands, towns are founded and grow street by street, a survey ring sweeps on every kick, and the charted area widens as the music fills out',
  inputs: ['spec', 'bassS', 'level', 'kick', 'pulse', 'dyn', 'drop', 'travel'],
  cost: 'Moderate: one full-screen pass (two Voronoi lookups, nine town cells, one fbm) plus depth of field. Needs a text atlas from the platform. Phones: no depth of field.',
  post: { dof: { ap: 5, max: 6 }, bloom: 0.5, thr: 0.65, spread: 0.68, ca: 0.35, vig: 0.9 },
  init() { this.p = program(VS, FS_MAP); this.text = textAtlas(MAP_NAMES, 4, 256, 40, '600 21px "Avenir Next", "Helvetica Neue", "Segoe UI", system-ui, sans-serif');
    this.mk = new Float32Array(16); this.last = new Float32Array(8).fill(9); },
  draw(F, out) {
    const t = F.time, s = F.travel, C = [s * 0.5, 2.6 * Math.sin(s * 0.045) + 1.2 * Math.sin(s * 0.11)];
    for (let i = 0; i < 8; i++) { if (A.pulse[i] < this.last[i]) { const a = Math.random() * 6.283, r = 1.5 + Math.random() * 4.5; this.mk[i * 2] = C[0] + 2 + Math.cos(a) * r; this.mk[i * 2 + 1] = C[1] + Math.sin(a) * r * 0.8; } this.last[i] = A.pulse[i]; }
    const head = 0.3 * Math.sin(t * 0.04), D = 18.5 + 3 * A.dyn - 0.5 * A.kick, el = 1.0;
    const em = [C[0] + Math.sin(head) * D * Math.cos(el), C[1] - Math.cos(head) * D * Math.cos(el)];
    const c = camera([-em[0], D * Math.sin(el), em[1]], [-C[0], 0, C[1]], 0.6, 0, 0.5, 200);
    draw(this.p, out, T.sw, T.sh, u => { F.set(u); setCam(u, c); bindTex(3, this.text.t); gl.uniform1i(u.uText, 3);
      gl.uniform1f(u.uS, s); gl.uniform1f(u.uHead, head); gl.uniform1f(u.uFocusD, D); gl.uniform2fv(u.uMk, this.mk); });
    F.focus = D;
  } });
}
