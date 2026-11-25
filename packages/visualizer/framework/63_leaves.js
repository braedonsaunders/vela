
// ───────────────────────── Falling Leaves: autumn leaves tumbling through low sun, carried by gusts ─────────────────────────
{
const LEAF_N = 800;
const LEAF_BG = `
vec3 autumn(float t){ return vec3(.7,.36,.1)+vec3(.28,.27,.07)*cos(TAU*(t*vec3(.8,.9,1.)+vec3(0.,.1,.2))); }      // gold, through orange and red, to brown
const vec3 LSUN = vec3(.44, .5, .745);                                           // the sun is ahead and above: the leaves are lit from behind
vec3 sunC(){ return mix(vec3(1.,.74,.42), neon(.1), .12)*(.85+.3*uBassS+.5*uKick+.4*uDrop); }`;
const VS_LEAF = VSP + LEAF_BG + `
uniform float uFall, uWind;
out vec2 vUV; out vec3 vN, vT, vW; out vec3 vH; out float vDepth;
void main(){
  uint id = uint(gl_InstanceID)*7u;
  float h1 = hashu(id), h2 = hashu(id+1u), h3 = hashu(id+2u), h4 = hashu(id+3u), h5 = hashu(id+4u), h6 = hashu(id+5u), h7 = hashu(id+6u);
  const vec3 BOX = vec3(22., 13., 13.);                                          // larger than the view at every depth, so a leaf only ever wraps out of sight
  float sp = .6+.8*h4, ph = uFall*sp+uWind*.35+h5*40.;                           // its own weight, and its own clock, wound by the fall and the wind
  float sway = sin(ph*1.7+h6*6.)*.5+sin(ph*.9+h1*9.)*.35;
  vec3 c = vec3(mod(h1*BOX.x+uWind*(.6+.6*h6)+sway, BOX.x)-BOX.x*.5, mod(h2*BOX.y-uFall*sp, BOX.y)-BOX.y*.5, h3*h3*BOX.z+1.4);
  float a1 = ph*2.1+h7*6.28, a2 = ph*1.3+h1*6.28+sway*.8, a3 = h3*6.28+sin(ph*.7)*.6;                      // tumbling
  float c1 = cos(a1), s1 = sin(a1), c2 = cos(a2), s2 = sin(a2), c3 = cos(a3), s3 = sin(a3);
  mat3 R = mat3(c3,s3,0., -s3,c3,0., 0.,0.,1.)*mat3(c2,0.,-s2, 0.,1.,0., s2,0.,c2)*mat3(1.,0.,0., 0.,c1,s1, 0.,-s1,c1);
  vec2 q = vec2(float(gl_VertexID == 1 || gl_VertexID == 2 || gl_VertexID == 4), float(gl_VertexID == 2 || gl_VertexID == 4 || gl_VertexID == 5));
  float sz = .26+.34*h4*h4;
  vW = c+R*vec3((q.x-.5)*sz*.82, (q.y-.5)*sz*1.3, 0.); vN = R[2]; vT = R[0]; vUV = q; vH = vec3(h6, h7, h5);
  gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const FS_LEAF = FSH + LEAF_BG + `
in vec2 vUV; in vec3 vN, vT, vW; in vec3 vH; in float vDepth; out vec4 o;
void main(){
  vec2 p = vUV*2.-1.; float yy = vUV.y, lobed = step(.6, vH.x);
  // the outline: a pointed oval, toothed, and for some leaves lobed; a stalk at the foot
  float w = sin(PI*pow(clamp((yy-.1)/.9, 0., 1.), .75))*(1.-.4*yy)*.88;
  w *= 1.+lobed*.22*sin(yy*PI*5.5)+.035*sin(yy*70.);
  float d = abs(p.x)-w, stalk = step(yy, .14)*step(abs(p.x), .035);
  if (d > 0. && stalk < .5) discard;
  float rib = smoothstep(.05, .012, abs(p.x)), vv = fract(yy*7.5-abs(p.x)*2.4), veins = max(rib, smoothstep(.1, 0., abs(vv-.5))*smoothstep(0., -.15, d)*.7);
  vec3 n = normalize(vN+vT*p.x*.7*(vH.z-.3)); if (!gl_FrontFacing) n = -n;            // the blade is cupped
  vec3 V = normalize(uEye-vW), sc = sunC();
  float ndl = dot(n, LSUN), lit = max(ndl, 0.), thru = max(-ndl, 0.);
  vec3 base = mix(autumn(vH.y*.75), neon(vH.y), .1)*(.75+.5*noise(vec3(vUV*5., vH.x*20.)));
  base *= 1.-.5*smoothstep(.55,.8, noise(vec3(vUV*9., vH.y*30.)));                   // blemishes
  base *= .8+.2*smoothstep(0., -.2, d);                                             // a darker, drier edge
  vec3 col = base*(.07+.5*lit*sc);
  col += pow(base, vec3(.7))*sc*thru*1.5*(1.-.5*veins);                              // sunlight coming through the leaf; the veins show dark against it
  col += sc*pow(max(dot(reflect(-LSUN, n), V), 0.), 24.)*.3*lit;
  col *= 1.-.25*veins*lit;
  o = vec4(col*exp(-vDepth*.02), vDepth);
}`;
const FS_LEAF_BG = FSH + LEAF_BG + `
out vec4 o;
float bokeh(vec2 q, float sc, float seed){ vec2 g = q*sc, c = floor(g); float s = 0.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 cc = c+vec2(float(i), float(j)); float h = hash2(cc+seed);
    if (h < .55) continue; vec2 ctr = cc+.5+.6*(vec2(hash2(cc+seed+3.), hash2(cc+seed+7.))-.5); float r = .22+.3*hash2(cc+seed+11.), dd = length(g-ctr)/r;
    s += (smoothstep(1., .9, dd)*(.55+.45*smoothstep(.6, .95, dd)))*(h-.55)*2.2*(.55+.45*sin(uTime*(.6+h*1.5)+h*40.)); }
  return s; }
