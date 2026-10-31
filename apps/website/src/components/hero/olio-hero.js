// olio hero: "Many modules, one schema".
// Self-contained ES module, WebGL1, no dependencies.
// export function mount(el, { theme }) -> { setTheme(t), destroy() }
// mount() throws when WebGL is unavailable so the host keeps its static SVG.

const NB = 14;                 // black beads: 2 roots, 6 modules, 6 fields
const LOOP = 13.6;
const KEY_T = 11.0;            // reduced-motion still and "still" tier: full mark, no light bar
const TAU = Math.PI * 2;
const U = 1 / 28;              // logo viewBox units -> world (big lobe radius = 1)
const LOBE_A = [-34 * U, 0, 0], RA = 1;
const LOBE_B = [14 * U, 0, 0], RB = 22 * U;
const DROP_P = [52 * U, 0, 0], RD = 10 * U;
const K_NECK = 0.61;           // cubic smooth-min radius that reproduces the logo waist (from concept A)
const GROUND = -1.03;
const FONT = '"JetBrains Mono Variable", "JetBrains Mono", monospace';
const INK = 'rgba(23,21,26,';
const BURG = 'rgba(140,36,67,';

// Graph layout in a normalised ellipse; z in world units. p = parent index.
const NODES = [
  { p: -1, x: -0.40, y: 0.05, z: 0.0, r: 0.27 },
  { p: -1, x: 0.30, y: -0.05, z: 0.0, r: 0.23 },
  { p: 0, x: -0.76, y: 0.50, z: -0.3, r: 0.15, label: 'User' },
  { p: 0, x: -0.95, y: -0.14, z: 0.3, r: 0.14, label: 'Auth' },
  { p: 0, x: -0.44, y: -0.60, z: 0.2, r: 0.15, label: 'Post' },
  { p: 1, x: 0.46, y: 0.52, z: 0.3, r: 0.14, label: 'Cart' },
  { p: 1, x: 0.08, y: -0.62, z: -0.3, r: 0.13, label: 'Order' },
  { p: 1, x: 0.80, y: -0.36, z: 0.2, r: 0.13, label: 'Search' },
  { p: 2, x: -0.50, y: 0.90, z: 0.1, r: 0.07 },
  { p: 3, x: -1.02, y: 0.26, z: -0.2, r: 0.065 },
  { p: 4, x: -0.80, y: -0.90, z: 0.0, r: 0.07 },
  { p: 5, x: 0.18, y: 0.88, z: -0.2, r: 0.065 },
  { p: 6, x: 0.40, y: -0.94, z: 0.2, r: 0.06 },
  { p: 7, x: 1.02, y: -0.72, z: 0.0, r: 0.06 },
];
const DROPN = { x: 0.97, y: 0.20, z: 0.1, r: 0.17, label: '+ Billing' };
const XREF = [[4, 2], [6, 2], [7, 4]];
const DROP_EDGES = [5, 7];

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t * t;

(function prep() {
  NODES.forEach((n, i) => {
    n.lvl = n.p < 0 ? 0 : n.p < 2 ? 1 : 2;
    n.kids = [];
    n.ph = (i * 2.399) % TAU; n.ph2 = (i * 1.7 + 0.5) % TAU;
    n.vol = n.r * n.r * n.r;
  });
  NODES.forEach((n) => { if (n.p >= 0) NODES[n.p].kids.push(n); });
  // Staggered so only one or two blends happen at once: fewer lumps mid-merge.
  let li = 0, mi = 0;
  NODES.forEach((n) => {
    if (n.lvl === 2) { n.m0 = 3.7 + li * 0.15; n.md = 0.8; li++; }
    if (n.lvl === 1) { n.m0 = 4.3 + mi * 0.13; n.md = 0.9; mi++; }
    if (n.lvl === 0) { n.bd = 0; }
  });
  let bi = 0;
  [0, 1, 2].forEach((lvl) => NODES.forEach((n) => { if (n.lvl === lvl) { n.bd = 0.08 + bi * 0.045 + lvl * 0.12; bi++; } }));
  DROPN.ph = 1.1; DROPN.ph2 = 4.0; DROPN.bd = 0.5;
})();

const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}';

const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define NB ${NB}
#define NL 4
uniform vec4 uS[NB];
uniform float uK[NB];
uniform int uN;           // live beads, packed first: absorbed ones cost nothing
uniform vec4 uRed;
uniform vec3 uCam, uFwd, uRight, uUp;
uniform vec2 uRes, uTan;
uniform float uPx, uGround, uShadow, uGlow, uFade, uPhi, uAmt;
uniform vec3 uLc[NL], uLr[NL], uLu[NL], uLcol[NL];
uniform vec4 uLp[NL];

float mk[NB];
float mkRed;

float smin3(float a, float b, float k){ float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * h * k * 0.16666667; }

float mapB(vec3 p){
  float d = 1e5;
  for (int i = 0; i < NB; i++) {
    if (i >= uN) break;
    if (mk[i] > 0.5) { vec4 s = uS[i]; d = smin3(d, length(p - s.xyz) - s.w, uK[i]); }
  }
  return d;
}
float mapR(vec3 p){ return mkRed > 0.5 ? length(p - uRed.xyz) - uRed.w : 1e5; }
float map(vec3 p){ return min(mapB(p), mapR(p)); }

vec3 calcN(vec3 p, float e){
  const vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) + k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}

