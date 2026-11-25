
// ───────────────────────── Basalt Organ: a field of hexagonal columns; a drifting map decides which band each one plays ─────────────────────────
{
const HEX_NX = 84, HEX_NZ = 96;
const FS_HEX_SIM = VSP + `
out vec4 o;
void main(){ vec2 ij = floor(gl_FragCoord.xy);
  vec2 c = vec2(ij.x-${HEX_NX / 2}.+.5*mod(ij.y,2.), (ij.y-${HEX_NZ / 2}.)*.8660254);
  float n = fbm(vec3(c*.05, uTime*.04)), band = clamp(n*1.9-.45, 0., 1.), s = specS(.02+band*.8);
  float r = length(c), rip = hist(.03, r/44.);
  float val = s*(.22+.78*s*s) + rip*rip*rip*.4*exp(-r*.03), sf = spec(.02+band*.8);
  o = vec4(val, band, r, sf*(.22+.78*sf*sf) + rip*rip*rip*.4*exp(-r*.03)); }`;
const VS_HEX = VSP + `
uniform sampler2D uCols;
out vec3 vW, vN; out vec4 vI; out float vAO, vTop, vDepth, vF;
const float RAD = .5774*.93;
vec2 corner(int k){ float a = (float(k)*60.+30.)*PI/180.; return vec2(cos(a), sin(a))*RAD; }
float colH(vec4 t){ return .3+t.x*8.; }
void main(){
  ivec2 ij = ivec2(gl_InstanceID % ${HEX_NX}, gl_InstanceID / ${HEX_NX});
  vec4 t = texelFetch(uCols, ij, 0); float H = colH(t);
  vec2 c = vec2(float(ij.x)-${HEX_NX / 2}.+.5*float(ij.y & 1), (float(ij.y)-${HEX_NZ / 2}.)*.8660254);
  // how much taller the six neighbours stand: that is the shade on this column's cap
  int o1 = (ij.y & 1) == 0 ? -1 : 0; float occ = 0.;
  ivec2 nb[6] = ivec2[6](ivec2(-1,0), ivec2(1,0), ivec2(o1,-1), ivec2(o1+1,-1), ivec2(o1,1), ivec2(o1+1,1));
  for (int k = 0; k < 6; k++){ ivec2 q = clamp(ij+nb[k], ivec2(0), ivec2(${HEX_NX - 1}, ${HEX_NZ - 1})); occ += max(colH(texelFetch(uCols, q, 0))-H, 0.); }
  int v = gl_VertexID; vec3 p; float edge, top;
  if (v < 18){ int tri = v/3, w = v%3; vec2 q = w == 0 ? vec2(0.) : corner(tri+w-1);
    p = vec3(q.x, H, q.y); vN = vec3(0.,1.,0.); edge = w == 0 ? 1. : 0.; top = 1.; }
  else { int qd = (v-18)/6, w = (v-18)%6; bool isB = (w == 1 || w == 3 || w == 4), isT = (w == 0 || w == 1 || w == 3);
    vec2 a = corner(qd), b = corner(qd+1), q = isB ? b : a;
    p = vec3(q.x, isT ? H : -4., q.y); vec2 nn = normalize(a+b); vN = vec3(nn.x, 0., nn.y); edge = isB ? 1. : 0.; top = 0.; }
  vW = p+vec3(c.x, 0., c.y); vI = vec4(edge, t.x, t.y, top); vAO = 1./(1.+occ*.55); vTop = H; vF = t.w;
  gl_Position = t.z > 41. ? vec4(2.,2.,2.,1.) : uVP*vec4(vW,1.); vDepth = gl_Position.w;
}`;
const HEX_FOG = `vec3 hexFog(vec3 rd){ return vec3(.003,.0035,.008) + (vivid(.62)*.5+vec3(.2,.25,.5))*.035*exp(-abs(rd.y)*7.)*(.5+uBass+.5*uKick); }`;
const FS_HEX = FSH + HEX_FOG + `
in vec3 vW, vN; in vec4 vI; in float vAO, vTop, vDepth, vF; out vec4 o;
void main(){
  vec3 n = normalize(vN), v = normalize(uEye-vW), L = normalize(vec3(-.45,.75,.35));
  float val = vI.y; vec3 lc = neon(.45+vI.z*.6+val*.2), col;
  float lit = mix(val, vF, .7);                                         // light leads, height follows
  float fr = pow(1.-max(dot(n,v),0.), 4.);
  float v2 = lit*lit, v3 = v2*lit;
  if (vI.w > .5){
    float rim = 1.-smoothstep(.0,.085,vI.x), inner = smoothstep(.0,.9,vI.x);
    col = vec3(.05,.052,.064)*(.1+.9*max(dot(n,L),0.))*vAO + vivid(.62)*fr*.2*vAO;           // polished stone
    col += pow(max(dot(reflect(-L,n),v),0.), 80.)*.7*vAO;
    col += (vivid(.62)*.5+.5)*pow(max(dot(reflect(-v,n), normalize(vec3(.3,.5,-.8))),0.), 18.)*.35*vAO;   // a sheen that sweeps the caps
    col += (lc*rim*(.04+v2*5.) + (lc*.8+.2)*v3*(.7+1.6*inner))*(1.+.45*uKick);                                    // lit edge, glowing cap
  } else {
    float below = vTop-vW.y, e = min(vI.x, 1.-vI.x);
    col = vec3(.02,.021,.027)*(.08+.5*max(dot(n,L),0.))*exp(-below*.8) + vivid(.62)*fr*.015*exp(-below*.5);
    col += lc*exp(-below*(2.8-1.3*val))*v3*1.3;                                                 // light running down the shaft
    col += lc*(1.-smoothstep(0.,.045,e))*exp(-below*1.4)*(.015+v2*.7);
  }
  float dist = length(vW-uEye);
  col = mix(col, hexFog(-v), 1.-exp(-max(dist-22.,0.)*.035));
  o = vec4(col, vDepth);
}`;
const FS_HEX_BG = FSH + HEX_FOG + `
out vec4 o; void main(){ o = vec4(hexFog(viewRay()), 140.); }`;

scene({ id: 'hex', name: 'Basalt Organ', from: 'Fable', kind: 'terrain', group: 'refined', pal: 0,
  about: 'A field of hexagonal columns; a drifting map decides which band each one plays, and kicks ripple out from the middle',
  inputs: ['specS', 'spec', 'hist', 'bass', 'kick'],
  cost: 'Moderate: 8k instanced prisms plus depth of field. Phones: no depth of field.',
  post: { dof: { ap: 9, max: 7 }, bloom: 0.45, thr: 1.0, knee: 0.6, ca: 0.4, vig: 0.9 },
  init() { this.sim = program(VS, FS_HEX_SIM); this.cols = program(VS_HEX, FS_HEX); this.bg = program(VS, FS_HEX_BG);
    this.state = target(HEX_NX, HEX_NZ, HDR ? gl.RGBA16F : gl.RGBA8, gl.NEAREST); },
  draw(F, out) {
    draw(this.sim, this.state, HEX_NX, HEX_NZ, F.set);
    const t = F.time, a = t * 0.05, R = 37, tgt = [0, 1.8, 0];
    const eye = [Math.sin(a) * R, 14 + Math.sin(t * 0.08) * 3.5, Math.cos(a) * R];
    const c = camera(eye, tgt, 0.56, 0, 0.5, 300); F.focus = Math.hypot(...sub(eye, tgt)) * 0.95;
    const set = u => { F.set(u); setCam(u, c); bindTex(3, this.state.t); gl.uniform1i(u.uCols, 3); };
    beginMS(); quad(this.bg, set);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(this.cols.p); set(this.cols.u); gl.drawArraysInstanced(gl.TRIANGLES, 0, 54, HEX_NX * HEX_NZ);
    endMS(out);
  } });
}
