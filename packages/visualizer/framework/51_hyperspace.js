
// ───────────────────────── Hyperspace: flying up a shaft of stars; the music is the speed, the stars and the hoops ─────────────────────────
{
// Three things, each tied to one part of the music so the link is easy to read:
//   speed      the bass and the kick drive how fast you travel, and so how long every streak is drawn
//   stars      each star belongs to a band and shines with it; fuller music brings more of them out
//   hoops      every kick lets go one hoop of light far ahead, and it rushes up and past you
// with a dial of the spectrum standing round the vanishing point.
const HYP_N = 3600;
const VS_STREAK = VSP + `
uniform float uZ, uLen; out vec3 vCol; out vec2 vE;
void main(){
  uint id = uint(gl_InstanceID)*6u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), band = hashu(id+3u), h5 = hashu(id+4u), h6 = hashu(id+5u);
  const float DEPTH = 90.;
  float ang = h1*TAU, rad = 1.8+pow(h2, .65)*14., z = mod(h3*DEPTH-uZ*(.7+.6*h5), DEPTH);     // it only wraps far ahead, where it is faded out
  float s = spec(.02+band*.8), sS = specS(.02+band*.8), len = uLen*(.6+.8*h5)*(.5+1.3*sS);
  float za = max(z, .7), end = float(gl_VertexID == 1 || gl_VertexID == 2 || gl_VertexID == 4), side = (gl_VertexID == 2 || gl_VertexID == 4 || gl_VertexID == 5) ? 1. : -1.;
  vec4 pa = uVP*vec4(cos(ang)*rad, sin(ang)*rad, za, 1.), pb = uVP*vec4(cos(ang)*rad, sin(ang)*rad, za+len, 1.);
  vec2 sa = pa.xy/pa.w, sb = pb.xy/pb.w, dpx = (sb-sa)*uRes, n = normalize(vec2(-dpx.y, dpx.x)+1e-6);
  float w = (.7+.9*s+1.1/za)*uPx;
  gl_Position = vec4(mix(sa, sb, end)+n*side*w/uRes*2., 0., 1.);
  float shown = smoothstep(h6-.12, h6+.12, .22+.9*uDyn);                                     // fuller music brings more stars out
  vCol = neon(.5+band*.5)*(.03+.9*s*s+.1*uKick)*smoothstep(DEPTH, DEPTH*.7, z)*smoothstep(.7, 3.5, z)*shown;
  vE = vec2(end, side);
}`;
const FS_STREAK = `#version 300 es
precision highp float; in vec3 vCol; in vec2 vE; out vec4 o;
void main(){ o = vec4(vCol*mix(1., .08, vE.x)*(1.-vE.y*vE.y), 1.); }`;                         // bright at the head, fading down the tail
const FS_HYP_BG = FSH + `
out vec4 o;
void main(){
  vec2 q = (gl_FragCoord.xy*2.-uRes)/uRes.y; vec4 pc = uVP*vec4(0., 0., 60., 1.); vec2 ctr = pc.xy/pc.w*vec2(uAspect, 1.), d = q-ctr;
  float r = length(d), ang = atan(d.y, d.x);
  vec3 col = vec3(.002,.0025,.006)+neon(.6)*.012*exp(-r*1.6)+(neon(.12)*.6+.4)*exp(-r*r*160.)*(.1+.5*uBassS+.7*uKick);   // the light you are flying toward
  // the dial: the spectrum standing round the vanishing point
  float u = fract(ang/TAU+.5+uTime*.004), cell = floor(u*120.), band = abs((cell+.5)/120.*2.-1.), sS = specS(.02+band*.82), s = spec(.02+band*.82);
  float fu = abs(fract(u*120.)-.5), bar = smoothstep(.32,.22,fu)*smoothstep(.085,.095,r)*smoothstep(.1+.3*sS*sS+.004, .1+.3*sS*sS, r);
  col += neon(.55+band*.45)*bar*(.12+1.6*s*s);
  // the hoops: one for every kick, let go far ahead, rushing up and past
  for (int i = 0; i < 8; i++){ float a = uPulse[i]; if (a > 1.5) continue;
    float z = 62.*pow(max(1.-a/1.35, 0.), 2.4)+.6; vec4 ph = uVP*vec4(0., 0., z, 1.); vec2 hc = ph.xy/ph.w*vec2(uAspect, 1.);
    float rs = 3.4/(z*uTan), dd = length(q-hc)-rs, wd = .004+.035/z;
    col += (neon(.1+float(i)*.11)*.75+.25)*(exp(-dd*dd/(wd*wd))+.25*exp(-abs(dd)/(wd*6.)))*smoothstep(0.,.1,a)*(1.-smoothstep(1.1,1.35,a))*(1.1+.5/z); }
  col += neon(.9)*pow(noise(vec3(ang*9., uTime*.5, 3.)), 5.)*uSnare*exp(-r*1.2)*.5;            // snares: a flicker of spokes
  o = vec4(col, 1.);
}`;
scene({ id: 'tunnel', name: 'Hyperspace', from: 'Claude', kind: 'field', group: 'refined', pal: 0,
  about: 'Flying up a shaft of stars: bass and kick are your speed (and the length of every streak), each star shines with its own band, fuller music brings out more of them, and every kick sends a hoop of light rushing past',
  inputs: ['spec', 'specS', 'bassS', 'kick', 'snare', 'pulse', 'dyn', 'travel'],
  cost: 'Light: 3,600 additive streaks and one full-screen pass. Fine on phones.',
  post: { trail: 0.25, bloom: 0.5, thr: 0.7, ca: 0.8, vig: 0.9, pulse: 0.5 },
  init() { this.bg = program(VS, FS_HYP_BG); this.stars = program(VS_STREAK, FS_STREAK); this.speed = 1; },
  draw(F, out) {
    const t = F.time; this.speed += (0.55 + 2.2 * A.bassS + 1.2 * A.kick - this.speed) * (1 - Math.exp(-F.dt * 6));
    const c = camera([Math.sin(t * 0.13) * 0.5, Math.sin(t * 0.1) * 0.35, 0], [Math.sin(t * 0.07) * 1.5, Math.sin(t * 0.09) * 1, 30], 0.95 + 0.25 * A.dyn, Math.sin(t * 0.05) * 0.3, 0.2, 200);
    const set = u => { F.set(u); setCam(u, c); gl.uniform1f(u.uZ, (F.travel * 20) % 90000); gl.uniform1f(u.uLen, 0.3 + 1.5 * this.speed); };
    beginTo(out); quad(this.bg, set);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.stars.p); set(this.stars.u); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, HYP_N);
  } });
}
