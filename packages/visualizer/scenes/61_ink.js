
// ───────────────────────── Ink in Water: ink entering a lit tank from every side, unfurling and lingering ─────────────────────────
{
const INK_W = 256, INK_H = 160, INK_DW = 1024, INK_DH = 640;
// Each kick lets ink in somewhere new: dropped from above, pushed in from a side wall, rising from the floor,
// or bled into the middle. uDropP is where and which ink; uDropV is the push it arrives with and how it spreads.
const INK_COMMON = `
in vec2 uv; out vec4 o; uniform sampler2D uVel, uDye; uniform float uDt, uAsp; uniform float uJetAge[8]; uniform vec4 uDropP[8], uDropV[8];
float land(float a){ return exp(-a*24.); }
vec3 inkOf(float k){ k = mod(k, 3.); return clamp(vec3(max(1.-abs(k), 1.-abs(k-3.)), 1.-abs(k-1.), 1.-abs(k-2.)), 0., 1.); }`;
const FS_INK_FORCE = HEAD + LIB + INK_COMMON + `
void main(){
  vec2 v = texture(uVel, uv).xy; float den = dot(texture(uDye, uv).rgb, vec3(1.));
  v.y -= den*.05*uDt;                                                       // ink is only a little heavier than water, so it hangs
  for (int i = 0; i < 8; i++){ float a = uJetAge[i]; if (a > .17) continue; vec2 d = (uv-uDropP[i].xy)*vec2(uAsp, 1.); float g = exp(-dot(d,d)/.0045);
    v += (uDropV[i].xy+uDropV[i].z*d/(length(d)+.02))*g*land(a)*uDt*(15.+16.*uDropV[i].w); }
  vec2 p = uv*vec2(uAsp, 1.); float t = uTime*.07;
  v += vec2(cos(p.y*2.3+t)+.5*cos(p.y*5.1-t*1.7), sin(p.x*1.9-t*1.3)+.5*sin(p.x*4.3+t*2.1))*uDt*.01*(.3+1.2*uMidS);   // the mids stir the tank, gently
  o = vec4(v, 0., 1.);
}`;
const FS_INK_DYE = HEAD + LIB + INK_COMMON + `
void main(){
  vec3 dye = texture(uDye, uv).rgb*exp(-uDt*.075);                          // it thins out only over a minute or more, so colours build up in layers
  for (int i = 0; i < 8; i++){ float a = uJetAge[i]; if (a > .17) continue; vec2 d = (uv-uDropP[i].xy)*vec2(uAsp, 1.);
    vec2 dir=normalize(uDropV[i].xy), per=vec2(-dir.y,dir.x);
    float along=dot(d,dir), across=dot(d,per);
    float tendril=sin(along*75.+uDropP[i].z)*.010;
    float w=.008+.010*uDropV[i].w;
    float plume=exp(-pow(along/.061,2.)-pow((across-tendril)/w,2.));
    plume+=.56*exp(-pow((along-.021)/.05,2.)-pow((across+tendril*2.)/(w*.66),2.));
    dye+=inkOf(uDropP[i].w)*plume*land(a)*uDt*(24.+28.*uDropV[i].w); }
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
  // Narrow bands pick out existing filaments, leaving the pale water undisturbed.
  float pitch=clamp(.10+.78*uv.y+.06*sin(uv.x*16.),0.,1.);
  float edge=clamp(length(g)*2.+dot(dye,vec3(.08)),0.,1.);
  float lift=clamp(spec(pitch)-specS(pitch),0.,.55);
  vec3 col=bg*T+edge*lift*mix(vec3(.22,.36,.64),vec3(.53,.13,.24),uv.y);
  col *= 1.+clamp(dot(g, vec2(.5, .8))*.35, -.25, .3);                       // the plumes have body: lit on one side, shaded on the other
  col *= 1.-smoothstep(.985, 1., uv.y)*.25;                                  // the waterline
  o = vec4(col*(1.-.55*dot(q,q)), 1.);
}`;
scene({ id: 'ink', name: 'Ink in Water', from: 'Organic', kind: 'fluid', group: 'organic', pal: 0, hue: () => 0,
  about: 'A lit tank: a bass jet rises in the centre, snares enter from the right and pitched notes from the left; it unfurls slowly in a real fluid simulation and lingers, so the colours build up in layers',
  inputs: ['bassS', 'midS', 'levelS', 'pulse'],
  cost: 'Moderate: a 256×160 fluid solve (18 pressure iterations) and a 1024×640 dye field. Phones: 128×80 with 10 iterations and a 512×320 dye field.',
  post: { bloom: 0.06, thr: 1.6, exp: 1.0, ca: 0.15, vig: 0.3, grain: 0.02, pulse: 0 },
  init() { this.force = program(VS, FS_INK_FORCE); this.dye = program(VS, FS_INK_DYE); this.show = program(VS, FS_INK);
    this.fluid = new Fluid(INK_W, INK_H, INK_DW, INK_DH); this.P = new Float32Array(32); this.V = new Float32Array(32); this.last = new Float32Array(8).fill(9); this.n = 0; this.age = new Float32Array(8).fill(9); this.sn = A.snares; this.nn = A.notes; this.noteAt = -1; this.beat=A.beat; },
  draw(F, out) {
    // Repeated hits feed the same plume. A listener can follow each instrument in one place.
    for (let j = 0; j < 8; j++) this.age[j] += F.dt;
    const jet = (x, y, dx, dy, dye, strength) => {
      const i = this.n++ % 8;
      this.age[i] = 0;
      this.P.set([x, y, this.n*2.4, dye], i * 4);
      this.V.set([dx, dy, 0.12, strength], i * 4);
    };
    if(this.beat!==A.beat){ this.beat=A.beat; jet(.5+.16*Math.sin(A.beat*2.4), .35+.08*Math.cos(A.beat*2.4), .65*Math.sin(A.beat*2.4), 1.05, 0, Math.min(1, A.kickAmp / 2.5)); }
    if (this.sn !== A.snares) {
      this.sn = A.snares;
      jet(.68, .55+.12*Math.cos(A.snares*2.4), -.8, -.32, 1, .67);
    }
    if (this.nn !== A.notes) {
      this.nn = A.notes;
      if (F.time - this.noteAt > .28 && A.noteAmp > .36) {
        this.noteAt = F.time;
        jet(.31, .45 + .22 * A.noteBand, .75, .24, 2, A.noteAmp * .72);
      }
    }
    this.fluid.step(F.dt, { force: this.force, dye: this.dye, set: u => { F.set(u); gl.uniform1fv(u.uJetAge, this.age); gl.uniform4fv(u.uDropP, this.P); gl.uniform4fv(u.uDropV, this.V); }, keepV: 0.970, vort: 5, iters: 18, wall: 0.03 });
    draw(this.show, out, T.sw, T.sh, u => { F.set(u); bindTex(3, this.fluid.d[0].t); gl.uniform1i(u.uDye, 3); });
  } });
}
