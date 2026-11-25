
// ───────────────────────── Geodesic World: a dome of triangular plates lifting off a lit core ─────────────────────────
{
// A real geodesic sphere: an icosahedron with every face split into FREQ² triangles. Each triangle is one
// instance (a little prism: a top plate and three walls) that lifts along its own normal with its band.
const GEO_FREQ = 9;
function geoTris(f) {
  const t = (1 + Math.sqrt(5)) / 2;
  const V = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(norm);
  const F = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  const out = [];
  for (const [ia, ib, ic] of F) {
    const a = V[ia], b = V[ib], c = V[ic];
    const P = (i, j) => norm([0, 1, 2].map(k => a[k] + (b[k] - a[k]) * i / f + (c[k] - a[k]) * j / f));
    for (let i = 0; i < f; i++) for (let j = 0; j < f - i; j++) {
      out.push(...P(i, j), ...P(i + 1, j), ...P(i, j + 1), out.length / 10);
      if (i + j < f - 1) out.push(...P(i + 1, j), ...P(i + 1, j + 1), ...P(i, j + 1), out.length / 10);
    }
  }
  return new Float32Array(out);
}
const VS_GEO = VSP + `
layout(location=1) in vec3 aA; layout(location=2) in vec3 aB; layout(location=3) in vec3 aC; layout(location=4) in float aId;
uniform vec3 uPole;
out vec3 vW, vN, vB; out float vBand, vDepth, vWave; flat out float vWall;
void main(){
  vec3 cen = normalize(aA+aB+aC);
  float band = clamp(fbm(cen*1.5+vec3(0.,uTravel*.06,uTime*.02))*2.-.5, 0., 1.);     // continents of bands; they drift faster when the music is fuller
  float s = specS(.02+band*.8);
  float wv = ring(acos(clamp(dot(cen, uPole),-1.,1.)), 1.9, .3, 1.7);               // each kick: a wave crosses the world from a wandering pole
  float lift = .015+s*s*.34*(.55+.75*uDyn)+wv*.17+uKick*.05*hashu(uint(aId)); vWave = wv;
  vec3 P[3] = vec3[3](aA, aB, aC); int v = gl_VertexID; vec3 d; float top = 1.;
  if (v < 3){ d = P[v]; vN = cen; vB = vec3(v == 0, v == 1, v == 2); vWall = 0.; }
  else { int q = (v-3)/6, w = (v-3)%6, c0 = q, c1 = (q+1)%3;
    bool second = (w == 1 || w == 3 || w == 4), isTop = (w == 0 || w == 1 || w == 3);
    d = second ? P[c1] : P[c0]; top = isTop ? 1. : 0.;
    vec3 nn = normalize(cross(P[c1]-P[c0], cen)); if (dot(nn, (P[c0]+P[c1])*.5-cen) < 0.) nn = -nn;
    vN = nn; vB = vec3(second ? 1. : 0., 0., top); vWall = 1.; }
  d = normalize(mix(cen, d, .9));                                                    // a gap between plates lets the core show
  vW = d*(top > .5 ? 1.+lift : .93)*(1.+.03*uBassS); vBand = band;
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_GEO = FSH + `
in vec3 vW, vN, vB; in float vBand, vDepth, vWave; flat in float vWall; out vec4 o;
void main(){
  vec3 n = normalize(vN), v = normalize(uEye-vW); float s = spec(.02+vBand*.8);
  vec3 lc = neon(.5+vBand*.5+vWave*.3), col; lc *= 1.+1.2*vWave+.5*uDrop;
  if (vWall < .5){
    float e = min(vB.x, min(vB.y, vB.z)), fe = max(fwidth(e), 1e-4);
    float line = 1.-smoothstep(.8,2.,e/fe), glow = exp(-e*13.);
    float fr = pow(1.-max(dot(n,v),0.), 3.); vec3 r = reflect(-v, n);
    col = vec3(.012,.014,.028) + lc*.02 + vivid(.62)*fr*.22;                         // dark glass plates
    col += (vivid(.62)*.4+.6)*pow(max(dot(r, normalize(vec3(-.5,.7,.5))),0.), 12.)*.7;   // whole facets flash as the world turns
    col += neon(.0)*pow(max(dot(r, normalize(vec3(.8,-.1,.4))),0.), 14.)*.25*(.4+uMidS);
    col += lc*(line*(.3+2.3*s*s)+glow*(.03+.42*s*s));
  } else {
    float edge = min(vB.x, 1.-vB.x);
    col = lc*exp(-vB.z*3.2)*(.12+.9*s*s)*(.5+uBass+.9*uKick) + lc*(1.-smoothstep(0.,.04,edge))*.2*vB.z;   // walls: lit from the core
  }
  o = vec4(col, vDepth);
}`;
const VS_GEO_CORE = VSH + `out vec3 vD; void main(){ vD = octDir(aUV); gl_Position = uVP*vec4(vD*.925, 1.); }`;
const FS_GEO_CORE = FSH + `
in vec3 vD; out vec4 o;
void main(){ vec3 d = normalize(vD); float f = fbm(d*4.+vec3(0.,uTime*.2,0.));
  o = vec4((neon(.08)*.6+neon(.92)*.4)*(.3+.9*f)*(.5+1.5*uBass+2.2*uKick+uDrop), 6.); }`;
const VS_GEO_RING = VSH + `
uniform mat3 uTilt; out vec2 vP;
void main(){ float a = aUV.x*TAU, r = mix(1.72, 2.72, aUV.y); vP = aUV; gl_Position = uVP*vec4(uTilt*vec3(cos(a)*r, 0., sin(a)*r), 1.); }`;
const FS_GEO_RING = FSH + `
in vec2 vP; out vec4 o;
void main(){
  const float NT = 240.; float u = vP.x, v = vP.y, cell = floor(u*NT), fu = fract(u*NT), band = abs((cell+.5)/NT*2.-1.);
  float sS = specS(.02+band*.82), s = spec(.02+band*.82), fwu = max(fwidth(u*NT), 1e-4), fwv = max(fwidth(v), 1e-4);
  float tick = (1.-smoothstep(.2,.2+fwu, abs(fu-.5)))*(1.-smoothstep(.35,1.,fwu));
  float len = .1+.72*sS*sS;                                                          // each tick is a band, mirrored round the ring
  float body = tick*smoothstep(.1-fwv, .1+fwv, v)*(1.-smoothstep(.1+len-fwv, .1+len+fwv, v));
  float rails = (1.-smoothstep(.5,1.8,abs(v-.07)/fwv)) + (1.-smoothstep(.5,1.8,abs(v-.93)/fwv))*.5;
  float wv = .5+wave(abs(u*2.-1.)*.5)*(.08+.25*uLevelS), trace = 1.-smoothstep(.6,2.,abs(v-wv)/fwv);
  vec3 lc = neon(.5+band*.5);
  o = vec4(lc*body*(.1+1.5*s*s) + vivid(.62)*rails*(.2+.25*uKick) + (lc*.4+.6)*trace*(.1+.6*uLevel), 1.);
}`;
const FS_GEO_BG = FSH + `
out vec4 o;
void main(){ vec3 rd = viewRay(); vec3 col = vec3(.002,.0022,.006) + vivid(.62)*.014*fbm(rd*2.2+4.) + neon(.0)*.006*fbm(rd*1.4-3.);
  col += stars(rd)*.8;
  float tca = -dot(uEye, rd), b = length(cross(uEye, rd));
  if (tca > 0.) col += neon(.5)*exp(-max(b-1.2,0.)*4.5)*(.05+.1*uBassS+.1*uKick);     // air on the limb
  o = vec4(col, 80.); }`;
scene({ id: 'geo', name: 'Geodesic World', from: 'Neon', kind: 'sphere', group: 'refined', pal: 4, hue: (t, travel) => t * 0.012 + travel * 0.02,
  about: 'A geodesic dome of 1,620 glass triangles lifting off a lit core in drifting continents of bands, ringed by a spectrum dial',
  inputs: ['specS', 'spec', 'wave', 'bassS', 'midS', 'levelS', 'bass', 'level', 'kick', 'pulse', 'dyn', 'drop', 'travel'],
  cost: 'Cheap: 1,620 instanced prisms (34k vertices), a small core sphere and one ring quad-strip.',
  post: { bloom: 0.42, thr: 0.9, knee: 0.6, ca: 0.5 },
  init() {
    this.bg = program(VS, FS_GEO_BG); this.plates = program(VS_GEO, FS_GEO); this.core = program(VS_GEO_CORE, FS_GEO_CORE); this.ring = program(VS_GEO_RING, FS_GEO_RING);
    const data = geoTris(GEO_FREQ); this.n = data.length / 10;
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    [[1, 3, 0], [2, 3, 12], [3, 3, 24], [4, 1, 36]].forEach(([loc, size, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 40, off); gl.vertexAttribDivisor(loc, 1); });
    gl.bindVertexArray(vao);
    const a = 0.42, b = -0.22, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    this.tilt = [cb, sb, 0, -sb * ca, cb * ca, sa, sb * sa, -cb * sa, ca];           // Rx(a) · Rz(b), column-major
  },
  draw(F, out) {
    const t = F.time, c = camera(orbit(t * 0.05 + F.travel * 0.022, 0.24 + Math.sin(t * 0.06) * 0.14, 6.4 - A.bassS * 0.14 - A.kick * 0.22), [0, -0.05, 0], 0.74, 0, 0.1, 60);
    const pole = norm([Math.sin(t * 0.23), Math.sin(t * 0.17) * 0.8, Math.cos(t * 0.19)]);
    const set = u => { F.set(u); setCam(u, c); gl.uniform3fv(u.uPole, pole); };
    beginMS(); quad(this.bg, set);
    gl.enable(gl.DEPTH_TEST); mesh(this.core, grid(48), set);
    gl.useProgram(this.plates.p); set(this.plates.u); gl.bindVertexArray(this.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 21, this.n); gl.bindVertexArray(vao);
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    mesh(this.ring, grid(128), u => { set(u); gl.uniformMatrix3fv(u.uTilt, false, this.tilt); });
    endMS(out);
  } });
}
