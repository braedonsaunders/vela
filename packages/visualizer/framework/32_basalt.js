
// ───────────────────────── Basalt Ridge: a solid, wet volcanic canyon flown toward the last light ─────────────────────────
{
const BAS_FN = `
uniform float uCell; uniform vec2 uSnap;
const float RIVER = 3.4;
float bend(float zw){ return sin(zw*.031)*3.2+sin(zw*.013+2.)*2.6; }
float ridged(vec2 w){ vec3 q = vec3(w*.055, 0.); float n = 0., a = .5, k = 1.;
  for (int i = 0; i < 5; i++){ float v = 1.-abs(2.*noise(q)-1.); v *= v; n += a*v*k; k = clamp(v*1.7, .3, 1.); q = q*2.03+vec3(3.1,1.7,0.); a *= .5; }
  return n; }
float basH(vec2 w, float zl){                        // w: world xz (the rock is fixed to the world), zl: distance ahead
  float ax = abs(w.x-bend(w.y)), bank = smoothstep(RIVER, 15., ax), f = clamp((ax-RIVER)/72., 0., 1.);
  float far = 1.-smoothstep(178., 200., zl);
  float sw = hist(.03+f*.25, max(zl,0.)/190.);                              // each beat's swell runs away up the canyon
  return bank*far*(.2+ridged(w)*(7.+ax*.34)*((.42+1.25*specS(.015+f*.8))*(.55+.6*uDyn)+.08*uKick)+sw*sw*1.5);
}`;
const BAS_SKY = `
vec3 basSky(vec3 rd){
  float y = max(rd.y, 0.), az = atan(rd.x, rd.z);
  vec3 hor = neon(.08)*.85+neon(.0)*.15;                                         // the glow where the sun went down
  vec3 col = mix(hor*.07*(.6+.5*uBassS+.5*uKick)+vivid(.62)*.03, vec3(.003,.005,.014)+neon(.62)*.03, 1.-exp(-y*5.));
  col += hor*exp(-az*az*3.5)*exp(-y*13.)*(.4+.4*uBassS+1.2*uKick+.8*uDrop);
  vec2 cp = rd.xz/(rd.y+.12);                                                   // a cloud deck, lit from underneath
  float cl = smoothstep(.45,.8, fbm(vec3(cp.x*.4, cp.y*1.5+uTime*.012, 1.)))*exp(-y*2.4)*smoothstep(0.,.05,rd.y);
  col = mix(col, col*.3+hor*(.12+.2*uBassS+.34*uKick+.3*uDrop)*exp(-y*4.5)*exp(-az*az*1.2), cl*.75);
  col += neon(.62)*cl*uSnare*.07*noise(vec3(cp*.5, uTime*.3));                 // snares flicker in the cloud like far lightning
  col += stars(rd)*.6*smoothstep(.22,.5,rd.y)*(1.-cl);
  return col;
}`;
const VS_BAS = VSH + BAS_FN + `
out vec3 vW, vN; out float vDepth;
void main(){
  vec2 g = vec2(aUV.x*256.-128., aUV.y*256.-6.);
  float zl = g.y*uCell+uSnap.x, x = g.x*uCell, zw = g.y*uCell+uSnap.y, e = uCell*.5;
  float h = basH(vec2(x, zw), zl);
  vW = vec3(x, h, zl);
  vN = normalize(vec3(h-basH(vec2(x+e, zw), zl), e, h-basH(vec2(x, zw+e), zl+e)));
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_BAS_SKY = FSH + BAS_FN + BAS_SKY + `
out vec4 o; void main(){ o = vec4(basSky(viewRay()), 500.); }`;
const FS_BAS = FSH + BAS_FN + BAS_SKY + `
in vec3 vW, vN; in float vDepth; out vec4 o;
void main(){
  vec3 v = normalize(vW-uEye), n = normalize(vN); float dist = length(vW-uEye);
  vec2 w = vec2(vW.x, vW.z-uSnap.x+uSnap.y); float dxr = w.x-bend(w.y), ax = abs(dxr);                                   // world-locked, for detail that must not swim
  float f = clamp((ax-RIVER)/72., 0., 1.), s = spec(.015+f*.8), steep = 1.-n.y;
  vec3 lc = neon(.55+f*.3+vW.y*.02), hot = neon(.06)*.7+.3, col;
  float river = 1.-smoothstep(RIVER-.5, RIVER+.1, ax);
  // micro-relief on the rock, slow ripples on the water
  vec2 dp = w*mix(1.9, .7, river); float e = .12, t = uTime*.5*river, k = mix(1.1, .22, river)/(1.+dist*.05);
  vec2 gr = vec2(noise(vec3(dp+vec2(e,0.),t))-noise(vec3(dp-vec2(e,0.),t)), noise(vec3(dp+vec2(0.,e),t))-noise(vec3(dp-vec2(0.,e),t)));
  n = normalize(mix(n, vec3(0.,1.,0.), river)+vec3(gr.x,0.,gr.y)*k);
  vec3 r = reflect(v, n); r.y = abs(r.y)+.003; r = normalize(r);
  float c = max(dot(n,-v),0.), fr = pow(1.-c, 5.);
  float wet = mix(smoothstep(.35,.7, noise(vec3(w*.35, 5.))), 1., river);
  vec3 alb = mix(vec3(.02,.021,.027), vec3(.085,.082,.09), noise(vec3(w*.8, 2.))*noise(vec3(w*3.1, 7.))*1.6);
  vec3 sunL = normalize(vec3(0.,.1,1.));
  float lit = pow(clamp(dot(n, sunL)*.5+.5, 0., 1.), 6.);
  col = alb*((n.y*.5+.5)*(neon(.62)*.42+.01) + hot*lit*.5)*(1.-river);              // rock: cool sky fill, warm grazing light         // rock: cool sky fill, warm grazing light
  col += basSky(r)*mix((.01+.4*fr)*mix(.15, 1., wet), .1+.9*fr, river);            // wet stone and water mirror the horizon
  // glowing strata on the canyon walls; each kick sends a swell of light away along them
  float iso = vW.y*2.1, fwi = max(fwidth(iso), .01);
  float line = (1.-smoothstep(.3,1.3,abs(fract(iso-.5)-.5)/fwi))*(1.-smoothstep(.3,.9,fwi))*smoothstep(.12,.4,steep)*(1.-river);
  float sw = hist(.04+f*.3, dist/190.);
  col += lc*line*((.015+.5*s*s+2.6*sw*sw*sw)*exp(-dist*.03)+1.3*ring(dist, 80., 7., 2.)*exp(-dist*.012))*smoothstep(.3,.55,steep);
  col += hot*smoothstep(.8,1.,n.y)*smoothstep(2.6,6.5,vW.y)*(.15+2.4*s*s+.9*uKick+uDrop);  // the crests catch fire with their bands
  col += lc*exp(-abs(ax-RIVER+.3)*3.)*noise(vec3(w*.6, uTime*.2))*(.008+.04*uBass+.08*uKick)*exp(-dist*.03);   // a faint glow lapping the shore   // the shoreline
  float xw = wave(dist*.012)*(.15+.6*uLevelS);
  col += (hot*.6+lc*.4)*exp(-abs(dxr-xw)*(9.-dist*.03))*(.05+.35*uLevel)*exp(-dist*.03)*river*(.5+.5*noise(vec3(w.y*1.5, uTime, 0.)));   // the waveform, floating down the river
  float fog = 1.-exp(-dist*.0085); fog = mix(fog, 1., smoothstep(160., 198., dist));
  col = mix(col, basSky(normalize(vec3(v.x, .02+max(v.y,0.)*.3, v.z))), fog*fog*(3.-2.*fog));
  o = vec4(col, vDepth);
}`;
const bend = z => Math.sin(z * 0.031) * 3.2 + Math.sin(z * 0.013 + 2) * 2.6;
scene({ id: 'basalt', name: 'Basalt Ridge', from: 'Neon', kind: 'terrain', group: 'refined', pal: 3, hue: t => Math.sin(t * 0.04) * 0.05,
  about: 'A solid, rain-wet volcanic canyon flown toward the last light: ridges rise with their bands, strata glow, the river carries the waveform',
  inputs: ['specS', 'spec', 'hist', 'wave', 'bassS', 'levelS', 'bass', 'level', 'kick', 'snare', 'pulse', 'dyn', 'drop', 'travel'],
  cost: 'Moderate: 131k triangles with three five-octave height lookups a vertex, and the sky evaluated twice a pixel. Phones: a 160 grid and three octaves.',
  post: { bloom: 0.45, thr: 1.0, knee: 0.6, spread: 0.74, exp: 1.1, ca: 0.4, vig: 0.85 },
  init() { this.sky = program(VS, FS_BAS_SKY); this.land = program(VS_BAS, FS_BAS); },
  draw(F, out) {
    const cell = 0.8, camZ = F.travel * 6, snap = Math.floor(camZ / cell) * cell, t = F.time, zw = (snap % 65536) + camZ - snap;
    const eye = [bend(zw + 4) + Math.sin(t * 0.15) * 0.5, 2.6 + Math.sin(t * 0.23) * 0.35 + A.bassS * 0.3, 0];
    eye[1] += A.kick * 0.14;
    const c = camera(eye, [bend(zw + 26), eye[1] + 0.9 - A.kick * 0.5, 24], 1.0 - A.kick * 0.05 + A.dyn * 0.05, Math.sin(t * 0.1) * 0.035, 0.1, 600);
    const set = u => { F.set(u); setCam(u, c); gl.uniform1f(u.uCell, cell); gl.uniform2f(u.uSnap, snap - camZ, snap % 65536); };
    beginMS(); quad(this.sky, set);
    gl.enable(gl.DEPTH_TEST); mesh(this.land, grid(256), set); endMS(out);
  } });
}
