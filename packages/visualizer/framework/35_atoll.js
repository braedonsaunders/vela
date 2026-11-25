
// ───────────────────────── Isoline Atoll: an island drawn only in contour lines, its hills raised by the music ─────────────────────────
{
// Seven hills stand on a shelf. Each belongs to a stretch of the spectrum, from the broad bass hill to the
// sharp treble peaks; its height follows that stretch on a slow envelope, so the land swells and settles
// and the contours redraw themselves smoothly. The light on each hill's lines follows the same band, faster.
const ATOLL_FN = `
uniform vec4 uHill[7];                       // x, z, spread and height of each hill
uniform float uLit[7];                       // how brightly its band is sounding now
vec2 atollH(vec2 p){                         // height, and the light of the nearest hills
  float r = length(p), h = 0., lit = 0., wsum = 1e-3;
  for (int i = 0; i < 7; i++){ vec2 d = p-uHill[i].xy; float g = exp(-dot(d,d)/(uHill[i].z*uHill[i].z)); h += uHill[i].w*g; lit += uLit[i]*g; wsum += g; }
  float shelf = exp(-r*r*.02);
  h += .5*shelf+.44*(fbm(vec3(p*.2, uTime*.012))-.5)*shelf;                 // the natural irregularity of land
  h += ring(r, 4.2, 1.7, 2.6)*.06*shelf;                                    // each kick: a low swell rolls outward
  return vec2(h*(1.-smoothstep(9.5, 12.5, r))-.13, lit/wsum); }`;
const VS_ATOLL = VSH + ATOLL_FN + `
out vec3 vW; out float vDepth, vLit;
void main(){ vec2 p = (aUV*2.-1.)*13., h = atollH(p); vW = vec3(p.x, h.x, p.y); vLit = h.y; gl_Position = uVP*vec4(vW,1.); vDepth = gl_Position.w; }`;
const FS_ATOLL = FSH + `
in vec3 vW; in float vDepth, vLit; out vec4 o;
void main(){
  if (length(vW.xz) > 12.6) discard;                                        // beyond the shelf there is only the sea chart
  float h = vW.y, r = length(vW.xz), iso = h*8., fw = max(fwidth(iso), .01), isoM = iso/5., fwM = max(fwidth(isoM), .003);
  float minor = (1.-smoothstep(.2,1.3,abs(fract(iso-.5)-.5)/fw))*(1.-smoothstep(.3,.9,fw));
  float major = (1.-smoothstep(.6,1.9,abs(fract(isoM-.5)-.5)/fwM))*(1.-smoothstep(.5,1.,fwM));
  float shore = 1.-smoothstep(.8,2.4,abs(h)/max(fwidth(h), 1e-4));
  float land = smoothstep(-.01,.01,h), up = clamp(h/2.6, 0., 1.), lit = vLit*vLit;
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); if (n.y < 0.) n = -n;
  vec3 v = normalize(uEye-vW), lc = mix(neon(.56+up*.42), vec3(1.,.95,.88), up*up*.5);       // sea-blue at the shore, warming toward the summits
  float beat = ring(r, 4.2, .9, 2.6);
  vec3 col = vec3(.004,.006,.012)*(.4+.8*max(dot(n, normalize(vec3(-.5,.7,.35))), 0.))+lc*up*up*.012+neon(.6)*pow(1.-max(dot(n,v),0.), 4.)*.03;   // dark glass under the lines
  col += lc*(minor*(.1+.9*lit)+major*(.42+1.9*lit))*land*(1.+.9*beat);
  col += (lc*.4+.6)*major*lit*lit*1.5*land;
  col += neon(.58)*(minor*.04+major*.1)*(1.-land)*exp(h*2.5);                               // soundings, fading with depth
  col += (neon(.56)*.5+.5)*shore*(.55+.5*uBassS+.5*beat);                                    // the shoreline is the brightest line
  col *= 1.-smoothstep(10.5, 12.8, r);
  o = vec4(col, vDepth);
}`;
const FS_ATOLL_BG = FSH + `
out vec4 o;
void main(){ vec3 rd = viewRay(); float depth = 120.;
  vec3 col = vec3(.0025,.0035,.008)+neon(.6)*.008*exp(-abs(rd.y)*3.);
  if (rd.y < -.002){ float t = (-.13-uEye.y)/rd.y; vec3 p = uEye+rd*t; float r = length(p.xz); depth = t;
    float fr = max(fwidth(r), 1e-4), rings = (1.-smoothstep(.6,1.6,abs(fract(r*.4-.5)-.5)/(fr*.4)))*smoothstep(11.5,12.6,r);
    float th = atan(p.z,p.x)/TAU*72., tick = (1.-smoothstep(.6,1.6,abs(fract(th-.5)-.5)/max(fwidth(th), 1e-4)))*smoothstep(.45,.0,abs(r-13.6)-.3);
    col += neon(.6)*(rings*.035+tick*.1+ring(r-10., 4.2, .5, 2.6)*.05)*exp(-max(r-12.,0.)*.1)*(.6+uLevelS); }
  o = vec4(col, depth); }`;
// which stretch of the spectrum each hill follows, where it stands, and how broad it is
const HILLS = [[0.00, 0.06, 0.2, -0.4, 3.3], [0.06, 0.14, -2.6, 1.6, 2.6], [0.14, 0.26, 2.9, 2.2, 2.2], [0.26, 0.4, -3.4, -2.6, 1.9],
               [0.4, 0.55, 3.6, -2.4, 1.6], [0.55, 0.72, -0.6, 4.3, 1.4], [0.72, 0.92, 0.9, -4.6, 1.2]];
scene({ id: 'atoll', name: 'Isoline Atoll', from: 'Fable', kind: 'terrain', group: 'refined', pal: 0,
  about: 'An island drawn only in contour lines: seven hills, one for each stretch of the spectrum, swell and settle slowly with the music while their lines brighten with it',
  inputs: ['bandsS (seven averages, smoothed again)', 'bands (seven averages)', 'bassS', 'levelS', 'pulse'],
  cost: 'Light: 131k triangles with one small fbm a vertex; depth of field is most of the cost. Phones: no depth of field.',
  post: { dof: { ap: 10, max: 8 }, bloom: 0.5, thr: 0.65, spread: 0.68, ca: 0.4, vig: 0.9, pulse: 0.3 },
  init() { this.bg = program(VS, FS_ATOLL_BG); this.land = program(VS_ATOLL, FS_ATOLL); this.h = new Float32Array(28); this.lit = new Float32Array(7); this.amp = new Float32Array(7); },
  draw(F, out) {
    const t = F.time, k = 1 - Math.exp(-F.dt * 1.5);
    HILLS.forEach(([lo, hi, x, z, sp], i) => { let s = 0, f = 0, n = 0;
      for (let b = Math.floor(lo * BANDS); b < hi * BANDS; b++) { s += A.bandsS[b]; f += A.bands[b]; n++; }
      this.amp[i] += (s / n - this.amp[i]) * k;                                       // form follows the band slowly: about a second
      this.lit[i] = f / n;
      this.h.set([x + Math.sin(t * 0.05 + i * 2.1) * 0.5, z + Math.cos(t * 0.04 + i * 1.3) * 0.5, sp, 0.25 + 2.5 * Math.pow(this.amp[i], 1.3)], i * 4); });
    const a = t * 0.05, R = 23, tgt = [0, 0.5, 0], eye = [Math.sin(a) * R, 12.5 + Math.sin(t * 0.07) * 1.5, Math.cos(a) * R];
    const c = camera(eye, tgt, 0.64, 0, 0.5, 200); F.focus = Math.hypot(...sub(eye, tgt)) * 0.97;
    const set = u => { F.set(u); setCam(u, c); gl.uniform4fv(u.uHill, this.h); gl.uniform1fv(u.uLit, this.lit); };
    beginMS(); quad(this.bg, set);
    gl.enable(gl.DEPTH_TEST); mesh(this.land, grid(256), set); endMS(out);
  } });
}
