
// ───────────────────────── Ink in Water: ink entering a lit tank from every side, unfurling and lingering ─────────────────────────
{
const INK_W = 256, INK_H = 160, INK_DW = 1024, INK_DH = 640;
// Each kick lets ink in somewhere new: dropped from above, pushed in from a side wall, rising from the floor,
// or bled into the middle. uDropP is where and which ink; uDropV is the push it arrives with and how it spreads.
const INK_COMMON = `
in vec2 uv; out vec4 o; uniform sampler2D uVel, uDye; uniform float uDt, uAsp; uniform vec4 uDropP[8], uDropV[8];
float land(float a){ return smoothstep(0.,.07,a)*(1.-smoothstep(.12,.55,a)); }
vec3 inkOf(float k){ k = mod(k, 3.); return clamp(vec3(max(1.-abs(k), 1.-abs(k-3.)), 1.-abs(k-1.), 1.-abs(k-2.)), 0., 1.); }`;
const FS_INK_FORCE = HEAD + LIB + INK_COMMON + `
void main(){
  vec2 v = texture(uVel, uv).xy; float den = dot(texture(uDye, uv).rgb, vec3(1.));
  v.y -= den*.05*uDt;                                                       // ink is only a little heavier than water, so it hangs
  for (int i = 0; i < 8; i++){ float a = uPulse[i]; if (a > .7) continue; vec2 d = (uv-uDropP[i].xy)*vec2(uAsp, 1.); float g = exp(-dot(d,d)/.0024);
    v += (uDropV[i].xy+uDropV[i].z*d/(length(d)+.02))*g*land(a)*uDt*(3.2+3.*uBassS); }
  vec2 p = uv*vec2(uAsp, 1.); float t = uTime*.07;
  v += vec2(cos(p.y*2.3+t)+.5*cos(p.y*5.1-t*1.7), sin(p.x*1.9-t*1.3)+.5*sin(p.x*4.3+t*2.1))*uDt*.01*(.3+1.2*uMidS);   // the mids stir the tank, gently
  o = vec4(v, 0., 1.);
}`;
const FS_INK_DYE = HEAD + LIB + INK_COMMON + `
void main(){
  vec3 dye = texture(uDye, uv).rgb*exp(-uDt*.011);                          // it thins out only over a minute or more, so colours build up in layers
  for (int i = 0; i < 8; i++){ float a = uPulse[i]; if (a > .7) continue; vec2 d = (uv-uDropP[i].xy)*vec2(uAsp, 1.);
    dye += inkOf(uDropP[i].w)*exp(-dot(d,d)/(.0006+.0009*uDropV[i].w))*land(a)*uDt*(7.+9.*uDropV[i].w); }
  o = vec4(min(dye, vec3(3.2)), 1.);
}`;
const FS_INK = FSH + COVER + `
out vec4 o; uniform sampler2D uDye; const vec2 TX = 1./vec2(${INK_DW}., ${INK_DH}.);
void main(){
  vec2 sc = gl_FragCoord.xy/uRes, uv = cover(sc, 1.6), q = sc-.5;
  vec3 dye = texture(uDye, uv).rgb;
  vec3 gx = texture(uDye, uv+vec2(TX.x*2.,0.)).rgb-texture(uDye, uv-vec2(TX.x*2.,0.)).rgb, gy = texture(uDye, uv+vec2(0.,TX.y*2.)).rgb-texture(uDye, uv-vec2(0.,TX.y*2.)).rgb;
  vec2 g = vec2(dot(gx, vec3(1.)), dot(gy, vec3(1.)));
  // a tank lit from behind: soft, slightly cool light, brighter in the middle
  vec3 bg = mix(vec3(.74,.79,.84), vec3(.93,.94,.95), exp(-dot(q,q)*2.6))*(.82+.1*uLevelS);
  bg *= 1.+.05*sin(uv.y*40.+uTime+noise(vec3(uv*6., uTime*.2))*6.)*smoothstep(.75, 1., uv.y);       // light playing just under the surface
  vec3 c0 = mix(vec3(.05,.1,.45), neon(.0), .1), c1 = mix(vec3(.74,.05,.3), neon(.33), .1), c2 = mix(vec3(.0,.47,.5), neon(.66), .1);
  vec3 T = exp(-(dye.r*-log(max(c0, .03))+dye.g*-log(max(c1, .03))+dye.b*-log(max(c2, .03)))*1.05);
  vec3 col = bg*T;
  col *= 1.+clamp(dot(g, vec2(.5, .8))*.35, -.25, .3);                       // the plumes have body: lit on one side, shaded on the other
  col *= 1.-smoothstep(.985, 1., uv.y)*.25;                                  // the waterline
  o = vec4(col*(1.-.55*dot(q,q)), 1.);
}`;
scene({ id: 'ink', name: 'Ink in Water', from: 'Organic', kind: 'fluid', group: 'organic', pal: 0, hue: () => 0,
  about: 'A lit tank: every kick lets ink in from somewhere new (above, a side, the floor, the middle); it unfurls slowly in a real fluid simulation and lingers, so the colours build up in layers',
  inputs: ['bassS', 'midS', 'levelS', 'pulse'],
  cost: 'Moderate: a 256×160 fluid solve (18 pressure iterations) and a 1024×640 dye field. Phones: 128×80 with 10 iterations and a 512×320 dye field.',
  post: { bloom: 0.06, thr: 1.6, exp: 1.0, ca: 0.15, vig: 0.3, grain: 0.02, pulse: 0 },
  init() { this.force = program(VS, FS_INK_FORCE); this.dye = program(VS, FS_INK_DYE); this.show = program(VS, FS_INK);
    this.fluid = new Fluid(INK_W, INK_H, INK_DW, INK_DH); this.P = new Float32Array(32); this.V = new Float32Array(32); this.last = new Float32Array(8).fill(9); this.n = 0; },
  draw(F, out) {
    newPulses(this.last, i => { const r = Math.random, k = this.n++ % 5, ink = (this.n * 0.37 + r() * 0.5) % 3, big = 0.3 + 0.7 * Math.min(1, A.kickAmp / 3) * r();
      const src = [                                               // x, y, push x, push y, outward spread
        [0.14 + r() * 0.72, 0.93, (r() - 0.5) * 0.3, -1, 0],       // a drop from above
        [0.04, 0.2 + r() * 0.6, 1, (r() - 0.5) * 0.4, 0],          // in from the left wall
        [0.3 + r() * 0.4, 0.35 + r() * 0.3, 0, 0, 0.55],           // bled into the middle
        [0.96, 0.2 + r() * 0.6, -1, (r() - 0.5) * 0.4, 0],         // in from the right wall
        [0.14 + r() * 0.72, 0.05, (r() - 0.5) * 0.3, 0.9, 0]][k];  // rising from the floor
      this.P.set([src[0], src[1], 0, ink], i * 4); this.V.set([src[2], src[3], src[4], big], i * 4); });
    this.fluid.step(F.dt, { force: this.force, dye: this.dye, set: u => { F.set(u); gl.uniform4fv(u.uDropP, this.P); gl.uniform4fv(u.uDropV, this.V); }, keepV: 0.988, vort: 5, iters: 18, wall: 0.03 });
    draw(this.show, out, T.sw, T.sh, u => { F.set(u); bindTex(3, this.fluid.d[0].t); gl.uniform1i(u.uDye, 3); });
  } });
}
