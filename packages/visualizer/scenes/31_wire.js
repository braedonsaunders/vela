
// ───────────────────────── Synthwire Valley: low-poly wire mountains, a mirror road and a barred sun ─────────────────────────
{
// The mesh vertices ARE the low-poly vertices: heights come from a hash on whole lattice coordinates, so a
// facet keeps its shape as it comes toward you. The lattice wraps every 4096 rows, seamlessly.
const WIRE_FN = `
uniform float uCell, uSnap, uRow;
float lat(vec2 c){ return hash2(vec2(c.x, mod(c.y, 4096.))); }
float lat8(vec2 c){ return hash2(vec2(c.x, mod(c.y, 512.))+17.3); }
float vnoise8(vec2 g){ vec2 i = floor(g/8.), f = fract(g/8.); f = f*f*(3.-2.*f);
  return mix(mix(lat8(i), lat8(i+vec2(1.,0.)), f.x), mix(lat8(i+vec2(0.,1.)), lat8(i+vec2(1.,1.)), f.x), f.y); }
const float ROAD = 3.4;
float wireH(vec2 g, float zl){                       // g: lattice column and world row; zl: distance ahead
  float ax = abs(g.x)*uCell, valley = smoothstep(ROAD, 17., ax), f = clamp((ax-ROAD)/82., 0., 1.);
  float s = specS(.015+f*.82), n = lat(g)*.42+vnoise8(g)*1.08;
  float sw = hist(.03+f*.25, max(zl,0.)/170.);                              // each beat's swell runs away up the valley
  return valley*(.25+n*n*(2.1+ax*.085))*((.3+1.9*s)*(.5+.75*uDyn)+.28*uKick+1.1*sw*sw);
}`;
const WIRE_SKY = `
vec3 wireSky(vec3 rd, float disc){                       // disc: 0 leaves the sun's face out (for the haze colour)
  float y = max(rd.y, 0.);
  vec3 col = mix(neon(.95)*.055+neon(.5)*.01, vec3(.004,.003,.016), 1.-exp(-y*5.));
  col += neon(.0)*.1*exp(-abs(rd.y)*22.)*(.4+uBassS+1.6*uKick+uDrop);                 // the horizon seam
  vec3 sd = normalize(vec3(0.,.15,1.)), sx = normalize(cross(vec3(0.,1.,0.), sd)), sy = cross(sd, sx);
  vec2 sp = vec2(dot(rd,sx), dot(rd,sy)); float front = step(0., dot(rd,sd));
  float R = .19, d = length(sp)-R, v = sp.y/R;
  // Bars: slits that drift down the disc and widen as they go. Each is born with no width, so none pops in.
  float k = clamp(.55-v*.55, 0., 1.), gap = .62*k*k, ph = fract(v*5.5+uTime*.11);
  float slit = mix(1., smoothstep(gap-.03, gap+.03, ph)*(1.-smoothstep(.97, 1., ph)), smoothstep(.0,.06,gap));
  vec3 top = vec3(1.,.74,.26)*.85+neon(.25)*.15, sun = mix(neon(.0), top, smoothstep(-.75,.8,v))*(.8+.8*uKick+.6*uDrop);
  col = mix(col, sun, smoothstep(.003,-.003,d)*front*slit*disc);
  col += mix(neon(.0), top, .4)*exp(-max(d,0.)*9.)*front*(.06+.12*uBassS+.3*uKick+.3*uDrop);
  float fa = .03+(atan(sp.y, abs(sp.x))/PI+.5)*.7, fan = (specS(fa-.03)+specS(fa)*2.+specS(fa+.03))*.25;                      // a corona whose reach at each angle is a band
  col += mix(neon(.0), top, .5)*smoothstep(.0, -.1, d-.03-.22*fan*fan)*smoothstep(-.02, .01, d)*front*(.06+.2*fan)*smoothstep(-.02,.02,rd.y);
  col += stars(rd)*.7*smoothstep(.12,.4,rd.y);
  return col;
}`;
const VS_WIRE = VSH + WIRE_FN + `
out vec3 vW; out vec2 vG; out float vDepth;
void main(){
  vec2 g = vec2(aUV.x*128.-64., aUV.y*128.-4.);
  vW = vec3(g.x*uCell, wireH(vec2(g.x, g.y+uRow), g.y*uCell-uSnap), g.y*uCell-uSnap); vG = g;
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_WIRE_SKY = FSH + WIRE_FN + WIRE_SKY + `
out vec4 o; void main(){ o = vec4(wireSky(viewRay(), 1.), 400.); }`;
const FS_WIRE = FSH + WIRE_FN + WIRE_SKY + `
in vec3 vW; in vec2 vG; in float vDepth; out vec4 o;
void main(){
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); if (n.y < 0.) n = -n;          // flat facets
  vec3 v = normalize(vW-uEye); float dist = length(vW-uEye), ax = abs(vW.x);
  vec2 fw = max(fwidth(vG), 1e-5), f = fract(vG), e = min(f, 1.-f)/fw;
  float far = 1.-smoothstep(.3,.9,max(fw.x,fw.y));
  float lq = max(1.-smoothstep(.35,1.35,e.x), 1.-smoothstep(.35,1.35,e.y))*far;
  float ld = (1.-smoothstep(.3,1.3, abs(f.x+f.y-1.)/max(fwidth(vG.x+vG.y), 1e-5)))*far;
  float band = clamp((ax-ROAD)/82., 0., 1.), s = spec(.015+band*.82), hi = smoothstep(.5, 3., vW.y);
  float lt = .02+band*.5+vW.y*.02; vec3 lc = neon(lt), col;
  if (ax < ROAD+.05){
    // the road: a dark mirror with lane marks, neon kerbs and the waveform down the middle
    vec3 r = reflect(v, vec3(0.,1.,0.)); r.y = abs(r.y)+.002;
    col = wireSky(normalize(r), 1.)*(.16+.4*pow(1.-max(-v.y,0.), 4.))*vec3(.8,.75,1.);
    float run = ring(dist, 70., 5., 1.6);                                  // each kick: light runs away down the road
    col += neon(.0)*lq*(.07+.7*run);
    col += (neon(.0)*.7+.3)*exp(-abs(ax-ROAD+.25)*22.)*(.25+.7*uBass+.6*uKick+2.2*run);
    float xw = wave(dist*.011)*(.12+.55*uLevelS);
    col += (neon(.5)*.6+.4)*exp(-abs(vW.x-xw)*(22.-dist*.1))*(.35+1.3*uLevel)*exp(-dist*.02);
  } else {
    float facet = clamp(dot(n, normalize(vec3(-.45,.6,-.35)))*.5+.5, 0., 1.);
    col = lc*(.008+.1*facet*facet)*(.4+hi)*(.6+1.6*s*s) + neon(.95)*pow(1.-max(dot(n,-v),0.), 3.)*.03;   // dark faceted glass
    col += (lc*lq*(.06+.3*hi+1.9*s*s*(.15+.85*hi)) + lc*ld*hi*(.03+.8*s*s))*(1.+1.4*uKick+uDrop+1.5*ring(dist, 70., 6., 1.6));                              // wires; diagonals only up high
    col += (lc*.5+.5)*lq*ld*hi*s*s*3.;                                                                  // nodes
  }
  col = mix(col, wireSky(normalize(vec3(v.x, .012, v.z)), 0.), 1.-exp(-dist*.017));
  o = vec4(col, vDepth);
}`;
scene({ id: 'wire', name: 'Synthwire Valley', from: 'Neon', kind: 'terrain', group: 'refined', pal: 4,
  about: 'Low-poly wire mountains either side of a mirror road, under a barred sunset sun; the peaks ride the spectrum',
  inputs: ['specS', 'spec', 'hist', 'wave', 'bassS', 'levelS', 'bass', 'level', 'kick', 'pulse', 'dyn', 'drop', 'travel'],
  cost: 'Cheap: 33k triangles. The road evaluates the sky a second time for its reflection.',
  post: { trail: 0.12, bloom: 0.42, thr: 0.9, ca: 0.6, vig: 0.85, pulse: 0.25 },
  init() { this.sky = program(VS, FS_WIRE_SKY); this.land = program(VS_WIRE, FS_WIRE); },
  draw(F, out) {
    const cell = 1.6, camZ = F.travel * 5.5, row = Math.floor(camZ / cell), t = F.time;
    const eye = [Math.sin(t * 0.09) * 0.5, 1.85 + Math.sin(t * 0.13) * 0.1, 0];
    const c = camera(eye, [eye[0] * 0.4, eye[1] - 0.12, 10], 1.0, Math.sin(t * 0.07) * 0.015, 0.1, 500);
    const set = u => { F.set(u); setCam(u, c); gl.uniform1f(u.uCell, cell); gl.uniform1f(u.uSnap, camZ - row * cell); gl.uniform1f(u.uRow, row % 4096); };
    beginMS(); quad(this.sky, set);
    gl.enable(gl.DEPTH_TEST); mesh(this.land, grid(128), set); endMS(out);
  } });
}
