
// ───────────────────────── Mercury Tide: open ocean to the horizon under a low sun ─────────────────────────
{
// The surface is a grid projected from the camera onto the water plane, so it always reaches the horizon and
// spends its vertices evenly on screen. Seven trochoidal swells move it; six finer wind waves shade it.
const SEA_FN = `
const vec3 WV[7] = vec3[7](vec3(.05,61.,0.), vec3(-.32,37.,1.7), vec3(.41,23.,4.1), vec3(-.12,14.3,2.3), vec3(.63,8.9,5.2), vec3(-.55,5.7,.9), vec3(.22,3.6,3.3));
// displacement of the point at rest p; nrm takes the surface normal; px is the size of a pixel on the water,
// so waves too fine to draw are left out of the shading instead of shimmering
vec3 swell(vec2 p, float S, float px, out vec3 nrm){
  vec3 d = vec3(0.), n = vec3(0.,1.,0.); float warp = noise(vec3(p*.013, uTime*.03))*5.;
  for (int i = 0; i < 7; i++){
    float lam = WV[i].y, k = TAU/lam, w = sqrt(9.8*k)*.8; vec2 D = vec2(sin(WV[i].x), -cos(WV[i].x));     // they come toward you
    float grp = .55+.9*noise(vec3(p*(.9/lam)+WV[i].z*7., uTime*.04+WV[i].z));                          // waves travel in groups
    float a = pow(lam, .72)*.021*S*grp, ph = k*dot(D,p)-w*uTime+WV[i].z+warp*(.3+.1*float(i)), c = cos(ph), s = sin(ph);
    float keep = 1.-smoothstep(.2,.5,px/lam);
    d += vec3(D.x*.55*a*c, a*s, D.y*.55*a*c);
    n += vec3(-D.x*k*a*c, -.55*k*a*s, -D.y*k*a*c)*keep;
  }
  nrm = n; return d; }`;
const SEA_SKY = `
const vec3 SUN = vec3(0., .0747, .9972);
vec3 sunCol(){ return mix(vec3(1.,.6,.3), neon(.1), .25); }
vec3 tint(vec3 c, float t){ return mix(c, neon(t)*dot(c, vec3(.4)), .22); }      // natural colours, leaning a little toward the palette
vec3 seaSky(vec3 rd, float lod){                       // lod 0: no clouds or stars (for reflections and haze)
  float y = max(rd.y, 0.), sa = clamp(dot(rd, SUN), 0., 1.), a = acos(sa);
  vec3 sc = sunCol();
  vec3 zen = tint(vec3(.012,.022,.075), .62), hi = tint(vec3(.1,.085,.26), .7), mid = tint(vec3(.5,.17,.25), .85), hor = tint(vec3(.95,.4,.13), .05);
  vec3 col = mix(hor, mid, smoothstep(0.,.11,y)); col = mix(col, hi, smoothstep(.05,.24,y)); col = mix(col, zen, smoothstep(.2,.6,y));
  col *= mix(.35, 1., exp(-a*1.6))*(.48+.3*uDyn+.15*uBassS+.22*uKick);                                 // warm toward the sun, cooler away from it
  col += sc*(exp(-a*22.)*.9+exp(-a*5.)*.12*(.7+.7*uBassS))*(1.+.7*uKick+.6*uDrop);
  col += sc*smoothstep(.034,.029,a)*30.*lod;
  // spokes of light from the sun: each angle is a band
  vec2 sp = vec2(rd.x, rd.y-SUN.y); float ang = atan(sp.y, abs(sp.x))/PI+.5, ray = spec(.03+ang*.7);
  col += sc*ray*ray*(.45+.55*noise(vec3(ang*38., uTime*.15, 1.)))*exp(-a*5.)*smoothstep(.03,.2,a)*.1*(1.+uDrop);
  float pulse = ring(a, .55, .1, 1.7);                                           // each kick: a ring of light crosses the sky from the sun
  col += sc*pulse*.06;
  if (lod > .5 && rd.y > 0.){
    vec2 cp = rd.xz/(rd.y+.09); vec2 sunP = vec2(0., 1.);
    // a low bank of cloud, lit from behind and below
    vec2 ca = vec2(cp.x*.33+uTime*.006, cp.y*.6);
    float d1 = fbm(vec3(ca, uTime*.012)), d2 = fbm(vec3(ca+sunP*.35, uTime*.012));
    float den = smoothstep(.48,.76,d1), shade = exp(-2.6*smoothstep(.45,.8,d2));
    vec3 lit = mix(tint(vec3(.06,.05,.12), .7), tint(vec3(1.,.42,.26), .02), shade*exp(-a*.8))*(.45+.7*uBassS+.5*uKick+1.6*pulse);
    lit += sc*pow(sa, 6.)*den*(1.-den)*3.*(.8+uKick);                             // silver linings toward the sun
    col = mix(col, lit, den*exp(-y*2.6)*smoothstep(0.,.035,rd.y)*.9);
    // high, thin streaks that catch the last colour
    float cir = smoothstep(.45,.95, fbm(vec3(cp.x*.11+d1*.6, cp.y*.5, 7.+uTime*.008)));
    col += tint(vec3(1.,.4,.45), .9)*cir*.14*exp(-y*1.1)*smoothstep(.04,.2,rd.y)*(.6+.7*uMid+2.5*pulse);
    col += stars(rd)*smoothstep(.3,.65,rd.y)*(.4+1.6*uHigh)*(1.-den);
  }
  return col;
}`;
const VS_SEA = VSH + SEA_FN + `
out vec3 vW; out vec2 vP; out float vS, vDepth;
void main(){
  float x = (aUV.x*2.-1.)*1.5;
  float yh = -(uCamF.y+uCamR.y*x*uTan*uAspect)/(uCamU.y*uTan);                    // where the horizon crosses this column
  float y = mix(-1.9, yh-.003, pow(aUV.y, .8));
  vec3 rd = uCamF+uCamR*(x*uTan*uAspect)+uCamU*(y*uTan);
  float t = min(-uEye.y/min(rd.y, -1e-4), 6000.); vec2 p = uEye.xz+rd.xz*t; float dist = t*length(rd);
  float hs = hist(.04, dist/320.);                                               // each beat's set of bigger waves rolls out to sea
  float S = (.4+.95*uBassS+.4*uDyn+.3*uKick)*(.7+1.4*hs*hs);
  vec3 nn; vec3 d = swell(p, S, 0., nn)*(1.-smoothstep(2500., 5500., dist));
  vW = vec3(p.x, 0., p.y)+d; vP = p; vS = S;
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_SEA_SKY = FSH + SEA_SKY + `
out vec4 o; void main(){ o = vec4(seaSky(viewRay(), 1.), 900.); }`;
const FS_SEA = FSH + SEA_FN + SEA_SKY + `
in vec3 vW; in vec2 vP; in float vS, vDepth; out vec4 o;
void main(){
  vec3 v = normalize(vW-uEye); float dist = length(vW-uEye);
  float px = dist*uTan*2./uRes.y/max(-v.y, .03);
  vec3 nrm; swell(vP, vS, px, nrm);
  // wind ripples: three layers of drifting noise, laid on the moving surface itself so they neither stretch nor repeat
  vec2 wp = vW.xz; float chop = .5+1.3*uHighS, near = 1.-smoothstep(4., 60., dist); vec2 g = vec2(0.); float fm = 0.;
  for (int i = 0; i < 3; i++){ float fi = float(i), sc2 = .55*pow(2.6, fi), e = .12/sc2, keep = 1.-smoothstep(.15,.45,px*sc2*2.);
    vec3 q = vec3(wp*sc2+vec2(fi*7.3, -uTime*(.5+.35*fi)), uTime*(.25+.2*fi)+fi*3.);
    float n0 = noise(q), nx = noise(q+vec3(e*sc2,0.,0.)), nz = noise(q+vec3(0.,e*sc2,0.));
    g += vec2(nx-n0, nz-n0)/e*(.05/sqrt(sc2))*chop*keep; fm += n0*keep/(1.+fi); }
  nrm.xz -= g; vec3 n = normalize(nrm);
  vec3 r = reflect(v, n); r.y = abs(r.y)+.002; r = normalize(r);
  float c = max(dot(n,-v),0.), fr = .02+.98*pow(1.-c, 5.);
  vec3 sc = sunCol(), refl = seaSky(r, 0.);
  float hn = clamp(vW.y/(vS*1.4)+.5, 0., 1.);
  float toSun = pow(max(dot(normalize(v.xz), normalize(SUN.xz)), 0.), 4.);
  vec3 body = tint(vec3(.006,.026,.045), .6);
  body += tint(vec3(.05,.42,.38), .5)*hn*hn*hn*toSun*.22*(.7+.6*uBassS);     // light through the backs of the waves
  // foam: torn streaks that gather on the steep fronts of the bigger waves, only close by
  float hn2 = clamp(vW.y/(vS*1.1)+.35, 0., 1.), steep = smoothstep(.12, .4, length(nrm.xz)/nrm.y);
  float foam = smoothstep(.62, .95, hn2*steep*1.25+(noise(vec3(wp*vec2(2.1, 6.3)+vec2(0., uTime*.5), 1.))-.5)*.5+(fm-.9)*.2)*near*(.3+.7*uBassS);    // thin lace on the steepest fronts
  vec3 col = mix(body, refl, fr);
  col = mix(col, tint(vec3(.5,.52,.6), .7)*(.6+.8*dot(seaSky(vec3(0.,1.,0.), 0.), vec3(.6)))+sunCol()*.2, foam*.3);
  float sd = max(dot(r, SUN), 0.), rough = smoothstep(0., 700., dist);            // the far sea glitters broadly, the near sea sharply
  col += sc*(pow(sd, mix(900., 70., rough))*mix(26., 2.2, rough)+pow(sd, 14.)*.07)*(.7+.6*uKick+.4*uDrop)*fr*2.;
    float fog = 1.-exp(-dist*.0011); 
  col = mix(col, seaSky(normalize(vec3(v.x, .004, v.z)), 0.), fog*fog);
  o = vec4(col, vDepth);
}`;
scene({ id: 'sea', name: 'Mercury Tide', from: 'Fable', kind: 'terrain', group: 'refined', pal: 3, hue: t => 0.02 * Math.sin(t * 0.05),
  about: 'Open ocean to the horizon under a low sun: the bass raises the swell, each beat sends a set of bigger waves out to sea, and the sky answers',
  inputs: ['hist', 'spec', 'bassS', 'highS', 'mid', 'high', 'kick', 'pulse', 'dyn', 'drop'],
  cost: 'Moderate: seven swells, nine noise lookups for ripples and foam, and two cheap sky lookups a pixel; the sky itself is four fbm lookups. Phones: four swells, three wind waves, no cloud self-shadow.',
  post: { bloom: 0.5, thr: 1.1, knee: 0.6, spread: 0.72, exp: 1.0, ca: 0.4, vig: 0.8, pulse: 0.2 },
  init() { this.sky = program(VS, FS_SEA_SKY); this.surf = program(VS_SEA, FS_SEA); },
  draw(F, out) {
    const t = F.time;
    const eye = [Math.sin(t * 0.04) * 0.6, 3.6 + Math.sin(t * 0.06) * 0.12, 0];                 // a steady camera: the sea moves, the view does not
    const c = camera(eye, [Math.sin(t * 0.03) * 0.8, eye[1] - 4.6, 60], 0.95, Math.sin(t * 0.035) * 0.008, 0.5, 9000);
    const set = u => { F.set(u); setCam(u, c); };
    beginMS(); quad(this.sky, set);
    gl.enable(gl.DEPTH_TEST); mesh(this.surf, grid(256), set); endMS(out);
  } });
}
