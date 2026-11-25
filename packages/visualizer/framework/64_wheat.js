
// ───────────────────────── Wind in the Wheat: a field at golden hour, combed by gusts that arrive on the beat ─────────────────────────
{
const WHEAT_N = 72000;
const WHEAT_FN = `
uniform vec2 uWdir;
const vec3 WSUN = vec3(-.33, .2, .922);
vec3 wsunC(){ return mix(vec3(1.,.66,.3), neon(.1), .12)*(.85+.3*uBassS+.12*uKick+.25*uAccent); }
vec3 wheatSky(vec3 rd){
  float y = max(rd.y, 0.), a = acos(clamp(dot(rd, WSUN), -1., 1.)); vec3 sc = wsunC();
  vec3 col = mix(mix(vec3(1.,.55,.2), neon(.05), .12), vec3(.5,.42,.4), smoothstep(0.,.14,y));
  col = mix(col, mix(vec3(.2,.3,.46), neon(.62), .12), smoothstep(.08,.5,y));
  col *= mix(.4, 1., exp(-a*1.3))*.4;
  col += sc*(smoothstep(.05,.042,a)*12.+exp(-a*11.)*.7+exp(-a*3.5)*.12);
  vec2 cp = rd.xz/(rd.y+.12); float cl = smoothstep(.5,.8, fbm(vec3(cp.x*.35+uTime*.006, cp.y*.9, 3.)))*exp(-y*2.5)*smoothstep(0.,.04,rd.y);
  col = mix(col, mix(vec3(.3,.2,.25), sc*.9, exp(-a*1.5)), cl*.6);
  float az = atan(rd.x, rd.z), tl = .008+.016*noise(vec3(az*9., 2., 5.))+.012*noise(vec3(az*31., 7., 5.))+.007*noise(vec3(az*110., 3., 5.));       // a far line of trees
  col = mix(col, mix(vec3(.05,.055,.045), col, .55), smoothstep(tl+.005, tl-.005, rd.y));
  return col; }
// how hard the wind leans on the stalks at xz: gust fronts cross the field in step with the music
float gust(vec2 xz){
  float along = dot(xz, uWdir), across = dot(xz, vec2(-uWdir.y, uWdir.x));
  float age = clamp((along+14.)/70.+.025*noise(vec3(across*.2, 1., 7.)), 0., 1.);   // a gust takes seventeen seconds to cross the field
  vec4 h = slowH(age);                                                              // the music as it was when this gust set out
  float turb = noise(vec3(xz*.22-uWdir*uTime*.45, uTime*.07));
  return .1+.5*h.z+.8*h.y*(.6+.4*noise(vec3(across*.11, uTime*.05, 2.)))+.16*turb*(.4+h.w); }`;
const VS_WHEAT = VSP + WHEAT_FN + `
out vec3 vW; out vec4 vI; out float vDepth;
const float TT[6] = float[6](0., .36, .64, .76, .88, 1.), WW[6] = float[6](1., .9, .8, 2.7, 2.3, .0);
void main(){
  uint id = uint(gl_InstanceID)*5u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), h4 = hashu(id+3u), h5 = hashu(id+4u);
  float bz = 1.3+pow(h2, 1.7)*58.; vec2 base = vec2((h1-.5)*(26.+bz*1.3), bz);          // thinning toward the horizon, where a stalk is less than a pixel                           // the field in front of you
  float hgt = .95+.3*h3, B = max(gust(base)*(.75+.5*h4)+.03*sin(uTime*1.2+h5*6.28), .02);        // the bend at the tip, in radians
  vec2 dir = normalize(uWdir+.35*(vec2(h4, h5)-.5));
  int seg = gl_VertexID/6, k = gl_VertexID%6, end = (k == 1 || k == 2 || k == 4) ? 1 : 0; float side = (k == 2 || k == 4 || k == 5) ? 1. : -1.;
  float t = TT[seg+end], w = WW[seg+end]*.0036*(.8+.5*h3);
  float off = hgt*(1.-cos(B*t))/B, up = hgt*sin(B*t)/B;                         // a stalk bent into an arc keeps its length
  vec3 p = vec3(base.x+dir.x*off, up, base.y+dir.y*off);
  vec3 tang = normalize(vec3(dir.x*sin(B*t), cos(B*t), dir.y*sin(B*t))), sd = normalize(cross(tang, p-uEye));
  vW = p+sd*side*w; vI = vec4(t, B, h3, h5);
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_WHEAT = FSH + WHEAT_FN + `
in vec3 vW; in vec4 vI; in float vDepth; out vec4 o;
void main(){
  float t = vI.x, ear = smoothstep(.62,.7,t); vec3 V = normalize(vW-uEye), sc = wsunC();
  vec3 base = mix(mix(vec3(.2,.24,.06), vec3(.62,.44,.13), smoothstep(.1,.7,t)), vec3(1.,.72,.28), ear)*(.45+.9*vI.w);
  base = mix(base, neon(.1+vI.w*.2)*dot(base, vec3(.4)), .1);
  float toSun = pow(max(dot(V, WSUN), 0.), 2.);
  vec3 col = base*(.035+.09*smoothstep(0.,.6,t));                             // sky light, less of it down among the stalks
  col += base*sc*(.08+.5*toSun)*smoothstep(.05,.7,t)*(.45+.55*ear);           // the low sun through them
  col += sc*base*vI.y*.3*smoothstep(.3,.9,t);                                // stalks leaning over show their flat side: gusts run through the field as light
  col *= smoothstep(-.1,.35,t);
  float dist = length(vW-uEye);
  col = mix(col, wheatSky(normalize(vec3(V.x, .03, V.z)))*.5, 1.-exp(-dist*.028));
  o = vec4(col, vDepth);
}`;
const FS_WHEAT_SKY = FSH + WHEAT_FN + `
out vec4 o; void main(){ vec3 rd = viewRay(); vec3 col = wheatSky(rd); float depth = 300.;
  if (rd.y < 0.){ float t = -uEye.y/rd.y; depth = t; col = mix(vec3(.2,.14,.04)*wsunC(), wheatSky(normalize(vec3(rd.x,.03,rd.z)))*.5, 1.-exp(-t*.028)); }
  o = vec4(col, depth); }`;
const VS_MOTE = VSP + WHEAT_FN + `
uniform float uDpr, uFocus, uWindT; out vec3 vCol;
void main(){ uint id = uint(gl_VertexID)*4u; float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), h4 = hashu(id+3u);
  vec3 p = vec3(mod(h1*26.+uWindT*(.5+.6*h4)*uWdir.x, 26.)-13., .7+h2*2.6+.25*sin(uTime*(.3+h4)+h3*20.), mod(h3*18.+uWindT*(.5+.6*h4)*uWdir.y, 18.)+.6);
  gl_Position = uVP*vec4(p,1.); float d = max(gl_Position.w, .05), size = max(1.6, abs(d-uFocus)/d*9.)*uDpr; gl_PointSize = min(size, 30.);
  float edge = smoothstep(0., 1.5, 13.-abs(p.x))*smoothstep(.6, 2., p.z)*smoothstep(18.6, 16., p.z);
  vCol = wsunC()*(.5+1.5*step(.9, h4))*(.35+1.3*uHigh)*edge*(2.2/(size*size))*(.6+.4*sin(uTime*(1.+h1*3.)+h2*40.)); }`;
scene({ id: 'wheat', name: 'Wind in the Wheat', from: 'Organic', kind: 'nature', group: 'organic', pal: 3, hue: () => 0,
  about: 'A wheat field at golden hour: every strong beat sends a slow gust that rolls through 72,000 stalks as waves of light, seeds drift in the low sun, and the near ears blur past the lens',
  inputs: ['slow history (dyn, accent, slow bass, slow level)', 'bassS', 'high', 'kick', 'accent'],
  cost: 'Vertex-heavy: 72,000 stalks (2.2 M vertices) with a wind lookup each, plus depth of field. Phones: 16,000 stalks and no depth of field. TVs: 32,000.',
  post: { dof: { ap: 3, max: 9 }, bloom: 0.55, thr: 0.95, knee: 0.7, spread: 0.74, exp: 1.0, ca: 0.3, vig: 0.7, pulse: 0.15 },
  init() { this.sky = program(VS, FS_WHEAT_SKY); this.blade = program(VS_WHEAT, FS_WHEAT); this.mote = program(VS_MOTE, FS_POINT); this.windT = 0; },
  draw(F, out) {
    const t = F.time, wa = 0.25 + Math.sin(t * 0.02) * 0.2, wd = [Math.cos(wa), -Math.sin(wa)];
    this.windT += F.dt * (0.35 + 0.9 * A.bassVS + 0.6 * A.accent);
    const eye = [Math.sin(t * 0.025) * 0.35, 1.62, 0];                              // the camera stands still in the field
    const c = camera(eye, [eye[0] * 0.5, 1.2, 8], 0.8, 0, 0.1, 400), focus = 4.5;
    const set = u => { F.set(u); setCam(u, c); gl.uniform2fv(u.uWdir, wd); };
    F.focus = focus;
    beginMS(); quad(this.sky, set);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(this.blade.p); set(this.blade.u); gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, WHEAT_N);
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    points(this.mote, 5000, u => { set(u); gl.uniform1f(u.uDpr, F.px); gl.uniform1f(u.uFocus, focus); gl.uniform1f(u.uWindT, this.windT % 100000); });
    endMS(out);
  } });
}
