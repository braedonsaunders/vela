
// ───────────────────────── Aurora: curtains of light over a still lake ─────────────────────────
{
// The curtains are marched at half resolution; the stars, the mountains, the pines on the near shore and the
// lake are drawn at full resolution over that, and the lake mirrors the curtains by reading the same texture.
const AUR_CAM = `
uniform float uYaw;
vec2 scr(){ return (gl_FragCoord.xy*2.-uRes)/uRes.y; }
vec3 dirOf(vec2 q){ vec3 rd = normalize(vec3(q.x, q.y+.46, 1.55)); rd.xz = rot(uYaw)*rd.xz; return rd; }`;
// Three curtains hang across the sky, one behind another: the near one is the bass, the middle one the mids,
// the far one the highs, and along each the pitch runs from left to right. A curtain is a wandering line on the
// map (so it folds, and is brightest where you look along a fold); each stretch of it hangs as tall as its band
// is loud. The march takes fourteen samples through the depth of each curtain.
const FS_AUR = FSH + AUR_CAM + `
out vec4 o;
float curtZ(float fi, float x){ float t = uTime;
  return 7.+fi*5.5+1.6*sin(x*.21+t*.05+fi*2.)+.9*sin(x*.53-t*.08+fi*4.)+(.3+.45*uDyn)*sin(x*1.37+t*.21+fi)+.12*sin(x*3.9-t*.5+fi*5.); }
void main(){
  vec3 rd = dirOf(scr()), acc = vec3(0.);
  if (rd.y > .0){
    vec2 hd = normalize(rd.xz); float tanEl = rd.y/length(rd.xz);
    float jit = fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(.06711056,.00583715))));
    for (int ci = 0; ci < 3; ci++){ float fi = float(ci), z0 = 7.+fi*5.5, r0 = (z0-3.6)/hd.y, dr = 7.2/hd.y/14.;
      for (int s = 0; s < 14; s++){
        float rho = r0+(float(s)+jit)*dr; vec2 p = hd*rho; float alt = rho*tanEl;
        float dz = p.y-curtZ(fi, p.x), dens = exp(-dz*dz/.2);
        if (dens < .004 || alt > 11.) continue;
        float f = clamp(.5+p.x/(z0*1.7), 0., 1.), band = .02+(fi+f)*.27, sS = specS(band), sm = mix(sS, spec(band), .2);
        float base = 1.5+.55*fi+.22*sin(p.x*.4+fi*3.+uTime*.1), top = base+.5+5.5*sS*sS*(.5+.7*uDyn), h = (alt-base)/(top-base);
        if (h < 0.) continue;
        float prof = smoothstep(0.,.05,h)*exp(-h*2.7);                                       // a sharp lower hem, fading upward
        float rays = .3+.7*pow(noise(vec3(p.x*4.6+fi*17., uTime*.4, fi*3.)), 2.)*(.6+.8*noise(vec3(p.x*15.+fi*5., uTime*.7, 2.)));   // the fine rays, shimmering
        float run = ring(abs(p.x), 12., 1.5, 1.7), up = ring(h, .9, .15, 1.2);               // each kick: light runs out along the curtains, and climbs them
        vec3 c = neon(.02+h*.5+fi*.035);
        c += neon(.6)*smoothstep(0.,.03,h)*(1.-smoothstep(.03,.12,h))*sm*sm*1.6;             // a second colour along the hem when its band is loud
        acc += c*dens*prof*rays*(.22+2.3*sm*sm+.65*run+.4*up+.25*uDrop)*dr*exp(-rho*.025)*(1.-.18*fi);
      } }
    acc *= .95;
  }
  o = vec4(acc, 1.);
}`;
const FS_AUR_UP = FSH + AUR_CAM + `
out vec4 o; uniform sampler2D uLo;
float skyline(float az){ float x = az*2.6+11., h = 0., a = .55;
  for (int i = 0; i < 4; i++){ h += a*(1.-abs(2.*noise(vec3(x, 3.7, float(i)))-1.)); x *= 2.1; a *= .5; }
  return .012+.085*h*h; }
float pines(float az, float el){                       // the near shore: black conifers either side, the middle left open
  float m = smoothstep(.22,.6,abs(az)), x = az*14., cov = 0.;
  for (int j = -2; j <= 2; j++){ float c = floor(x)+float(j), hh = hash2(vec2(c, 3.)), ac = (c+.5+(hh-.5)*.8)/14.;
    float top = -.26+m*(.2+.42*hash2(vec2(c, 9.))), dy = top-el;
    if (dy > 0.){ float hw = (.004+dy*.17*(.5+.5*(1.-fract(dy*24.+hh*3.))))*(.8+.5*hh);      // tiers of branches, wider toward the ground
      cov = max(cov, smoothstep(hw+.0025, hw-.0025, abs(az-ac))); } }
  return cov; }
vec3 lo(vec2 q){ vec2 uv = (q*uRes.y+uRes)*.5/uRes; return uv.y < 1. ? texture(uLo, uv).rgb : vec3(0.); }
vec3 sky(vec2 q, float st){ vec3 rd = dirOf(q); float az = atan(rd.x, rd.z);
  vec3 col = mix(vec3(.004,.012,.02), vec3(.0015,.002,.006), smoothstep(0.,.6,rd.y)) + neon(.05)*.012*exp(-rd.y*6.);
  col += vec3(.012,.014,.022)*smoothstep(.35,.8, fbm(vec3(rd.xy*3.+rd.z, 5.)))*smoothstep(.1,.5,rd.y)*st;      // a faint river of stars
  col += stars(rd)*.8*st*smoothstep(.02,.2,rd.y);
  col += lo(q);
  float m = skyline(az);
  vec3 glow = lo(vec2(q.x, .25))*.03;                                       // snow on the peaks takes a little of the light
  return mix(col, vec3(.0012,.002,.004)+glow*smoothstep(.3,1.,rd.y/m), smoothstep(m+.004, m-.004, rd.y)); }
void main(){
  vec2 q = scr(); vec3 rd = dirOf(q), col;
  if (rd.y >= 0.) col = sky(q, 1.);
  else {                                                                    // the lake: the same sky, upside down and gently rippled
    float t = .35/(-rd.y); vec2 g = rd.xz*t;
    float rip = (noise(vec3(g*vec2(3.,9.), uTime*.35))-.5)+(noise(vec3(g*vec2(9.,26.)+4., uTime*.6))-.5)*.5;
    vec2 qm = vec2(q.x+rip*.012, -q.y-.92+rip*.04*(.4+uHigh)+.004);
    col = (sky(qm, .5)*.6+sky(qm+vec2(0.,.03), .5)*.25+sky(qm+vec2(0.,.07), .5)*.15);      // reflections draw out into streaks
    col *= (.5+.5*pow(1.-clamp(-rd.y*3.,0.,1.), 3.))*vec3(.86,.94,1.); col += vec3(.0006,.001,.002);
  }
  col += neon(.05)*.012*exp(-abs(rd.y)*60.)*(.5+uLevelS);                     // mist along the far shore
  float el = rd.y/length(rd.xz);
  col *= 1.-pines(atan(rd.x, rd.z), el);
  o = vec4(col, 1.);
}`;
scene({ id: 'aurora', name: 'Aurora', from: 'Claude', kind: 'field', group: 'refined', pal: 6, hue: t => Math.sin(t * 0.05) * 0.06,
  about: 'Three aurora curtains over a still lake, framed by pines: bass in front, highs behind, pitch from left to right; each stretch hangs as tall as its band is loud, and kicks send light running along them',
  inputs: ['spec', 'specS', 'high', 'levelS', 'kick', 'pulse', 'dyn', 'drop'],
  cost: 'Heavy: 42 samples a pixel (two noise lookups each) at half resolution. Phones: two curtains of eight samples at a third. TVs: ten samples.',
  post: { bloom: 0.5, thr: 0.6, knee: 0.6, spread: 0.74, ca: 0.3, vig: 0.8, pulse: 0.2 },
  init() { this.p = program(VS, FS_AUR); this.up = program(VS, FS_AUR_UP); },
  draw(F, out) {
    const lo = RTs('auroraLo', 2), yaw = Math.sin(F.time * 0.045) * 0.22;
    draw(this.p, lo, lo.w, lo.h, u => { F.set(u); gl.uniform2f(u.uRes, lo.w, lo.h); gl.uniform1f(u.uYaw, yaw); });
    draw(this.up, out, T.sw, T.sh, u => { F.set(u); gl.uniform1f(u.uYaw, yaw); bindTex(3, lo.t); gl.uniform1i(u.uLo, 3); });
  } });
}