// Studio lights as planar softboxes seen through a gnomonic projection: exact shapes, no cubemap.
float lightShape(vec3 r, vec3 lc, vec3 lr, vec3 lu, vec4 P, float f){
  float cd = dot(r, lc);
  if (cd <= 0.05) return 0.0;
  vec3 q = r / cd;
  vec2 xy = vec2(dot(q, lr), dot(q, lu));
  if (P.w > 0.5) {
    float e = length(xy / P.xy);
    float fe = f / P.y;
    return (1.0 - smoothstep(1.0 - fe, 1.0 + fe, e)) * (P.x * P.y) / ((P.x + f) * (P.y + f));
  }
  // a blurred light spreads its energy, it does not grow brighter
  float area = (P.x * P.y) / ((P.x + f) * (P.y + f));
  return (1.0 - smoothstep(P.x - f, P.x + f, abs(xy.x))) * (1.0 - smoothstep(P.y - f, P.y + f, abs(xy.y))) * area;
}
vec3 env(vec3 r, float f, float dotOn, float lightsOn){
  vec3 c = vec3(0.006, 0.0055, 0.0065);
  // the page as a warm floor: only the lowest band of each lobe sees it
  c = mix(c, vec3(0.10, 0.088, 0.077), smoothstep(-0.12 - f, -0.45 - f, r.y));
  // cream horizon behind the subject: grazing angles pick it up as a thin rim line round the silhouette
  c += vec3(1.0, 0.95, 0.9) * (0.25 * exp(-r.y * r.y / (0.004 + f * f)) * smoothstep(-0.2, -0.8, r.z));
  for (int i = 0; i < NL; i++) {
    if (lightsOn < 0.5) break;
    float w = lightShape(r, uLc[i], uLr[i], uLu[i], uLp[i], f + 0.006);
    if (i == 3) w *= dotOn;
    c += uLcol[i] * (uLp[i].z * w);
  }
  // large graded card front-left: the soft #4A4550 sheen of the flat logo
  float g = max(dot(r, vec3(-0.50, 0.46, 0.734)), 0.0);
  c += vec3(1.0, 0.97, 0.94) * (2.2 * pow(g, 6.0));
  return c;
}
float sweep(vec3 r){
  float ph = atan(r.x, r.z);
  return exp(-pow((ph - uPhi) / 0.07, 2.0)) * smoothstep(-0.25, 0.15, r.y) * smoothstep(0.98, 0.55, r.y);
}
// reflections that see a neighbouring bead go black: kills the neck smear, gives depth
float reflOcc(vec3 o, vec3 r){
  float occ = 0.0;
  for (int i = 0; i < NB; i++) {
    if (i >= uN) break;
    vec4 b = uS[i];
    if (b.w < 0.02 || mk[i] < 0.5) continue;
    vec3 oc = b.xyz - o;
    float t = dot(oc, r);
    if (t <= 0.0) continue;
    float dm = length(oc - r * t);
    occ = max(occ, (1.0 - smoothstep(b.w * 0.75, b.w * 1.2, dm)) * smoothstep(0.12, 0.3, b.w / t));
  }
  if (mkRed > 0.5) {
    vec3 oc = uRed.xyz - o; float t = dot(oc, r);
    if (t > 0.0) { float dm = length(oc - r * t); occ = max(occ, 0.85 * (1.0 - smoothstep(uRed.w * 0.8, uRed.w * 1.25, dm)) * smoothstep(0.08, 0.25, uRed.w / t)); }
  }
  return occ;
}
float sphereAO(vec3 p, vec3 n){
  float o = 0.0;
  for (int i = 0; i < NB; i++) {
    if (i >= uN) break;
    vec4 b = uS[i];
    if (b.w < 0.02) continue;
    vec3 d = b.xyz - p; float l = length(d);
    o += b.w * b.w / (l * l) * max(dot(n, d / l), 0.0);
  }
  vec3 d = uRed.xyz - p; float l = length(d);
  o += uRed.w * uRed.w / (l * l) * max(dot(n, d / l), 0.0);
  float ao = 1.0 - clamp(o * 0.9, 0.0, 0.8);
  // faces turned to the floor close to it lose light (contact)
  float gh = max(p.y - uGround, 0.0);
  ao *= mix(1.0, clamp(0.25 + gh * 1.5, 0.0, 1.0), clamp(-n.y, 0.0, 1.0) * uShadow * 1.6);
  return ao;
}

vec3 shade(vec3 p, vec3 rd){
  float dB = mapB(p);
  float red = step(mapR(p), dB);
  float e = 0.0012 + 0.0004 * length(p - uCam);
  // the drop is a plain sphere: analytic normal, no extra field taps
  vec3 n = red > 0.5 ? normalize(p - uRed.xyz) : calcN(p, e);
  vec3 v = -rd;
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  vec3 r = reflect(rd, n);
  float ao = sphereAO(p + n * 0.01, n);

  vec3 base = mix(vec3(0.0050, 0.0044, 0.0058), vec3(0.262, 0.018, 0.056), red);
  float lam = 0.34 + 0.72 * max(dot(n, vec3(-0.40, 0.58, 0.71)), 0.0);
  vec3 col = base * lam * ao;
  // floor bounce: warm under-light, burgundy picks it up more
  col += base * vec3(1.0, 0.9, 0.8) * 0.25 * max(-n.y, 0.0);

  // the rough under-layer only needs the room, floor and card: lights are too small to matter blurred
  vec3 soft = env(r, 0.32, 0.0, 0.0);
  col += soft * mix(0.014, 0.010, red) * ao;

  float F = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
  vec3 coat = env(r, 0.012, 1.0, 1.0) + vec3(1.0, 0.97, 0.93) * (sweep(r) * uAmt);
  float occ = reflOcc(p + n * 0.006, r);
  coat *= 1.0 - 0.97 * occ;
  // inside a blend (the waist) the coat sees mostly the body itself: keep it dark like the 2D logo
  float dPlain = 1e5;
  for (int i = 0; i < NB; i++) {
    if (i >= uN) break; if (mk[i] > 0.5) { vec4 s = uS[i]; dPlain = min(dPlain, length(p - s.xyz) - s.w); } }
  coat *= 1.0 - 0.95 * smoothstep(0.0, 0.06, dPlain - dB) * (1.0 - red);
  col += coat * F * mix(1.0, ao, 0.5) * mix(1.0, 0.55, red);
  return col;
}

