
// ───────────────────────── Nebula: inside a turning cloud of lit gas ─────────────────────────
{
// The whole frame is the cloud. It is marched at half resolution (it is soft; nothing is lost) and enlarged,
// with the stars added at full resolution behind it.
const FS_NEB = FSH + `
out vec4 o;
const float R = 1.25;
float dens(vec3 p, float r){
  p.xz = rot(uTime*.1+11.*(.11+.15/(.35+r)))*p.xz; p.xy = rot(.4)*p.xy;          // a whirlpool: sheared once into arms, then turning as one body, so it never winds up
  float w = noise(p*1.2+vec3(0.,uTime*.09,0.));
  p += (w-.5)*(1.15+.35*uDyn);
  float n = noise(p*2.2)*.56+noise(p*4.6+3.1)*.29+noise(p*9.3+7.7)*.15;
  float fil = 1.-abs(2.*n-1.); fil *= fil*fil;                                   // filaments where the noise folds
  float big = smoothstep(.38,.74, noise(p*.85+11.));                              // whole regions are empty, so the cloud has shape
  return (fil*fil*2.*big+n*n*n*.1)*(1.-smoothstep(.7,.98,r));
}
void main(){
  vec3 rd = viewRay(), ro = uEye;
  float b = dot(ro,rd), c = dot(ro,ro)-R*R, h = b*b-c;
  vec3 acc = vec3(0.); float tr = 1.;
  if (h > 0.){
    h = sqrt(h); float t0 = max(-b-h, 0.), t1 = -b+h;
    const int N = 36; float dt = (t1-t0)/float(N);
    float jit = fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(.06711056,.00583715))));
    for (int i = 0; i < N; i++){
      vec3 p = ro+rd*(t0+(float(i)+jit)*dt); float r = length(p)/1.25, d = dens(p, r);
      float bnd = fract(noise(p*1.15+7.)*1.7+r*.35), s = mix(specS(.03+bnd*.8), spec(.03+bnd*.8), .15);   // every wisp answers its own band
      float sh = ring(r, .7, .07, 1.9)*(.4+.6*noise(p*2.3+1.));                        // a shell of light leaves the heart on every kick and fades as it goes
      vec3 e = neon(.5+r*.3+d*.12+noise(p*.7+4.)*.3)*d*(.1+1.05*s*s+1.1*sh);
      e += (neon(.12)*.55+.45)*exp(-r*r*110.)*(.3+.5*uBassS+.3*uKick);     // the star at the heart
      acc += tr*e*dt*1.25; tr *= exp(-d*dt*1.5);
    }
  }
  o = vec4(acc, tr);
}`;
const FS_NEB_UP = FSH + `
out vec4 o; uniform sampler2D uLo;
void main(){ vec3 rd = viewRay(); vec2 uv = gl_FragCoord.xy/uRes, e = 1.2/uRes; vec4 n = texture(uLo, uv);
  vec4 bl = (texture(uLo, uv+vec2(e.x,0.))+texture(uLo, uv-vec2(e.x,0.))+texture(uLo, uv+vec2(0.,e.y))+texture(uLo, uv-vec2(0.,e.y)))*.25;
  n.rgb = max(n.rgb+(n.rgb-bl.rgb)*.9, 0.);                                      // a little sharpening gives the filaments back their edge
  vec3 bg = vec3(.003,.0035,.009) + vivid(.62)*.012*fbm(rd*2.3+2.) + stars(rd)*.8;
  o = vec4(bg*n.a+n.rgb, 1.); }`;
scene({ id: 'nebula', name: 'Nebula', from: 'Claude', kind: 'field', group: 'refined', pal: 0, hue: t => 0.05 * Math.sin(t * 0.045),
  about: 'A whirlpool of lit gas filling the frame: every wisp answers its own band, and each kick sends a faint, broken shell of light out through it',
  inputs: ['spec', 'specS', 'bassS', 'kick', 'pulse', 'dyn', 'drop'],
  cost: 'Heavy: a 36-step volume march with six noise lookups a step, done at two-thirds resolution. Phones: 20 steps at a third. TVs: 28 steps.',
  post: { trail: 0.3, bloom: 0.55, thr: 0.8, knee: 0.6, spread: 0.72, exp: 1.0, ca: 0.5, pulse: 0.15 },
  init() { this.p = program(VS, FS_NEB); this.up = program(VS, FS_NEB_UP); },
  draw(F, out) {
    const t = F.time, lo = RTs('nebulaLo', 1.5);
    const c = camera(orbit(t * 0.05, 0.12 + Math.sin(t * 0.045) * 0.16, 1.72), [Math.sin(t * 0.07) * 0.22, Math.sin(t * 0.05) * 0.14, Math.cos(t * 0.06) * 0.15], 0.8, Math.sin(t * 0.04) * 0.2, 0.1, 60);
    draw(this.p, lo, lo.w, lo.h, u => { F.set(u); setCam(u, c); gl.uniform2f(u.uRes, lo.w, lo.h); });
    draw(this.up, out, T.sw, T.sh, u => { F.set(u); setCam(u, c); bindTex(3, lo.t); gl.uniform1i(u.uLo, 3); });
  } });
}
