
// ───────────────────────── Ferrofluid: a pool of black liquid seen from above, pulled into fields of spikes ─────────────────────────
{
// Three magnets wander under the dish, one each for bass, mids and highs; where their pull passes a threshold
// the flat liquid breaks into a hexagonal lattice of spikes (as the real fluid does), and below it into
// meandering channels. Every kick sends a ring of spikes running outward.
const POOL_FN = `
uniform vec3 uMag[3];                       // x, z and strength of each magnet
const float SP = .36;
vec2 hexC(vec2 p, out vec2 id){             // offset to the nearest centre of a hexagonal lattice, and that centre
  const vec2 s = vec2(1., 1.7320508);
  vec2 a = (floor(p/s)+.5)*s, b = (floor((p-s*.5)/s)+.5)*s+s*.5, da = p-a, db = p-b;
  if (dot(da,da) < dot(db,db)){ id = a; return da; } id = b; return db; }
float field(vec2 c){
  float f = 0.;
  for (int i = 0; i < 3; i++){ vec2 d = c-uMag[i].xy; f += uMag[i].z*exp(-dot(d,d)*.75); }
  float r = length(c);
  f += specS(.03+r*.1)*.3*exp(-r*.22);                    // rings of the spectrum, bass in the middle
  f += ring(r, 3.4, .6, 2.1)*.8;                          // every kick: a ring of spikes runs outward
  return min(f*(.5+.6*uDyn), 1.3); }
vec2 poolH(vec2 p){                                       // height, and the pull there
  vec2 q = p+.44*(vec2(noise(vec3(p*.33, uTime*.06)), noise(vec3(p*.33+9.1, uTime*.06)))-.5);   // the lattice is alive: it drifts and shears
  vec2 id; vec2 d = hexC(q/SP, id); float x = sqrt(dot(d,d)+.003)/.5, A = field(id*SP);
  float on = smoothstep(.34, .95, A), tip = max(1.-x, 0.);
  float h = on*(.15+.85*A*A)*.5*tip*tip;
  float lab = sin((q.x*.8+q.y*.6)*9.+noise(vec3(q*1.2, uTime*.1))*9.);
  h += smoothstep(.06,.3,A)*(1.-on)*.05*(.5+.5*lab);                                            // channels, where the pull is weak
  h += .05*sin(p.x*.9+uTime*.7)*sin(p.y*.8-uTime*.5)*(.4+uBassS);
  return vec2(h, A); }`;
const VS_POOL = VSH + POOL_FN + `
out vec3 vW, vN; out float vDepth, vA;
void main(){
  vec2 p = (aUV*2.-1.)*vec2(6.4, 5.4)+vec2(0., .6); const float e = .03;
  vec2 h = poolH(p); float hx = poolH(p+vec2(e,0.)).x, hz = poolH(p+vec2(0.,e)).x;
  vW = vec3(p.x, h.x, p.y); vN = normalize(vec3(h.x-hx, e, h.x-hz)); vA = h.y;
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_POOL = FSH + `
in vec3 vW, vN; in float vDepth, vA; out vec4 o;
float softbox(vec3 r, vec3 ld, vec3 tx, vec2 size, float soft){ float c = dot(r, ld); if (c <= 0.) return 0.;
  vec3 ty = cross(ld, tx); vec2 q = abs(vec2(dot(r,tx), dot(r,ty))/c); vec2 a = smoothstep(size+soft, size-soft, q); return a.x*a.y; }
vec3 studio(vec3 r){
  vec3 cA = neon(.62), cB = neon(.12);
  vec3 col = vec3(.01,.012,.02)*(.4+.6*r.y);
  col += mix(cA, cB, smoothstep(-.7,.7,r.x))*exp(-max(r.y,0.)*3.5)*.22*(.4+uBassS+uKick);                       // the far wall, washed in two colours
  col += softbox(r, normalize(vec3(-.25,.9,.35)), vec3(.9,.1,.4), vec2(.34,.2), .2)*vec3(1.,.97,.93)*(1.1+1.6*uKick);   // key, overhead
  col += softbox(r, normalize(vec3(.93,.3,.2)), vec3(0.,1.,0.), vec2(1.1,.07), .03)*(cB*.8+.2)*10.*(.3+1.7*uMid);     // strip, right
  col += softbox(r, normalize(vec3(-.93,.28,-.1)), vec3(0.,1.,0.), vec2(1.2,.09), .04)*(cA*.85+.15)*10.*(.3+1.8*uBass); // strip, left
  float a = acos(clamp(dot(r, normalize(vec3(.1,.75,-.65))),-1.,1.));
  col += exp(-abs(a-.3)*70.)*vec3(1.4)*(.4+2.*uHigh);                                                           // ring light
  return col; }
void main(){
  vec3 n = normalize(vN), v = normalize(vW-uEye), r = reflect(v, n);
  float c = max(dot(n,-v),0.), fr = .055+.945*pow(1.-c, 5.), hn = clamp(vW.y/.55, 0., 1.);
  float ao = mix(1., mix(.25, 1., smoothstep(0.,.4,hn)), smoothstep(.34,.8,vA));     // the valleys between spikes are shadowed
  vec3 col = studio(r)*fr*ao + vec3(.003,.004,.007)*ao;
  col += neon(.1+vA*.4)*pow(hn, 5.)*(.25+.7*uKick+.9*uKickL);                        // the tallest tips run hot
  float rr = length((vW.xz-vec2(0.,.6))/vec2(1.18,1.));
  col *= 1.-smoothstep(3.9, 5.3, rr);                                                // the dish falls away into the dark
  o = vec4(col, vDepth);
}`;
scene({ id: 'pool', name: 'Ferrofluid', from: 'Fable', kind: 'field', group: 'refined', pal: 0,
  about: 'A pool of black liquid from above: three wandering magnets (bass, mids, highs) pull it into fields of spikes and channels, and every kick sends a ring of spikes outward',
  inputs: ['specS', 'bassS', 'midS', 'highS', 'bass', 'mid', 'high', 'kick', 'kickL', 'pulse', 'dyn'],
  cost: 'Vertex-heavy: 295k triangles with three height lookups a vertex, plus depth of field. Phones: the 192 grid, no depth of field.',
  post: { dof: { ap: 8, max: 7 }, bloom: 0.45, thr: 1.0, knee: 0.7, spread: 0.72, exp: 1.15, ca: 0.4, vig: 0.9 },
  init() { this.body = program(VS_POOL, FS_POOL); this.mag = new Float32Array(9); },
  draw(F, out) {
    const t = F.time, m = this.mag, tgt = [0, 0.1, 0.5];
    m.set([Math.sin(t * 0.23) * 2.3, Math.cos(t * 0.19) * 1.7 + 0.6, 0.25 + A.bassS * 1.5,
           Math.sin(t * 0.31 + 2.1) * 2.9, Math.cos(t * 0.27 + 1.3) * 2.1 + 0.6, 0.15 + A.midS * 1.6,
           Math.sin(t * 0.41 + 4.2) * 3.1, Math.cos(t * 0.37 + 3.7) * 2.3 + 0.6, 0.1 + A.highS * 1.8]);
    const eye = [Math.sin(t * 0.05) * 1.6, 6.3 - A.kick * 0.18, -4.9];
    const c = camera(eye, tgt, 0.62, Math.sin(t * 0.04) * 0.06, 0.2, 80); F.focus = Math.hypot(...sub(eye, tgt)) * 0.98;
    beginMS(); gl.enable(gl.DEPTH_TEST);
    mesh(this.body, grid(384), u => { F.set(u); setCam(u, c); gl.uniform3fv(u.uMag, m); });
    endMS(out);
  } });
}
