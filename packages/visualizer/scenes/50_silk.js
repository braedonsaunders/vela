
// ───────────────────────── Silk: two million particles drawn off two rings into sheets of woven light ─────────────────────────
{
const SILK_W = 2048, SILK_H = 1024, SILK_THREADS = 1500;
// A divergence-free flow built from a handful of sine modes: the curl of ψ = Σ e·sin(k·p+φ) is Σ (k×e)·cos(k·p+φ).
const SILK_FLOW = `
vec3 flow(vec3 p, float t){
  vec3 v = cross(vec3(.9,.3,-.5), vec3(0.,1.,0.))*cos(dot(vec3(.9,.3,-.5),p)+t*1.1);
  v += cross(vec3(-.4,1.1,.6), vec3(1.,0.,0.))*cos(dot(vec3(-.4,1.1,.6),p)-t*.9+1.3);
  v += cross(vec3(.5,-.7,1.2), vec3(0.,0.,1.))*cos(dot(vec3(.5,-.7,1.2),p)+t*.7+2.1)*.9;
  v += cross(vec3(1.7,.6,.9), vec3(0.,1.,0.))*cos(dot(vec3(1.7,.6,.9),p)-t*1.6+.4)*.45;
  v += cross(vec3(-1.3,1.9,-.8), vec3(1.,0.,0.))*cos(dot(vec3(-1.3,1.9,-.8),p)+t*1.9+4.)*.35;
  v += cross(vec3(2.6,-1.4,2.1), vec3(0.,0.,1.))*cos(dot(vec3(2.6,-1.4,2.1),p)+t*2.6+5.2)*.16;
  return v; }
vec3 wind(vec3 p){ return flow(p*1.15, uTime*.22)*(.34+.7*uMidS+.2*uDyn) + vec3(-p.z, 0., p.x)*.5; }`;
const FS_SILK_SIM = HEAD + LIB + SILK_FLOW + `
uniform sampler2D uState; uniform float uDt; out vec4 o;
void main(){
  ivec2 ij = ivec2(gl_FragCoord.xy); vec4 s = texelFetch(uState, ij, 0);
  float h1 = hash2(vec2(ij)+.5), h2 = hash2(vec2(ij)*1.7+9.1), h3 = hash2(vec2(ij)*.61+3.7);
  vec3 p = s.xyz; float life = s.w;
  vec3 v = wind(p);
  v -= p*smoothstep(1.9, 3.4, length(p))*.6;                     // a soft wall
  v += normalize(p+1e-4)*uKick*1.7;                              // each beat pushes the cloth outward
  p += v*uDt; life -= uDt*(.2+.08*h3);
  if (life <= 0.){
    // every particle belongs to one of a fixed set of threads, so the cloud reads as drawn lines
    float n = floor(h1*${SILK_THREADS}.), th = (n+.5)/${SILK_THREADS}., a = th*TAU+uTime*.05, R = .62+.22*uBassS;
    if (fract(n*.381966) < .34){                                 // a third of the threads leave from a second, smaller, tilted ring
      p = vec3(cos(a*2.)*R*.5, sin(a*2.)*R*.5, .1*sin(a*10.+uTime*.7)); p.yz = rot(.9)*p.yz; p.xz = rot(uTime*.07)*p.xz; }
    else p = vec3(cos(a)*R, .22*sin(a*3.+uTime*.5)+.07*sin(a*7.-uTime*.9), sin(a)*R);
    p += (vec3(h2,h3,fract(h2*37.))-.5)*.0028;
    life = s.w == 0. ? h2 : 1.;
  }
  o = vec4(p, life);
}`;
// Each point is shaded as a piece of thread running along the flow: light glances off a fibre in a band
// across it (the Kajiya–Kay model for hair and cloth, 1989), which is what gives the sheets their sheen.
const VS_SILK = HEAD + LIB + SILK_FLOW + `
uniform sampler2D uState; uniform float uFocus, uAp, uDpr; out vec3 vCol;
void main(){
  ivec2 ij = ivec2(gl_VertexID % ${SILK_W}, gl_VertexID / ${SILK_W}); vec4 s = texelFetch(uState, ij, 0);
  float h1 = hash2(vec2(ij)+.5); vec3 p = s.xyz;
  gl_Position = uVP*vec4(p,1.); float d = max(gl_Position.w, .05);
  float size = max(1., abs(d-uFocus)/d*uAp)*uDpr; gl_PointSize = min(size, 40.);
  float fade = smoothstep(0.,.12,s.w)*smoothstep(1.,.96,s.w)*smoothstep(2.7,1.7,length(p));
  float th = (floor(h1*${SILK_THREADS}.)+.5)/${SILK_THREADS}., band = abs(th*2.-1.), sp = spec(.02+band*.8);
  float lead = fract(sin(th*9173.3)*43758.5);                                // a few threads are drawn brighter
  vec3 T = normalize(wind(p)+1e-4), V = normalize(uEye-p), L = normalize(vec3(.45,.8,.35)), H = normalize(L+V);
  float th_ = dot(T,H), sheen = pow(max(1.-th_*th_, 0.), 48.), tl = dot(T,L), diff = sqrt(max(1.-tl*tl, 0.));
  float back = pow(max(dot(V, -L), 0.), 3.);                                 // and glows where the light is behind the cloth
  vec3 base = vivid(.5+band*.42+length(p)*.06+s.w*.14);                      // colour drifts along a thread as it ages
  vec3 c = base*(.02+.16*diff+.3*back)*(.35+1.7*sp*sp) + (base*.4+.6)*sheen*(.22+1.5*sp*sp+.5*uKick);
  vCol = c*(.45+1.6*lead*lead)*fade*(1.5/(size*size));
}`;
const FS_SILK_BG = FSH + `
out vec4 o;
void main(){ vec2 q = (gl_FragCoord.xy*2.-uRes)/uRes.y; float r = length(q);
  o = vec4(vec3(.003,.0035,.008)*(1.2-r*.4) + vivid(.62)*.014*exp(-r*r*1.5)*(.5+uBassS+.6*uKick), 1.); }`;
scene({ id: 'silk', name: 'Silk', from: 'Fable', kind: 'field', group: 'refined', pal: 0,
  about: 'Two million particles drawn off two rings along fixed threads by a curl field, lit like real silk: sheets of woven light with a moving sheen',
  inputs: ['spec', 'midS', 'bassS', 'kick', 'dyn'],
  cost: 'Heavy on fill and memory: two million additive points and two 2048×1024 float textures. Phones: 260k particles (512²). TVs: one million.',
  post: { trail: 0.5, bloom: 0.6, thr: 0.35, ca: 0.6 },
  init() { this.sim = program(VS, FS_SILK_SIM); this.pts = program(VS_SILK, FS_POINT); this.bg = program(VS, FS_SILK_BG);
    this.a = simTarget(SILK_W, SILK_H, gl.RGBA32F, gl.NEAREST); this.b = simTarget(SILK_W, SILK_H, gl.RGBA32F, gl.NEAREST); },
  draw(F, out) {
    draw(this.sim, this.b, SILK_W, SILK_H, u => { F.set(u); bindTex(3, this.a.t); gl.uniform1i(u.uState, 3); gl.uniform1f(u.uDt, Math.min(F.dt, 1 / 30)); });
    [this.a, this.b] = [this.b, this.a];
    const t = F.time, R = 5.6 - A.kick * 0.15, c = camera(orbit(t * 0.08, 0.42 + Math.sin(t * 0.06) * 0.25, R), [0, 0, 0], 0.72, 0, 0.1, 60);
    beginTo(out); quad(this.bg, u => { F.set(u); setCam(u, c); });
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    points(this.pts, SILK_W * SILK_H, u => { F.set(u); setCam(u, c); bindTex(3, this.a.t); gl.uniform1i(u.uState, 3);
      gl.uniform1f(u.uFocus, R * 0.95); gl.uniform1f(u.uAp, 5.5); gl.uniform1f(u.uDpr, F.px); });
  } });
}
