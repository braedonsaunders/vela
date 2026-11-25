
// ───────────────────────── Meridian: a wire globe; each parallel is one moment of the spectrum, sliding from pole to pole ─────────────────────────
{
const GLOBE_FN = `
float globeV(vec2 a){ float f = .5-.5*cos((a.x*2.-1.)*PI);
  float v = mix(hist(.04, a.y)*.7+hist(.2, a.y)*.3, hist(.02+f*.82, a.y), smoothstep(0.,.14,a.y));
  return v*(1.-smoothstep(.86,1.,a.y)); }
vec3 globeP(vec2 a){ float lon = (a.x*2.-1.)*PI, lat = a.y*PI; float v = globeV(a);
  return vec3(sin(lat)*cos(lon), cos(lat), sin(lat)*sin(lon))*(1.+v*v*.42*(.35+.65*sin(lat))+uBassS*.03+uKick*.035); }`;
const VS_GLOBE = VSH + GLOBE_FN + `
out vec3 vW, vN; out vec2 vUV; out float vV, vF;
void main(){
  vW = globeP(aUV); vUV = aUV; vV = globeV(aUV); vF = .5-.5*cos((aUV.x*2.-1.)*PI);
  vec2 lo = max(aUV-.004, 0.), hi = min(aUV+.004, 1.);
  vec3 a = globeP(vec2(hi.x,aUV.y))-globeP(vec2(lo.x,aUV.y)), b = globeP(vec2(aUV.x,hi.y))-globeP(vec2(aUV.x,lo.y));
  vN = cross(a, b); vN = length(vN) > 1e-9 ? normalize(vN) : normalize(vW); if (dot(vN, vW) < 0.) vN = -vN;
  gl_Position = uVP*vec4(vW,1.);
}`;
const FS_GLOBE = FSH + `
in vec3 vW, vN; in vec2 vUV; in float vV, vF; out vec4 o; uniform float uBack;
void main(){
  vec2 g = vec2(vUV.x*96., vUV.y*84.), fw = max(fwidth(g), 1e-5), px = abs(fract(g-.5)-.5)/fw;
  vec2 ln = (1.-smoothstep(vec2(.25,.35), vec2(1.15,1.3), px))*(1.-smoothstep(.25,.8,fw));
  float amp = vV*vV;
  vec3 lc = vivid(.5+vF*.38+vUV.y*.22);
  float wv = ring(vUV.y, .55, .045, 1.9);                                  // each kick: a band of light travels from pole to pole
  vec3 line = (lc*(ln.y*(.16+3.2*amp)+ln.x*(.05+.7*amp)) + (lc*.4+.6)*ln.x*ln.y*(amp*4.+wv*1.5))*(1.+.2*uKick+2.2*wv);
  vec3 n = normalize(vN), v = normalize(uEye-vW);
  if (uBack > .5){ o = vec4(line*.3, 0.); return; }           // the far side, seen through the shell
  float fr = pow(1.-abs(dot(n,v)), 2.5);
  vec3 fill = vivid(.62)*.006 + lc*amp*.04 + vivid(.7)*fr*(.05+.2*uBass+.2*uKick) + (vivid(.12)*.6+.4)*(1.-fr)*(.012+.05*uBassS);   // glass, warmed from inside
  o = vec4(fill+line, .6);
}`;
const FS_GLOBE_BG = FSH + `
out vec4 o;
void main(){ vec3 rd = viewRay(); vec3 col = vec3(.002,.0025,.006) + vivid(.62)*.012*fbm(rd*2.2+4.);
  col += stars(rd)*.8;
  float tca = -dot(uEye, rd), b = length(cross(uEye, rd));
  if (tca > 0.){ col += vivid(.6)*exp(-max(b-1.,0.)*5.)*(.08+.16*uBass+.12*uKick);
    col += (vivid(.12)*.7+.3)*exp(-b*b*55.)*(.3+.9*uBass+1.2*uKick);         // the core, seen through the shell
    vec3 pc = uEye+rd*tca; float ang = atan(dot(pc, uCamU), dot(pc, uCamR));
    float shaft = noise(vec3(ang*5., uTime*.12, 1.))*noise(vec3(ang*13., uTime*.09, 5.)), bandA = spec(.04+(.5+.5*sin(ang))*.7);
    col += (vivid(.12)*.6+.4)*shaft*shaft*(.5+2.5*bandA*bandA)*exp(-max(b-.15, 0.)*1.5)*(.14+.5*uBassS); }   // its light, breaking out between the wires
  o = vec4(col, 1.); }`;
// Three thin rings turn about the globe, like the rings of an armillary sphere: one each for bass, mids and
// highs. Each carries a bead that runs round it as fast as its band is loud, and lights along its length with it.
const VS_ARM = VSH + `
uniform mat3 uTilt; uniform float uRad; out vec2 vP;
void main(){ float a = aUV.x*TAU, r = uRad+(aUV.y-.5)*.1; vP = aUV; gl_Position = uVP*vec4(uTilt*vec3(cos(a)*r, 0., sin(a)*r), 1.); }`;
const FS_ARM = FSH + `
in vec2 vP; out vec4 o; uniform float uBand, uSat;
void main(){ float fv = max(fwidth(vP.y), 1e-4), ln = 1.-smoothstep(.5,1.8,abs(vP.y-.5)/fv), fu = max(fwidth(vP.x*90.), 1e-4);
  float tick = (1.-smoothstep(.1,.1+fu,abs(fract(vP.x*90.)-.5)))*step(abs(vP.y-.5), .32)*(1.-smoothstep(.3,.8,fu));
  float s = spec(uBand+.2*abs(vP.x*2.-1.)), back = fract(uSat-vP.x), dd = min(back, 1.-back);
  float bead = exp(-dd*dd*30000.)*exp(-pow((vP.y-.5)/.35, 2.)), tail = exp(-back*16.)*ln;
  o = vec4(neon(.5+uBand*1.2)*(ln*(.12+1.1*s*s)+tick*(.05+.3*s))+(neon(.5+uBand*1.2)*.4+.6)*(bead*3.5+tail*1.4), 1.); }`;
// A tilted ring of dust around the globe; every radius is a band.
const VS_RING = VSP + `
uniform float uDpr; out vec3 vCol;
float h1(float n){ return fract(sin(n)*43758.5453123); }
void main(){
  float id = float(gl_VertexID), a = h1(id*.1031+1.3), b = h1(id*.11369+2.1), c = h1(id*.13787+3.7);
  float band = pow(a, .8), r = 1.62+band*.95, s = specS(.03+band*.8), sl = spec(.03+band*.8);
  float ang = b*TAU + uTime*(.5/(r*sqrt(r)));
  vec3 p = vec3(cos(ang)*r, (c-.5)*.035*(1.+6.*s*s), sin(ang)*r);
  p.yz = rot(.42)*p.yz; p.xy = rot(-.2)*p.xy;
  gl_Position = uVP*vec4(p,1.);
  gl_PointSize = clamp((1.2+2.4*s+step(.985,c)*2.)*uDpr*3./max(gl_Position.w,.2), 1., 24.);
  vCol = vivid(.5+band*.45)*(.06+(s*s*.6+sl*sl*.4)*1.8+uHigh*.1);
}`;

scene({ id: 'globe', name: 'Meridian', from: 'Fable', kind: 'sphere', group: 'refined', pal: 0,
  about: 'A wire globe lit from within: its parallels are moments of the spectrum sliding from pole to pole, each kick sends a band of light across it, and three armillary rings carry beads that run as fast as bass, mids and highs are loud',
  inputs: ['hist', 'specS', 'spec', 'bassS', 'midS', 'highS', 'bass', 'high', 'kick', 'pulse'],
  cost: 'Cheap. The globe is drawn twice (far side, then near side) and the ring is 90k points.',
  post: { trail: 0.15, bloom: 0.5, thr: 0.6, ca: 0.4, pulse: 0.3 },
  init() { this.bg = program(VS, FS_GLOBE_BG); this.shell = program(VS_GLOBE, FS_GLOBE); this.ring = program(VS_RING, FS_POINT); this.arm = program(VS_ARM, FS_ARM); this.sat = [0, 0.3, 0.6]; },
  draw(F, out) {
    const t = F.time, c = camera(orbit(t * 0.09, 0.5 + Math.sin(t * 0.07) * 0.16, 4.7), [0, -0.05, 0], 0.8, 0, 0.1, 60);
    const set = u => { F.set(u); setCam(u, c); }, g = grid(256);
    beginMS(); quad(this.bg, set);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.cullFace(gl.FRONT); gl.depthMask(false); mesh(this.shell, g, u => { set(u); gl.uniform1f(u.uBack, 1); });
    gl.cullFace(gl.BACK); gl.depthMask(true); mesh(this.shell, g, u => { set(u); gl.uniform1f(u.uBack, 0); });
    gl.disable(gl.CULL_FACE); gl.depthMask(false); gl.blendFunc(gl.ONE, gl.ONE);
    points(this.ring, 90000, u => { set(u); gl.uniform1f(u.uDpr, F.px); });
    gl.depthMask(false);
    [A.bassS, A.midS, A.highS].forEach((lv, i) => { this.sat[i] = (this.sat[i] + F.dt * (0.03 + 0.4 * lv * lv)) % 1;
      const a = 0.5 + i * 1.1 + Math.sin(t * 0.05 + i * 2) * 0.35, b = i * 2.1 + t * 0.03 * (i - 1), ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
      mesh(this.arm, grid(128), u => { set(u); gl.uniformMatrix3fv(u.uTilt, false, [cb, sb, 0, -sb * ca, cb * ca, sa, sb * sa, -cb * sa, ca]);
        gl.uniform1f(u.uRad, 1.52 + i * 0.13); gl.uniform1f(u.uBand, 0.03 + i * 0.27); gl.uniform1f(u.uSat, this.sat[i]); }); });
    endMS(out);
  } });
}