void main(){
  vec2 q = (gl_FragCoord.xy*2.-uRes)/uRes.y, sp = vec2(1.05, .78); float ds = length(q-sp);
  vec3 sc = sunC();
  // an out-of-focus wood: dark trunks, warm light pouring in from the upper right
  vec3 col = mix(vec3(.008,.012,.006), vec3(.05,.036,.012), smoothstep(-1., 1., q.y+q.x*.4));
  col += sc*(exp(-ds*1.8)*.16+exp(-ds*5.)*.6);
  float trunks = smoothstep(.5,.72, noise(vec3(q.x*1.6+3., q.y*.08, 1.)))*.75+smoothstep(.6,.8, noise(vec3(q.x*4.1+9., q.y*.1, 4.)))*.4;
  col *= 1.-clamp(trunks, 0., .85)*(1.-exp(-ds*1.2)*.7);
  // shafts of light between the trunks; each one is a band
  float ang = atan(q.y-sp.y, q.x-sp.x), band = fract(ang/PI*2.+.5), shaft = pow(noise(vec3(ang*7., uTime*.07, 2.)), 2.);
  col += sc*shaft*(.25+2.6*spec(.05+band*.6))*exp(-ds*1.1)*.1*smoothstep(.15,.6,ds);
  col += (sc*.6+autumn(.1)*.4)*bokeh(q, 2.6, 1.)*.07*(.6+1.2*uHigh)+autumn(.3)*bokeh(q+3., 4.6, 9.)*.05*(.6+1.2*uHigh);
  o = vec4(col, 60.);
}`;
scene({ id: 'leaves', name: 'Falling Leaves', from: 'Organic', kind: 'nature', group: 'organic', pal: 3, hue: () => 0,
  about: 'Autumn leaves tumbling through low sun in an out-of-focus wood: the bass is the wind, every kick is a gust, the light swells with the music, and a big moment lifts them all',
  inputs: ['spec', 'bassS', 'levelS', 'high', 'kick', 'dyn', 'drop'],
  cost: 'Light geometry (1,100 quads); depth of field is most of the cost. Phones: 400 leaves and a 12-tap blur.',
  post: { dof: { ap: 9, max: 12 }, bloom: 0.5, thr: 0.95, knee: 0.7, spread: 0.72, exp: 1.05, ca: 0.3, vig: 0.75, pulse: 0.4 },
  init() { this.bg = program(VS, FS_LEAF_BG); this.leaf = program(VS_LEAF, FS_LEAF); this.fall = 0; this.wind = 0; },
  draw(F, out) {
    const t = F.time;
    this.fall += F.dt * (0.35 + 0.6 * A.levelS + 0.35 * A.dyn - 0.55 * A.accent - 1.3 * A.drop);   // strong beats hold them up a moment          // a big moment lifts them
    this.wind += F.dt * (0.2 + 1.6 * A.bassS + 3.4 * A.kick + 2.2 * A.accent);                          // every kick is a gust
    const c = camera([Math.sin(t * 0.07) * 0.3, Math.sin(t * 0.05) * 0.2, 0], [0, 0.35, 10], 0.75, Math.sin(t * 0.06) * 0.03, 0.2, 80);
    const set = u => { F.set(u); setCam(u, c); gl.uniform1f(u.uFall, this.fall % 100000); gl.uniform1f(u.uWind, this.wind % 100000); };
    F.focus = 6;
    beginMS(); quad(this.bg, set);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(this.leaf.p); set(this.leaf.u); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, LEAF_N);
    endMS(out);
  } });
}