vec3 tone(vec3 c){
  // linear below 0.75 so burgundy and black stay true; soft shoulder only for highlights
  vec3 hi = 0.75 + 0.25 * (1.0 - exp(-(c - 0.75) / 0.25));
  return mix(c, hi, step(0.75, c));
}

void main(){
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec3 ro = uCam;
  vec3 rd = normalize(uFwd + ndc.x * uTan.x * uRight + ndc.y * uTan.y * uUp);

  float tN = 1e5, tF = -1.0;
  for (int i = 0; i < NB; i++) mk[i] = 0.0;
  for (int i = 0; i < NB; i++) {
    if (i >= uN) break;
    vec4 s = uS[i];
    if (s.w <= 0.0) continue;
    // a smooth union can reach 7k/6 past its spheres; anything farther cannot touch this ray
    float R = s.w + uK[i] * 1.17 + 0.01;
    vec3 oc = ro - s.xyz; float b = dot(oc, rd); float c = dot(oc, oc) - R * R; float disc = b * b - c;
    if (disc > 0.0) { float sq = sqrt(disc); tN = min(tN, -b - sq); tF = max(tF, -b + sq); mk[i] = 1.0; }
  }
  mkRed = 0.0;
  if (uRed.w > 0.0) {
    float R = uRed.w + 0.01;
    vec3 oc = ro - uRed.xyz; float b = dot(oc, rd); float c = dot(oc, oc) - R * R; float disc = b * b - c;
    if (disc > 0.0) { float sq = sqrt(disc); tN = min(tN, -b - sq); tF = max(tF, -b + sq); mkRed = 1.0; }
  }

  vec4 outc = vec4(0.0);
  if (tF > 0.0) {
    float t = max(tN, 0.0);
    float bestR = 1e5, bestT = t;
    bool hit = false;
    for (int i = 0; i < 56; i++) {
      float h = map(ro + rd * t);
      float ratio = h / (t * uPx);
      if (ratio < bestR) { bestR = ratio; bestT = t; }
      if (h < 0.0004 * t) { hit = true; break; }
      t += h;
      if (t > tF) break;
    }
    // one shading call site: divergent branches would otherwise pay for shade() twice
    float cov = hit ? 1.0 : 1.0 - smoothstep(-0.2, 1.2, bestR);
    if (cov > 0.0) outc = vec4(shade(ro + rd * (hit ? t : bestT), rd), cov);
  }
  vec3 col = pow(tone(outc.rgb), vec3(1.0 / 2.2));
  float a = outc.a;

  vec3 under = vec3(0.0); float ua = 0.0;
  if (rd.y < 0.0 && uShadow > 0.001) {
    float tg = (uGround - ro.y) / rd.y;
    vec3 q = ro + rd * tg;
    float occ = 0.0, cont = 0.0;
    for (int i = 0; i < NB; i++) {
    if (i >= uN) break;
      vec4 b = uS[i];
      if (b.w < 0.02) continue;
      vec3 d = b.xyz - q; float l2 = dot(d, d);
      occ += b.w * b.w / l2 * clamp(d.y * inversesqrt(l2), 0.0, 1.0);
      vec2 hz = d.xz / b.w;
      float hgt = (b.xyz.y - b.w - uGround) / b.w;
      cont += exp(-dot(hz, hz) * 5.0 - hgt * 10.0);
    }
    vec3 d = uRed.xyz - q; float l2 = dot(d, d);
    occ += uRed.w * uRed.w / l2 * clamp(d.y * inversesqrt(l2), 0.0, 1.0);
    float sa = clamp(0.32 * occ + 0.9 * cont, 0.0, 0.8) * uShadow;
    vec2 g2 = (q.xz - uRed.xz) / max(uRed.w, 0.05);
    float ga = uGlow * exp(-(g2.x * g2.x * 1.1 + g2.y * g2.y * 1.4));
    // mirror in the lacquered floor: soft union of the reflected silhouettes, faded with height
    vec3 rr = vec3(rd.x, -rd.y, rd.z);
    float dref = 1e5, tref = 0.0, dbest = 1e5;
    for (int i = 0; i < NB; i++) {
    if (i >= uN) break;
      vec4 b = uS[i];
      if (b.w < 0.02) continue;
      vec3 oc = b.xyz - q; float t = dot(oc, rr);
      float dm = length(oc - rr * max(t, 0.0)) - b.w;
      if (dm < dbest) { dbest = dm; tref = t; }
      dref = smin3(dref, dm, uK[i]);
    }
    vec3 ocr = uRed.xyz - q; float trd = dot(ocr, rr);
    float dmr = uRed.w > 0.0 ? length(ocr - rr * max(trd, 0.0)) - uRed.w : 1e5;
    float hb = max(q.y + rr.y * tref - uGround, 0.0);
    float ma = (1.0 - smoothstep(-0.01, 0.03, dref)) * 0.32 * exp(-hb * 3.6);
    float hr = max(q.y + rr.y * trd - uGround, 0.0);
    float mr = (1.0 - smoothstep(-0.01, 0.03, dmr)) * 0.28 * exp(-hr * 3.6);
    vec3 sc = vec3(0.09, 0.065, 0.075);
    vec3 gc = vec3(0.549, 0.141, 0.263);
    under = vec3(0.10, 0.075, 0.07) * ma;  ua = ma;
    under = vec3(0.30, 0.06, 0.12) * mr + under * (1.0 - mr); ua = mr + ua * (1.0 - mr);
    under = sc * sa + under * (1.0 - sa); ua = sa + ua * (1.0 - sa);
    under = gc * ga + under * (1.0 - ga); ua = ga + ua * (1.0 - ga);
  }
  vec3 pm = col * a + under * (1.0 - a);
  float pa = a + ua * (1.0 - a);
  gl_FragColor = vec4(pm, pa) * uFade;
}`;

// Light rig (positions as seen from the subject; camera on +z). Ported from concept B's studio.
const LIGHTS = [
  { pos: [-1, 10, 1], up: [0, 0, -1], size: [14, 1.7], I: 5.5, col: [1.0, 0.95, 0.88], ell: 0 },     // overhead strip: top band
  { pos: [-10, 1.0, -3.2], up: [0, 1, 0], size: [1.1, 11], I: 5.0, col: [1.0, 0.95, 0.88], ell: 0 }, // left strip: thin rim line
  { pos: [9, 0.6, -3.6], up: [0, 1, 0], size: [0.6, 10], I: 4.0, col: [1.0, 1.0, 1.02], ell: 0 },      // back-right rim
  { pos: [-2.0, 2.3, 6.4], up: [0, 1, 0], size: [3.0, 1.45], I: 16, col: [1.0, 1.0, 1.0], ell: 1, rot: 0.55 }, // catch-light
];

function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; }
function cross3(a, b, o) { o[0] = a[1] * b[2] - a[2] * b[1]; o[1] = a[2] * b[0] - a[0] * b[2]; o[2] = a[0] * b[1] - a[1] * b[0]; return o; }

export function mount(el, opts = {}) {
  if (!el) throw new Error('olio-hero: no container');
  const doc = el.ownerDocument, win = doc.defaultView;
  const capture = !!opts._capture;

  const root = doc.createElement('div');
  root.setAttribute('data-olio-hero', '');
  Object.assign(root.style, { position: 'absolute', inset: '0', overflow: 'visible', pointerEvents: 'none', contain: 'layout' });
  const tile = doc.createElement('div');
  Object.assign(tile.style, {
    position: 'absolute', inset: '0', borderRadius: '36px', opacity: '0', transition: 'opacity .35s ease',
    background: 'radial-gradient(120% 95% at 42% 30%, #FBF9F6 0%, #F4EFEA 52%, #ECE5DD 100%)',
    boxShadow: '0 1px 0 rgba(255,255,255,.06) inset, 0 30px 70px -30px rgba(0,0,0,.85), 0 10px 24px -12px rgba(0,0,0,.6)',
  });
  const clip = doc.createElement('div');
  Object.assign(clip.style, { position: 'absolute', inset: '0', overflow: 'hidden', borderRadius: '0' });
  const c2d = doc.createElement('canvas');
  const cgl = doc.createElement('canvas');
  for (const c of [c2d, cgl]) Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
  cgl.setAttribute('role', 'img');
  cgl.setAttribute('aria-label', 'Animation: small glossy modules linked like a schema graph flow together and merge into the olio mark.');
  c2d.setAttribute('aria-hidden', 'true');
  clip.append(c2d, cgl);
  root.append(tile, clip);

  const gl = cgl.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true, depth: false, stencil: false,
    preserveDrawingBuffer: capture, powerPreference: 'high-performance' }) || cgl.getContext('experimental-webgl');
  if (!gl) throw new Error('olio-hero: WebGL unavailable');
  const ctx = c2d.getContext('2d');

  let P = null, buf = null, L = {};
  function initGL() {
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('olio-hero: shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    P = gl.createProgram(); gl.attachShader(P, vs); gl.attachShader(P, fs);
    gl.bindAttribLocation(P, 0, 'a'); gl.linkProgram(P);
    if (!gl.getProgramParameter(P, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('olio-hero: link: ' + gl.getProgramInfoLog(P));
    gl.deleteShader(vs); gl.deleteShader(fs);
    buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(P);
    for (const n of ['uS', 'uK', 'uN', 'uRed', 'uCam', 'uFwd', 'uRight', 'uUp', 'uRes', 'uTan', 'uPx', 'uGround', 'uShadow', 'uGlow', 'uFade', 'uPhi', 'uAmt', 'uLc', 'uLr', 'uLu', 'uLcol', 'uLp'])
      L[n] = gl.getUniformLocation(P, n);
    const lc = new Float32Array(12), lr = new Float32Array(12), lu = new Float32Array(12), lcol = new Float32Array(12), lp = new Float32Array(16);
    const c = [0, 0, 0], r = [0, 0, 0], u = [0, 0, 0];
    LIGHTS.forEach((l, i) => {
      const d = Math.hypot(...l.pos);
      c[0] = l.pos[0]; c[1] = l.pos[1]; c[2] = l.pos[2]; norm3(c);
      norm3(cross3(l.up, c, r)); cross3(c, r, u);
      if (l.rot) { const cs = Math.cos(l.rot), sn = Math.sin(l.rot); for (let k = 0; k < 3; k++) { const a = r[k], b = u[k]; r[k] = cs * a + sn * b; u[k] = -sn * a + cs * b; } }
      lc.set(c, i * 3); lr.set(r, i * 3); lu.set(u, i * 3); lcol.set(l.col, i * 3);
      lp.set([l.size[0] / 2 / d, l.size[1] / 2 / d, l.I, l.ell], i * 4);
    });
    gl.uniform3fv(L.uLc, lc); gl.uniform3fv(L.uLr, lr); gl.uniform3fv(L.uLu, lu); gl.uniform3fv(L.uLcol, lcol); gl.uniform4fv(L.uLp, lp);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  }
  try { initGL(); } catch (e) { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); throw e; }

  // only now touch the host page
  const prevPos = el.style.position;
  if (win.getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.appendChild(root);

  let theme = opts.theme === 'dark' ? 'dark' : 'light';
  let W = 1, H = 1, aspect = 1, dpr = 1, gw = 1, gh = 1, compact = false;
  let camDist = 10, layoutRX = 2, layoutRY = 1.5;
  const FOV = 18, tanH = Math.tan((FOV / 2) * Math.PI / 180);
  const target = [0, -0.12, 0];
  const cam = [0, 0, 10], fwd = [0, 0, -1], right = [1, 0, 0], up = [0, 1, 0], WUP = [0, 1, 0];
  const S = new Float32Array(NB * 4), K = new Float32Array(NB), KN = new Float32Array(NB), RED = new Float32Array(4);
  let live = 0;
  const pos = NODES.map(() => ({ x: 0, y: 0, z: 0, r: 0, a: 0, b: 0 }));
  const drop = { x: 0, y: 0, z: 0, r: 0, b: 0 };
  const scr = { x: 0, y: 0, z: 0 };
  const tierScale = [1, 0.82, 0.68, 0.55];
  let tier = opts._tier | 0, forcedScale = opts._scale || 0, stillMode = false;
  const st = { shadow: 0, glow: 0, fade: 1, phi: -2, amt: 0, net: 0, labels: 0, yaw: 0, pitch: 0.11 };
  let graphDrawn = true;
  const pointer = { x: 0, tx: 0, y: 0, ty: 0 };

  function fit() {
    const r = el.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height); aspect = W / H;
    compact = W < 440;
    dpr = Math.min(win.devicePixelRatio || 1, 2);
    // internal render scale: keep the marched pixel count modest, the browser upscales smoothly
    const base = Math.min(1, Math.sqrt(0.62e6 / (W * H * dpr * dpr)));
    const s = forcedScale || base * tierScale[Math.min(tier, 3)];
    gw = Math.max(1, Math.round(W * dpr * s)); gh = Math.max(1, Math.round(H * dpr * s));
    if (cgl.width !== gw || cgl.height !== gh) { cgl.width = gw; cgl.height = gh; }
    const lw = Math.round(W * dpr), lh = Math.round(H * dpr);
    if (c2d.width !== lw || c2d.height !== lh) { c2d.width = lw; c2d.height = lh; graphDrawn = true; }
    // mark (4.43 wide) fills ~80% of the width; never crop vertically
    const halfW = 2.214 / 0.80;
    camDist = Math.max(halfW / (tanH * aspect), 1.62 / tanH);
    const vh = tanH * camDist, vw = vh * aspect;
    layoutRX = Math.min(vw * 0.80, 3.2);
    layoutRY = Math.min(vh * (compact ? 0.76 : 0.70), 2.6);
    target[1] = aspect < 1.05 ? -0.16 : -0.12;
  }

  function absorb(n, t) { return n.lvl === 0 ? 0 : clamp((t - n.m0) / n.md); }
  function gpos(n, t, o) {
    const w = TAU / LOOP;
    o.x = n.x * layoutRX + 0.06 * Math.sin(w * t * 2 + n.ph);
    o.y = n.y * layoutRY + 0.06 * Math.sin(w * t * 3 + n.ph2);
    o.z = n.z + 0.08 * Math.sin(w * t + n.ph * 1.3);
  }
  const tmp = { x: 0, y: 0, z: 0 };
  function simulate(t) {
    t = ((t % LOOP) + LOOP) % LOOP;
    const gather = easeInOut(sstep(5.0, 6.9, t));
    const exitT = sstep(12.35, LOOP, t);
    const scale = 1 - easeIn(exitT) * 0.985;
    const hold = sstep(6.6, 7.2, t) * (1 - sstep(12.2, 12.5, t));
    const bob = 0.018 * Math.sin(TAU * (t - 7.0) / 5.4) * hold;
    // phones show fewer, larger beads
    const rs = compact ? 1.3 : 1;

    for (let i = 0; i < NODES.length; i++) {
      const n = NODES[i], c = pos[i];
      gpos(n, t, tmp);
      // bloom: each bead unfolds from its parent (roots from the centre) at the start of the loop
      const be = easeOut(clamp((t - n.bd) / 1.0));
      c.b = be;
      let ox = 0, oy = 0, oz = 0;
      if (n.p >= 0) { const q = pos[n.p]; ox = q.x; oy = q.y; oz = q.z; }
      const bx = ox + (tmp.x - ox) * be, by = oy + (tmp.y - oy) * be, bz = oz + (tmp.z - oz) * be;
      const live = compact && n.lvl === 2 ? 0 : 1;
      if (n.lvl === 0) {
        const P = i === 0 ? LOBE_A : LOBE_B, R = i === 0 ? RA : RB;
        c.x = bx + (P[0] - bx) * gather; c.y = by + (P[1] - by) * gather + bob; c.z = bz + (P[2] - bz) * gather;
        let tot = 0, got = 0;
        for (const m of n.kids) {
          const am = absorb(m, t); tot += m.vol; got += m.vol * am;
          if (!compact) for (const l of m.kids) { tot += l.vol; got += l.vol * absorb(l, t) * am; }
        }
        const r0 = n.r * rs * sstep(0.0, 0.45, be);
        // both lobes swell together with the gather, so neither balloons ahead of the other
        const frac = 0.35 * (got / tot) + 0.65 * gather;
        c.r = Math.cbrt(r0 * r0 * r0 + (R * R * R - n.r * n.r * n.r) * frac);
        c.a = 0;
        KN[i] = K_NECK;
      } else {
        const a = absorb(n, t), par = pos[n.p];
        const kk = Math.pow(a, 2.0);
        c.x = bx + (par.x - bx) * kk; c.y = by + (par.y - by) * kk; c.z = bz + (par.z - bz) * kk;
        let own = n.r;
        if (n.lvl === 1 && !compact) { let g = 0; for (const l of n.kids) g += l.vol * absorb(l, t); own = Math.cbrt(n.r * n.r * n.r + g * 2.0); }
        // drains into its parent as it sinks in (no half-buried nub); grows only once clear of it at bloom
        const dx = c.x - par.x, dy = c.y - par.y, dz = c.z - par.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const pen = par.r > 0 ? clamp((par.r + own - dist) / (2 * own)) : 0;
        // it condenses to a droplet on the approach, so what touches the body is small enough to read as liquid
        const gap = par.r > 0 ? dist - par.r - own : 1;
        const cond = a > 0 ? 0.4 + 0.6 * sstep(0.0, 3.0 * own, gap) : 1;
        c.r = live * own * rs * cond * sstep(0.3, 0.75, be) * (1 - sstep(0.0, 0.5, pen)) * (1 - sstep(0.85, 1.0, a));
        c.a = a;
        KN[i] = 0.02 + (Math.max(0.06, own * 2.0) - 0.02) * sstep(0.0, 0.35, a);
      }
    }
    {
      gpos(DROPN, t, tmp);
      const be = easeOut(clamp((t - DROPN.bd) / 1.0));
      drop.b = be;
      const arr = easeInOut(sstep(5.7, 7.1, t));
      const lean = 0.045 * Math.sin(Math.PI * sstep(7.1, 8.4, t));
      const tx = DROP_P[0] - lean, ty = bob, tz = 0;
      const gx = tmp.x * be, gy = tmp.y * be, gz = tmp.z * be;
      drop.x = gx + (tx - gx) * arr; drop.y = gy + (ty - gy) * arr; drop.z = gz + (tz - gz) * arr;
      drop.r = (DROPN.r * rs + (RD - DROPN.r * rs) * arr) * sstep(0.3, 0.75, be);
    }
    // exit: the finished mark recedes into a point; the graph then unfolds from that point
    let n = 0;
    for (let i = 0; i < NODES.length; i++) {
      const c = pos[i];
      if (c.r <= 0.003) continue;
      S[n * 4] = c.x * scale; S[n * 4 + 1] = c.y * scale; S[n * 4 + 2] = c.z * scale; S[n * 4 + 3] = c.r * scale;
      K[n] = KN[i] * scale; n++;
    }
    live = n;
    for (let j = n; j < NB; j++) { S[j * 4 + 3] = 0; K[j] = 0.01; }
    RED[0] = drop.x * scale; RED[1] = drop.y * scale; RED[2] = drop.z * scale; RED[3] = drop.r > 0.003 ? drop.r * scale : 0;

    st.shadow = sstep(5.4, 6.9, t) * (1 - sstep(12.3, 13.1, t));
    st.glow = 0.30 * sstep(6.4, 7.3, t) * (1 - sstep(12.3, 12.9, t));
    st.fade = 1;
    st.phi = -2; st.amt = 0;
    const sw = (t - 8.0) / 2.2;
    if (sw > 0 && sw < 1) { st.phi = -1.2 + 2.4 * easeInOut(sw); st.amt = 12 * Math.sin(Math.PI * sw); }
    st.net = sstep(0.35, 1.3, t) * (1 - sstep(4.0, 5.2, t));
    st.labels = sstep(1.0, 1.6, t) * (1 - sstep(3.4, 3.9, t));
    const settle = 1 - sstep(5.2, 6.9, t) * (1 - sstep(12.6, LOOP, t));
    st.yaw = 0.16 * Math.sin(TAU * t / LOOP + 0.6) * settle;
    st.pitch = 0.11 + 0.03 * Math.sin(TAU * 2 * t / LOOP) * settle;
    return t;
  }

  function setCamera() {
    const yaw = st.yaw + pointer.x * 0.12, pitch = st.pitch - pointer.y * 0.06;
    cam[0] = target[0] + Math.sin(yaw) * Math.cos(pitch) * camDist;
    cam[1] = target[1] + Math.sin(pitch) * camDist;
    cam[2] = target[2] + Math.cos(yaw) * Math.cos(pitch) * camDist;
    fwd[0] = target[0] - cam[0]; fwd[1] = target[1] - cam[1]; fwd[2] = target[2] - cam[2]; norm3(fwd);
    norm3(cross3(fwd, WUP, right)); cross3(right, fwd, up);
  }
  function project(x, y, z) {
    const dx = x - cam[0], dy = y - cam[1], dz = z - cam[2];
    const zz = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
    const sx = (dx * right[0] + dy * right[1] + dz * right[2]) / (zz * tanH * aspect);
    const sy = (dx * up[0] + dy * up[1] + dz * up[2]) / (zz * tanH);
    scr.x = (sx * 0.5 + 0.5) * W; scr.y = (0.5 - sy * 0.5) * H; scr.z = zz;
    return scr;
  }

  function strokeEdge(ax, ay, az, bx, by, bz, sag) {
    project(ax, ay, az); const x0 = scr.x, y0 = scr.y;
    project(bx, by, bz); const x1 = scr.x, y1 = scr.y;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, dx = x1 - x0, dy = y1 - y0;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx - dy * sag, my + dx * sag, x1, y1); ctx.stroke();
  }
  function drawGraph() {
    const active = st.net > 0.002 || st.labels > 0.002;
    // hidden rather than only cleared: some compositors keep presenting a stale buffer for a clear-only canvas
    if (!active) { if (graphDrawn) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c2d.width, c2d.height); c2d.style.visibility = 'hidden'; graphDrawn = false; } return; }
    if (!graphDrawn) c2d.style.visibility = '';
    graphDrawn = true;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c2d.width, c2d.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    const lw = compact ? 1.1 : 1;
    ctx.lineWidth = lw;
    for (let i = 0; i < NODES.length; i++) {
      const n = NODES[i]; if (n.p < 0) continue;
      const c = pos[i]; if (c.r <= 0.003 && c.a <= 0) continue;
      const al = 0.30 * st.net * Math.min(c.b, 1) * (1 - sstep(0.25, 0.8, c.a));
      if (al < 0.004) continue;
      const q = pos[n.p];
      ctx.strokeStyle = INK + al.toFixed(3) + ')';
      strokeEdge(c.x, c.y, c.z, q.x, q.y, q.z, i % 2 ? 0.08 : -0.08);
    }
    // dashed: schema references and the incoming module's links, secondary to the tree
    ctx.setLineDash([2, 4]);
    for (const [a, b] of XREF) {
      const A = pos[a], B = pos[b];
      const al = 0.22 * st.net * (1 - sstep(0.0, 0.4, Math.max(A.a, B.a)));
      if (al < 0.004) continue;
      ctx.strokeStyle = INK + al.toFixed(3) + ')';
      strokeEdge(A.x, A.y, A.z, B.x, B.y, B.z, 0.16);
    }
    for (const b of DROP_EDGES) {
      const B = pos[b];
      const al = 0.55 * st.net * (1 - sstep(0.0, 0.4, B.a));
      if (al < 0.004) continue;
      ctx.strokeStyle = BURG + al.toFixed(3) + ')';
      strokeEdge(drop.x, drop.y, drop.z, B.x, B.y, B.z, -0.1);
    }
    ctx.setLineDash([]);
    if (st.labels > 0.002) {
      const fs = compact ? 11.5 : 11;
      ctx.font = `500 ${fs}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let i = 0; i < NODES.length; i++) {
        const n = NODES[i]; if (!n.label) continue;
        const c = pos[i];
        const al = 0.72 * st.labels * (1 - sstep(0.0, 0.2, c.a));
        if (al < 0.004) continue;
        project(c.x, c.y - c.r, c.z);
        ctx.fillStyle = INK + al.toFixed(3) + ')';
        ctx.fillText(n.label, scr.x, scr.y + 5);
      }
      const al = 0.95 * st.labels;
      project(drop.x, drop.y - drop.r, drop.z);
      ctx.fillStyle = BURG + al.toFixed(3) + ')';
      ctx.fillText(DROPN.label, scr.x, scr.y + 5);
    }
  }

  let lost = false;
  function renderAt(time) {
    if (lost) return;
    simulate(time);
    setCamera();
    drawGraph();

    // scissor to what can be lit: beads plus the floor patch under them
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const pxPerUnit = (H / 2) / tanH;
    const addS = (x, y, z, R) => {
      project(x, y, z); const pr = (R / scr.z) * pxPerUnit + 2;
      if (scr.x - pr < x0) x0 = scr.x - pr; if (scr.x + pr > x1) x1 = scr.x + pr;
      if (scr.y - pr < y0) y0 = scr.y - pr; if (scr.y + pr > y1) y1 = scr.y + pr;
    };
    let mnx = 1e9, mxx = -1e9;
    for (let i = 0; i < live; i++) {
      const r = S[i * 4 + 3];
      addS(S[i * 4], S[i * 4 + 1], S[i * 4 + 2], r + K[i] * 1.17 + 0.02);
      if (st.shadow > 0.001) addS(S[i * 4], 2 * GROUND - S[i * 4 + 1], S[i * 4 + 2], r + 0.05);
      mnx = Math.min(mnx, S[i * 4] - r); mxx = Math.max(mxx, S[i * 4] + r);
    }
    if (RED[3] > 0) { addS(RED[0], RED[1], RED[2], RED[3] + 0.02); mnx = Math.min(mnx, RED[0] - RED[3]); mxx = Math.max(mxx, RED[0] + RED[3]); }
    if (st.shadow > 0.001 && mxx > mnx) {
      for (const zz of [-1.6, 1.6]) { addS(mnx - 0.9, GROUND, zz, 0.05); addS(mxx + 0.9, GROUND, zz, 0.05); }
    }
    const sx = gw / W, sy = gh / H;
    const rx0 = Math.max(0, Math.floor(x0 * sx)), rx1 = Math.min(gw, Math.ceil(x1 * sx));
    const ry0 = Math.max(0, Math.floor((H - y1) * sy)), ry1 = Math.min(gh, Math.ceil((H - y0) * sy));

    gl.viewport(0, 0, gw, gh);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (rx1 <= rx0 || ry1 <= ry0) return;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(rx0, ry0, rx1 - rx0, ry1 - ry0);
    gl.useProgram(P);
    gl.uniform4fv(L.uS, S); gl.uniform1fv(L.uK, K); gl.uniform1i(L.uN, live); gl.uniform4fv(L.uRed, RED);
    gl.uniform3f(L.uCam, cam[0], cam[1], cam[2]); gl.uniform3f(L.uFwd, fwd[0], fwd[1], fwd[2]);
    gl.uniform3f(L.uRight, right[0], right[1], right[2]); gl.uniform3f(L.uUp, up[0], up[1], up[2]);
    gl.uniform2f(L.uRes, gw, gh); gl.uniform2f(L.uTan, tanH * aspect, tanH);
    gl.uniform1f(L.uPx, 2 * tanH / gh); gl.uniform1f(L.uGround, GROUND);
    gl.uniform1f(L.uShadow, st.shadow); gl.uniform1f(L.uGlow, st.glow); gl.uniform1f(L.uFade, st.fade);
    gl.uniform1f(L.uPhi, st.phi); gl.uniform1f(L.uAmt, st.amt);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const mq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(mq && mq.matches);
  let clock = 0, last = 0, raf = 0, fixedT = null;
  let onScreen = true, tabVisible = !doc.hidden, destroyed = false;
  let acc = 0, accN = 0;
  const running = () => !destroyed && !lost && !reduced && !stillMode && fixedT === null && onScreen && tabVisible;
  function frame(now) {
    raf = 0;
    if (!running()) return;
    if (last) {
      const dt = now - last;
      clock += Math.min(dt, 100) / 1000;
      acc += dt; accN++;
      if (accN === 48) {
        const avg = acc / accN; acc = 0; accN = 0;
        // persistent slowness: first trade pixels, then settle on the still
        if (avg > 26 && !forcedScale) {
          if (tier < 3) { tier++; fit(); } else if (avg > 34) { stillMode = true; tier = 0; fit(); renderAt(KEY_T); return; }
        }
      }
    }
    last = now;
    pointer.x += (pointer.tx - pointer.x) * 0.06; pointer.y += (pointer.ty - pointer.y) * 0.06;
    renderAt(clock);
    raf = win.requestAnimationFrame(frame);
  }
  function kick() { if (!raf && running()) { last = 0; acc = 0; accN = 0; raf = win.requestAnimationFrame(frame); } }
  function stop() { if (raf) { win.cancelAnimationFrame(raf); raf = 0; } }
  function currentT() { return fixedT !== null ? fixedT : (reduced || stillMode) ? KEY_T : clock; }
  function redraw() { renderAt(currentT()); }

  const ro = new win.ResizeObserver(() => { fit(); redraw(); });
  ro.observe(el);
  let io = null;
  if ('IntersectionObserver' in win) {
    io = new win.IntersectionObserver((es) => { onScreen = es[es.length - 1].isIntersecting; if (onScreen) kick(); else stop(); });
    io.observe(el);
  }
  const onVis = () => { tabVisible = !doc.hidden; if (tabVisible) kick(); else stop(); };
  doc.addEventListener('visibilitychange', onVis);
  const onMQ = () => { reduced = mq.matches; if (reduced) { stop(); redraw(); } else kick(); };
  if (mq) (mq.addEventListener ? mq.addEventListener('change', onMQ) : mq.addListener(onMQ));
  const onMove = (e) => { if (reduced) return; const r = el.getBoundingClientRect(); pointer.tx = (e.clientX - r.left) / r.width - 0.5; pointer.ty = (e.clientY - r.top) / r.height - 0.5; };
  const onLeave = () => { pointer.tx = 0; pointer.ty = 0; };
  el.addEventListener('pointermove', onMove); el.addEventListener('pointerleave', onLeave);

  // context loss: show the flat mark until the GPU comes back, then rebuild
  const fb = doc.createElement('div');
  Object.assign(fb.style, { position: 'absolute', left: '12%', right: '12%', top: '18%', bottom: '18%', display: 'none' });
  fb.innerHTML = '<svg viewBox="0 0 140 120" width="100%" height="100%" aria-hidden="true"><defs><radialGradient id="olioHeroLac" gradientUnits="userSpaceOnUse" cx="30" cy="40" r="90"><stop offset="0" stop-color="#4A4550"/><stop offset=".4" stop-color="#1E1B22"/><stop offset="1" stop-color="#050406"/></radialGradient></defs><g fill="url(#olioHeroLac)"><circle cx="38" cy="60" r="28"/><circle cx="86" cy="60" r="22"/><path d="M49.8 34.6 Q62 54 75 41 L75 79 Q62 66 49.8 85.4 Z"/></g><ellipse cx="28" cy="45" rx="10" ry="5" fill="#fff" opacity=".55" transform="rotate(-30 28 45)"/><ellipse cx="80" cy="48" rx="6" ry="3.5" fill="#fff" opacity=".4" transform="rotate(-28 80 48)"/><circle cx="124" cy="60" r="10" fill="#8C2443"/><circle cx="121" cy="57" r="2.4" fill="#fff" opacity=".8"/></svg>';
  root.appendChild(fb);
  const onLost = (e) => { e.preventDefault(); lost = true; stop(); fb.style.display = 'block'; clip.style.visibility = 'hidden'; };
  const onRestored = () => {
    try { initGL(); } catch (e) { return; }
    lost = false; fb.style.display = 'none'; clip.style.visibility = ''; fit(); redraw(); kick();
  };
  cgl.addEventListener('webglcontextlost', onLost);
  cgl.addEventListener('webglcontextrestored', onRestored);

  function setTheme(t) {
    theme = t === 'dark' ? 'dark' : 'light';
    tile.style.opacity = theme === 'dark' ? '1' : '0';
    clip.style.borderRadius = theme === 'dark' ? '36px' : '0';
  }
  setTheme(theme);
  fit();
  redraw();
  kick();

  return {
    setTheme,
    destroy() {
      if (destroyed) return;
      destroyed = true; stop();
      ro.disconnect(); if (io) io.disconnect();
      doc.removeEventListener('visibilitychange', onVis);
      if (mq) (mq.removeEventListener ? mq.removeEventListener('change', onMQ) : mq.removeListener(onMQ));
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave);
      cgl.removeEventListener('webglcontextlost', onLost); cgl.removeEventListener('webglcontextrestored', onRestored);
      if (!gl.isContextLost()) { gl.deleteBuffer(buf); gl.deleteProgram(P); }
      const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext();
      root.remove();
      el.style.position = prevPos;
    },
    // capture and test hooks (not part of the public contract)
    _setTime(s) { fixedT = s; stop(); pointer.x = pointer.y = pointer.tx = pointer.ty = 0; renderAt(s); },
    _play() { fixedT = null; kick(); },
    _renderAt: renderAt,
    _gl: gl,
  };
}
