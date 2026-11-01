// olio hero, "The olio diagram": modules flow along dotted build-time
// connectors into the black lacquer schema; solid runtime lines carry what it
// serves, and codegen prints the type each module just contributed.

const NS = "http://www.w3.org/2000/svg";
const SANS =
  '"Sora Variable", "Sora", "Inter", ui-sans-serif, system-ui, sans-serif';
const MONO =
  '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace';

// Each module owns exactly one type here, so the codegen rows can name their owner.
const MODULES = [
  ["users", "User"],
  ["inventory", "Product"],
  ["billing", "Invoice"],
  ["auth", "Session"],
  ["orders", "Order"],
  ["reviews", "Review"],
  ["shipping", "Parcel"],
  ["catalog", "Item"]
];

// One module joins every P seconds; everything is a pure function of time, so
// the loop never resets, it just keeps counting.
const P = 4;
const DEPART = 0.1;
const ARRIVE = 1.75;
const MOVE = 3.05;
// The instant the module is swallowed by olio(); the runtime pulse to HTTP is timed from here.
const JOIN = MOVE - 0.15;
const PULSE_AT = 0.2;
const PULSE_DUR = 0.6;
const DROP_DUR = 0.45;
const GLOW_DUR = 1;
// After a module leaves its card, the socket stays empty for this long, then
// the next module takes the card, so cards never look switched off.
const HOLD = 1;
// Codegen is build time and reads each module's SDL: once a module appears,
// its SDL travels down the dotted bus and its type row lands.
const CG_AT = 0.55;
const CG_DUR = 0.8;
const ROW_DUR = 0.6;
const HOT_HOLD = 1.9;
const HOT_FADE = 0.8;
// Module m appears at (m - 3) * P + DEPART + HOLD; these anchor the per-module codegen clocks.
const CG0 = DEPART + HOLD + CG_AT - 3 * P;
const ROW0 = CG0 + CG_DUR;
const SLOT_OF = [0, 2, 1];
// Every card full, a module fusing and a freshly printed row that matches the
// cards: the best still.
const STILL_AT = 3 * P + 2.95;

const THEMES = {
  light: {
    card: "#FBF9F6",
    cardStroke: "#E6DDD3",
    shadow: "#3A2A1E",
    shadowOpacity: 0.07,
    tile: "#FBF9F6",
    tileStroke: "#E2D8CD",
    ink: "#17151A",
    muted: "#5F5A65",
    kw: "#746D78",
    dotted: "#C3B8AC",
    solid: "#CFC5BA",
    accent: "#8C2443",
    accentText: "#8C2443",
    tileLabel: "#5F5A65",
    divider: "#ECE4DB",
    wine: ["#B9506F", "#8C2443", "#560F27"],
    ghost: "#CDBFB2",
    band: 0.06
  },
  dark: {
    card: "#1C1A21",
    cardStroke: "#2E2B35",
    shadow: "#000000",
    shadowOpacity: 0.35,
    tile: "#F4EFEA",
    tileStroke: "#F4EFEA",
    ink: "#F4EFEA",
    muted: "#B0A9B7",
    kw: "#958E9D",
    dotted: "#5A5463",
    solid: "#514B59",
    accent: "#C2456A",
    accentText: "#E07A9B",
    tileLabel: "#5C5762",
    divider: "#2A2731",
    wine: ["#DA6A8C", "#B03A60", "#6E1735"],
    ghost: "#4F4958",
    band: 0.12
  }
};

// Three authored layouts instead of one scaled drawing, so text never shrinks
// below 11 CSS px: each is used only while its scale stays near 1, and any
// remaining shrink is absorbed by a font-size floor (see `floor`).
const LAYOUTS = {
  desk: {
    W: 600,
    H: 514,
    node: { x: 300, y: 166, R: 49 },
    tile: { x: 214, y: 92, w: 172, h: 180, rx: 36 },
    tileLabelY: 250,
    left: {
      x: 20,
      w: 162,
      h: 58,
      ys: [82, 166, 250],
      port: 25,
      r: 11,
      trunk: 199,
      kw: true
    },
    right: {
      x: 414,
      w: 166,
      h: 58,
      trunk: 400,
      icons: true,
      items: [
        {
          y: 82,
          title: "Any server",
          sub: "app.schema",
          icon: "server",
          from: "olio"
        },
        {
          y: 166,
          title: "HTTP",
          sub: "fetchHandler()",
          icon: "globe",
          from: "olio"
        },
        {
          y: 250,
          title: "Clients",
          sub: "olio-client",
          icon: "devices",
          from: "http"
        }
      ]
    },
    gen: {
      x: 160,
      y: 306,
      w: 280,
      h: 168,
      head: 28,
      rowY: 84,
      rowH: 26,
      rows: 3
    },
    nameSize: 14,
    subSize: 12,
    codeSize: 12.5,
    labelSize: 13
  },
  mid: {
    W: 450,
    H: 386,
    node: { x: 225, y: 112, R: 37 },
    tile: { x: 160, y: 57, w: 130, h: 140, rx: 30 },
    tileLabelY: 178,
    left: {
      x: 12,
      w: 124,
      h: 48,
      ys: [50, 112, 174],
      port: 19,
      r: 8.5,
      trunk: 148,
      kw: false
    },
    right: {
      x: 310,
      w: 126,
      h: 48,
      trunk: 300,
      icons: true,
      items: [
        {
          y: 50,
          title: "Any server",
          sub: "app.schema",
          icon: "server",
          from: "olio"
        },
        {
          y: 112,
          title: "HTTP",
          sub: "olio-http",
          icon: "globe",
          from: "olio"
        },
        {
          y: 174,
          title: "Clients",
          sub: "olio-client",
          icon: "devices",
          from: "http"
        }
      ]
    },
    gen: {
      x: 95,
      y: 222,
      w: 260,
      h: 150,
      head: 24,
      rowY: 73,
      rowH: 23,
      rows: 3
    },
    nameSize: 13,
    subSize: 11.5,
    codeSize: 11.5,
    labelSize: 12
  },
  phone: {
    W: 360,
    H: 360,
    node: { x: 190, y: 106, R: 35 },
    tile: { x: 143, y: 55, w: 94, h: 134, rx: 26 },
    tileLabelY: 170,
    left: {
      x: 12,
      w: 116,
      h: 46,
      ys: [48, 106, 164],
      port: 16,
      r: 7.5,
      trunk: 135,
      kw: false
    },
    right: {
      x: 254,
      w: 92,
      h: 46,
      trunk: 245,
      icons: false,
      items: [
        { y: 106, title: "HTTP", sub: "olio-http", from: "olio" },
        { y: 164, title: "Clients", sub: "typed", from: "http" }
      ]
    },
    gen: {
      x: 30,
      y: 210,
      w: 300,
      h: 138,
      head: 22,
      rowY: 68,
      rowH: 22,
      rows: 3
    },
    nameSize: 13,
    subSize: 11.5,
    codeSize: 11.5,
    labelSize: 12
  }
};

// Below this scale a layout hands over to the next smaller one.
const MIN_SCALE = 0.86;
// Smallest on-screen text, in CSS px, with a hair of margin over 11.
const MIN_PX = 11.25;

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const smooth = (x) => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};
const sine = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x));
const backOut = (x) => {
  const t = clamp(x) - 1;
  return 1 + 2.2 * t * t * t + 1.2 * t * t;
};
const mod = (a, b) => ((a % b) + b) % b;

function make(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  if (attrs) for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  if (parent) parent.append(n);
  return n;
}

// Skips the DOM write when a value has not moved, which is most attributes on most frames.
function set(node, key, value) {
  const v = typeof value === "number" ? Math.round(value * 100) / 100 : value;
  const slot = "_" + key;
  if (node[slot] === v) return;
  node[slot] = v;
  node.setAttribute(key, v);
}

// Rounded orthogonal polyline: an SVG path for drawing plus an arc-length table
// at one unit per step for moving things along it without per-frame math.
function route(points, radius) {
  const pts = [];
  for (const p of points) {
    const last = pts.at(-1);
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.01) pts.push(p);
  }
  const poly = [pts[0]];
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const ax = (b[0] - a[0]) / l1;
    const ay = (b[1] - a[1]) / l1;
    const bx = (c[0] - b[0]) / l2;
    const by = (c[1] - b[1]) / l2;
    if (Math.abs(ax * by - ay * bx) < 1e-3) continue;
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const c1 = [b[0] - ax * r, b[1] - ay * r];
    const c2 = [b[0] + bx * r, b[1] + by * r];
    d += ` L${c1[0]} ${c1[1]} Q${b[0]} ${b[1]} ${c2[0]} ${c2[1]}`;
    poly.push(c1);
    for (let s = 1; s <= 10; s++) {
      const t = s / 10;
      const u = 1 - t;
      poly.push([
        u * u * c1[0] + 2 * u * t * b[0] + t * t * c2[0],
        u * u * c1[1] + 2 * u * t * b[1] + t * t * c2[1]
      ]);
    }
  }
  const end = pts.at(-1);
  d += ` L${end[0]} ${end[1]}`;
  poly.push(end);
  const cum = [0];
  for (let i = 1; i < poly.length; i++) {
    cum.push(
      cum[i - 1] +
        Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1])
    );
  }
  const len = cum.at(-1);
  const n = Math.max(2, Math.ceil(len) + 1);
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * len;
    while (j < poly.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = (s - cum[j]) / seg;
    xs[i] = poly[j][0] + (poly[j + 1][0] - poly[j][0]) * t;
    ys[i] = poly[j][1] + (poly[j + 1][1] - poly[j][1]) * t;
  }
  return { d, xs, ys, len, n };
}

// Writes into `out` so moving along a route allocates nothing.
function along(rt, f, out) {
  const p = clamp(f) * (rt.n - 1);
  const i = Math.min(rt.n - 2, Math.floor(p));
  const t = p - i;
  out.x = rt.xs[i] + (rt.xs[i + 1] - rt.xs[i]) * t;
  out.y = rt.ys[i] + (rt.ys[i + 1] - rt.ys[i]) * t;
  return out;
}

// The liquid neck between the schema and an arriving module, drawn as geometry
// (two tangent cubic curves) instead of a blur filter, so it stays crisp and cheap.
function neck(x1, y1, r1, x2, y2, r2) {
  const d = Math.hypot(x2 - x1, y2 - y1);
  const reach = r1 + r2 * 2.6;
  if (d > reach || d <= Math.abs(r1 - r2) + 0.5 || r2 < 0.5) return "";
  const v = 0.5;
  const u1 =
    d < r1 + r2 ? Math.acos((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d)) : 0;
  const u2 =
    d < r1 + r2 ? Math.acos((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d)) : 0;
  const base = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.acos(clamp((r1 - r2) / d, -1, 1));
  const a1 = base + u1 + (spread - u1) * v;
  const a2 = base - u1 - (spread - u1) * v;
  const a3 = base + Math.PI - u2 - (Math.PI - u2 - spread) * v;
  const a4 = base - Math.PI + u2 + (Math.PI - u2 - spread) * v;
  const p1x = x1 + Math.cos(a1) * r1,
    p1y = y1 + Math.sin(a1) * r1;
  const p2x = x1 + Math.cos(a2) * r1,
    p2y = y1 + Math.sin(a2) * r1;
  const p3x = x2 + Math.cos(a3) * r2,
    p3y = y2 + Math.sin(a3) * r2;
  const p4x = x2 + Math.cos(a4) * r2,
    p4y = y2 + Math.sin(a4) * r2;
  // The neck thins as the gap widens, then snaps shut only once it is a hairline.
  const k =
    Math.min(v * 2.4, Math.hypot(p3x - p1x, p3y - p1y) / (r1 + r2)) *
    Math.min(1, (d * 2) / (r1 + r2));
  const h1 = r1 * k;
  const h2 = r2 * k;
  const f = (n) => Math.round(n * 100) / 100;
  return (
    `M${f(p1x)} ${f(p1y)}` +
    `C${f(p1x + Math.cos(a1 - Math.PI / 2) * h1)} ${f(p1y + Math.sin(a1 - Math.PI / 2) * h1)} ` +
    `${f(p3x + Math.cos(a3 + Math.PI / 2) * h2)} ${f(p3y + Math.sin(a3 + Math.PI / 2) * h2)} ${f(p3x)} ${f(p3y)}` +
    `L${f(p4x)} ${f(p4y)}` +
    `C${f(p4x + Math.cos(a4 - Math.PI / 2) * h2)} ${f(p4y + Math.sin(a4 - Math.PI / 2) * h2)} ` +
    `${f(p2x + Math.cos(a2 + Math.PI / 2) * h1)} ${f(p2y + Math.sin(a2 + Math.PI / 2) * h1)} ${f(p2x)} ${f(p2y)}Z`
  );
}

function icon(kind, x, y, color, parent) {
  const g = make(
    "g",
    {
      transform: `translate(${x} ${y})`,
      fill: "none",
      stroke: color,
      "stroke-width": 1.5,
      "stroke-linecap": "round",
      "stroke-linejoin": "round"
    },
    parent
  );
  if (kind === "globe") {
    make("circle", { cx: 0, cy: 0, r: 9 }, g);
    make("ellipse", { cx: 0, cy: 0, rx: 4, ry: 9 }, g);
    make("path", { d: "M-9 0H9M-7.6 -4.6H7.6M-7.6 4.6H7.6" }, g);
  } else if (kind === "devices") {
    make("rect", { x: -10, y: -8, width: 15, height: 11, rx: 2 }, g);
    make("path", { d: "M-6 7H1M-2.5 3V7" }, g);
    make("rect", { x: 4, y: -3, width: 7, height: 11, rx: 1.6 }, g);
  } else if (kind === "server") {
    make("rect", { x: -9, y: -8.5, width: 18, height: 7.5, rx: 2 }, g);
    make("rect", { x: -9, y: 1, width: 18, height: 7.5, rx: 2 }, g);
    make("path", { d: "M-5 -4.75H-4.9M-5 4.75H-4.9", "stroke-width": 2.2 }, g);
  } else if (kind === "braces") {
    make(
      "path",
      {
        d: "M-3.5 -8C-6 -8 -6 -6.5 -6 -4.5V-2C-6 -0.8 -6.8 0 -8.2 0C-6.8 0 -6 0.8 -6 2V4.5C-6 6.5 -6 8 -3.5 8M3.5 -8C6 -8 6 -6.5 6 -4.5V-2C6 -0.8 6.8 0 8.2 0C6.8 0 6 0.8 6 2V4.5C6 6.5 6 8 3.5 8"
      },
      g
    );
  }
  return g;
}

function stops(grad, list) {
  for (const [offset, color, opacity] of list) {
    make(
      "stop",
      {
        offset,
        "stop-color": color,
        "stop-opacity": opacity == null ? 1 : opacity
      },
      grad
    );
  }
}

let uid = 0;

export function mount(host, { theme = "light" } = {}) {
  const id = `olio-hero-${++uid}`;
  let mode = "";
  let L = null;
  let floor = MIN_PX;
  let themeName = theme === "dark" ? "dark" : "light";
  let C = THEMES[themeName];

  const root = document.createElement("div");
  root.setAttribute("role", "img");
  root.setAttribute(
    "aria-label",
    "olio diagram: modules such as users, inventory and billing flow into one schema, which serves HTTP and clients and generates the types each module owns"
  );
  root.style.cssText =
    "position:absolute;inset:0;overflow:hidden;contain:strict;pointer-events:none;user-select:none";
  // Static art lives in its own layer, so shadows and text are rasterised once
  // and only the small moving parts repaint each frame.
  const back = make("svg", { preserveAspectRatio: "xMidYMid meet" });
  const front = make("svg", { preserveAspectRatio: "xMidYMid meet" });
  back.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;overflow:visible";
  front.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;overflow:visible;will-change:transform";
  root.append(back, front);
  host.append(root);

  let F = null;
  const pt = { x: 0, y: 0 };
  const fz = (size) => Math.max(size, floor);

  const build = () => {
    back.textContent = "";
    front.textContent = "";
    for (const svg of [back, front]) set(svg, "viewBox", `0 0 ${L.W} ${L.H}`);
    const { node, tile, left, right, gen } = L;
    const R = node.R;
    const nameSize = fz(L.nameSize);
    const subSize = fz(L.subSize);
    const codeSize = fz(L.codeSize);

    const defs = make("defs", null, back);
    const sh = make(
      "filter",
      { id: `${id}-sh`, x: "-20%", y: "-30%", width: "140%", height: "180%" },
      defs
    );
    make(
      "feDropShadow",
      {
        dx: 0,
        dy: 6,
        stdDeviation: 9,
        "flood-color": C.shadow,
        "flood-opacity": C.shadowOpacity
      },
      sh
    );
    // The runtime column is secondary, so it floats less.
    const shLite = make(
      "filter",
      { id: `${id}-shl`, x: "-20%", y: "-30%", width: "140%", height: "180%" },
      defs
    );
    make(
      "feDropShadow",
      {
        dx: 0,
        dy: 3,
        stdDeviation: 6,
        "flood-color": C.shadow,
        "flood-opacity": C.shadowOpacity * 0.6
      },
      shLite
    );
    const sh2 = make(
      "filter",
      { id: `${id}-sh2`, x: "-30%", y: "-30%", width: "160%", height: "180%" },
      defs
    );
    make(
      "feDropShadow",
      {
        dx: 0,
        dy: 12,
        stdDeviation: 16,
        "flood-color": C.shadow,
        "flood-opacity": C.shadowOpacity * (themeName === "dark" ? 1.4 : 1.7)
      },
      sh2
    );
    const floorGrad = make("radialGradient", { id: `${id}-floor` }, defs);
    stops(floorGrad, [
      [0, "#17151A", 0.34],
      [0.45, "#17151A", 0.16],
      [1, "#17151A", 0]
    ]);
    const genClip = make("clipPath", { id: `${id}-clip` }, defs);
    make(
      "rect",
      {
        x: gen.x,
        y: gen.y + gen.head * 1.95 + 2,
        width: gen.w,
        height: gen.h - gen.head * 1.95 - 8
      },
      genClip
    );

    const lines = make(
      "g",
      { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" },
      back
    );
    const cards = make("g", null, back);
    const text = make("g", null, back);

    const dot = {
      stroke: C.dotted,
      "stroke-width": 2,
      "stroke-dasharray": "0 6"
    };
    const solid = { stroke: C.solid, "stroke-width": 1.5 };

    // Build-time connectors: dotted, from each module port into the schema.
    const ins = left.ys.map((y) => {
      const edge = left.x + left.w;
      const px = edge - left.port;
      const draw = route(
        [
          [edge, y],
          [left.trunk, y],
          [left.trunk, node.y],
          [tile.x, node.y]
        ],
        14
      );
      const travel = route(
        [
          [px, y],
          [left.trunk, y],
          [left.trunk, node.y],
          [node.x, node.y]
        ],
        14
      );
      make("path", { d: draw.d, ...dot }, lines);
      return { y, px, travel };
    });
    // Codegen is build time and reads the modules' SDL, so it hangs off the
    // modules' dotted bus, never off olio().
    const busBottom = Math.max(...left.ys);
    make(
      "path",
      { d: `M${left.trunk} ${busBottom}L${left.trunk} ${gen.y}`, ...dot },
      lines
    );
    const sdl = left.ys.map((y) =>
      route(
        [
          [left.x + left.w, y],
          [left.trunk, y],
          [left.trunk, gen.y + 2]
        ],
        14
      )
    );
    // Runtime connectors: solid. olio() serves HTTP and any GraphQL server;
    // clients never touch olio() directly, they call the HTTP endpoint.
    const http = right.items.find((it) => it.title === "HTTP");
    const linkX = right.x + (right.icons ? 23 : 18);
    for (const it of right.items) {
      let d;
      if (it.from === "http")
        d = `M${linkX} ${http.y + right.h / 2}L${linkX} ${it.y - right.h / 2}`;
      else if (Math.abs(it.y - node.y) < 0.5)
        d = `M${tile.x + tile.w} ${node.y}L${right.x} ${node.y}`;
      else
        d = route(
          [
            [tile.x + tile.w, node.y],
            [right.trunk, node.y],
            [right.trunk, it.y],
            [right.x, it.y]
          ],
          14
        ).d;
      make("path", { d, ...solid }, lines);
    }
    const toHttp = route(
      [
        [node.x + R + 3, node.y],
        [right.x, http.y]
      ],
      0
    );
    const client = right.items.find((it) => it.from === "http");
    const toClient = route(
      [
        [linkX, http.y + right.h / 2],
        [linkX, client.y - right.h / 2]
      ],
      0
    );

    const cardAttrs = { fill: C.card, stroke: C.cardStroke, "stroke-width": 1 };
    const shadowed = make("g", { filter: `url(#${id}-sh)` }, cards);
    for (const y of left.ys) {
      make(
        "rect",
        {
          x: left.x + 0.5,
          y: y - left.h / 2 + 0.5,
          width: left.w - 1,
          height: left.h - 1,
          rx: 14,
          ...cardAttrs
        },
        shadowed
      );
    }
    make(
      "rect",
      {
        x: gen.x + 0.5,
        y: gen.y + 0.5,
        width: gen.w - 1,
        height: gen.h - 1,
        rx: 16,
        ...cardAttrs
      },
      shadowed
    );
    const lite = make("g", { filter: `url(#${id}-shl)` }, cards);
    for (const it of right.items) {
      make(
        "rect",
        {
          x: right.x + 0.5,
          y: it.y - right.h / 2 + 0.5,
          width: right.w - 1,
          height: right.h - 1,
          rx: 14,
          ...cardAttrs
        },
        lite
      );
    }
    make(
      "rect",
      {
        x: tile.x,
        y: tile.y,
        width: tile.w,
        height: tile.h,
        rx: tile.rx,
        fill: C.tile,
        stroke: C.tileStroke,
        "stroke-width": 1,
        filter: `url(#${id}-sh2)`
      },
      cards
    );
    // Soft contact shadow: wider than the ball and very flat, so the lacquer sits on the tile.
    make(
      "ellipse",
      {
        cx: node.x + R * 0.06,
        cy: node.y + R * 1.06,
        rx: R * 1.08,
        ry: R * 0.17,
        fill: `url(#${id}-floor)`
      },
      cards
    );

    const tx = (x, y, str, size, fill, extra, parent = text) => {
      const n = make(
        "text",
        { x, y, "font-size": size, fill, ...extra },
        parent
      );
      n.textContent = str;
      return n;
    };
    const sans = { "font-family": SANS, "font-weight": 500 };
    const mono = { "font-family": MONO, "font-weight": 400 };

    tx(node.x, L.tileLabelY, "olio()", fz(L.labelSize), C.tileLabel, {
      ...mono,
      "text-anchor": "middle",
      "font-weight": 500
    });

    const cardText = right.icons ? 40 + right.h * 0.05 : 13;
    for (const it of right.items) {
      if (right.icons) icon(it.icon, right.x + 23, it.y, C.muted, text);
      tx(right.x + cardText, it.y - 4, it.title, nameSize, C.ink, sans);
      tx(right.x + cardText, it.y + 13, it.sub, subSize, C.muted, mono);
    }

    const hy = gen.y + gen.head;
    icon("braces", gen.x + 24, hy, C.accent, text);
    tx(gen.x + 44, hy + 5, "Codegen", nameSize, C.ink, sans);
    tx(gen.x + gen.w - 16, hy + 4, "generated.ts", subSize, C.muted, {
      ...mono,
      "text-anchor": "end"
    });
    make(
      "line",
      {
        x1: gen.x + 1,
        x2: gen.x + gen.w - 1,
        y1: hy + gen.head * 0.95,
        y2: hy + gen.head * 0.95,
        stroke: C.divider,
        "stroke-width": 1
      },
      text
    );

    const fdefs = make("defs", null, front);
    const lacStops = [
      [0, "#4A4550"],
      [0.4, "#1E1B22"],
      [1, "#050406"]
    ];
    const lac = make(
      "radialGradient",
      { id: `${id}-lac`, cx: 0.38, cy: 0.32, fx: 0.3, fy: 0.24, r: 0.8 },
      fdefs
    );
    stops(lac, lacStops);
    // Same lacquer in user space, so the neck shares the ball's lighting.
    const lacU = make(
      "radialGradient",
      {
        id: `${id}-lacu`,
        gradientUnits: "userSpaceOnUse",
        cx: node.x - 0.24 * R,
        cy: node.y - 0.36 * R,
        fx: node.x - 0.4 * R,
        fy: node.y - 0.52 * R,
        r: 1.6 * R
      },
      fdefs
    );
    stops(lacU, lacStops);
    // Bounce light from the tile along the lower rim: what makes black read as lacquer, not a hole.
    const rim = make(
      "radialGradient",
      { id: `${id}-rim`, cx: 0.4, cy: 0.34, r: 0.72 },
      fdefs
    );
    stops(rim, [
      [0.8, "#C9BFD2", 0],
      [0.94, "#C9BFD2", 0.16],
      [1, "#C9BFD2", 0]
    ]);
    const gloss = make(
      "radialGradient",
      { id: `${id}-gloss`, cx: 0.45, cy: 0.42, r: 0.62 },
      fdefs
    );
    stops(gloss, [
      [0, "#FFFFFF", 0.82],
      [0.6, "#FFFFFF", 0.6],
      [1, "#FFFFFF", 0.22]
    ]);
    const wine = make(
      "radialGradient",
      { id: `${id}-wine`, cx: 0.36, cy: 0.3, r: 0.85 },
      fdefs
    );
    stops(wine, [
      [0, C.wine[0]],
      [0.5, C.wine[1]],
      [1, C.wine[2]]
    ]);

    const trails = make(
      "g",
      { fill: "none", "stroke-linecap": "round" },
      front
    );
    const trailNodes = ins.map((s) =>
      make(
        "path",
        {
          d: s.travel.d,
          stroke: C.accent,
          "stroke-width": 2,
          "stroke-dasharray": "0 6",
          opacity: 0
        },
        trails
      )
    );
    const sdlNodes = sdl.map((rt) =>
      make(
        "path",
        {
          d: rt.d,
          stroke: C.accent,
          "stroke-width": 2,
          "stroke-dasharray": "0 6",
          opacity: 0
        },
        trails
      )
    );
    const genPacket = make(
      "circle",
      { r: 3.2, fill: C.accent, opacity: 0 },
      front
    );
    const pulseHalo = make(
      "circle",
      { r: 7, fill: C.accent, opacity: 0 },
      front
    );
    const pulse = make("circle", { r: 3, fill: C.accent, opacity: 0 }, front);
    const glowRect = (it) =>
      make(
        "rect",
        {
          x: right.x + 0.5,
          y: it.y - right.h / 2 + 0.5,
          width: right.w - 1,
          height: right.h - 1,
          rx: 14,
          fill: "none",
          stroke: C.accent,
          "stroke-width": 1.2,
          opacity: 0
        },
        front
      );
    const glow = glowRect(http);
    const glow2 = glowRect(client);

    // Module cards: name, owned type, port ball and the socket briefly left behind.
    const slots = ins.map((s) => {
      const g = make("g", null, front);
      const ghost = make(
        "circle",
        {
          cx: s.px,
          cy: s.y,
          r: left.r,
          fill: "none",
          stroke: C.ghost,
          "stroke-width": 1.3,
          "stroke-dasharray": "2 3.2",
          opacity: 0
        },
        g
      );
      const ball = make(
        "circle",
        { cx: s.px, cy: s.y, r: left.r, fill: `url(#${id}-wine)` },
        g
      );
      const glint = make(
        "circle",
        {
          cx: s.px - left.r * 0.36,
          cy: s.y - left.r * 0.38,
          r: left.r * 0.24,
          fill: "#fff",
          opacity: 0.7
        },
        g
      );
      const label = make("g", null, g);
      const name = tx(left.x + 15, s.y - 3, "", nameSize, C.ink, sans, label);
      const sub = make(
        "text",
        { x: left.x + 15, y: s.y + 14, "font-size": subSize, ...mono },
        label
      );
      const kw = make("tspan", { fill: C.kw }, sub);
      // On the smaller cards the keyword would collide with the port ball.
      kw.textContent = left.kw ? "type " : "";
      const ty = make("tspan", { fill: C.muted }, sub);
      return { g, ghost, ball, glint, label, name, ty, k: null };
    });

    // The arriving module and the neck that pulls it in sit below the schema,
    // so it sinks behind the lacquer rim instead of crossing its face.
    const neckPath = make("path", { fill: `url(#${id}-lacu)` }, front);
    const mover = make("circle", { fill: `url(#${id}-wine)`, r: 0 }, front);
    const moverGlint = make(
      "circle",
      { fill: "#fff", r: 0, opacity: 0.7 },
      front
    );
    const ring = make(
      "circle",
      {
        cx: node.x,
        cy: node.y,
        fill: "none",
        stroke: C.accent,
        "stroke-width": 1.4,
        opacity: 0
      },
      front
    );
    const core = make(
      "circle",
      { cx: node.x, cy: node.y, r: R, fill: `url(#${id}-lac)` },
      front
    );
    const rimC = make(
      "circle",
      { cx: node.x, cy: node.y, r: R, fill: `url(#${id}-rim)` },
      front
    );
    const hi1 = make("ellipse", { fill: `url(#${id}-gloss)` }, front);
    const hi2 = make("ellipse", { fill: "#fff", opacity: 0.2 }, front);

    // Codegen rows, recycled: the row for join k lives in element k % (rows + 1).
    const band = make(
      "rect",
      {
        x: gen.x + 8,
        y: gen.y + gen.rowY - gen.rowH * 0.68,
        width: gen.w - 16,
        height: gen.rowH,
        rx: 7,
        fill: C.accent,
        opacity: 0
      },
      front
    );
    const rowsG = make("g", { "clip-path": `url(#${id}-clip)` }, front);
    const rows = [];
    const codeX = gen.x + 34;
    const ownerX = gen.x + gen.w - 16;
    for (let i = 0; i <= gen.rows; i++) {
      const g = make("g", { opacity: 0 }, rowsG);
      make(
        "circle",
        {
          cx: gen.x + 21,
          cy: -codeSize * 0.34,
          r: 3.4,
          fill: `url(#${id}-wine)`
        },
        g
      );
      const code = make(
        "text",
        { x: codeX, y: 0, "font-size": codeSize, ...mono },
        g
      );
      const kw = make("tspan", { fill: C.kw }, code);
      kw.textContent = "type ";
      const ty = make("tspan", { fill: C.ink, "font-weight": 500 }, code);
      // A twin of the line in the accent colour, faded over the ink one, lets
      // the newest type settle from burgundy to ink without per-frame colour strings.
      const hotCode = make(
        "text",
        { x: codeX, y: 0, "font-size": codeSize, ...mono, opacity: 0 },
        g
      );
      const hkw = make("tspan", { fill: C.kw }, hotCode);
      hkw.textContent = "type ";
      const hty = make(
        "tspan",
        { fill: C.accentText, "font-weight": 500 },
        hotCode
      );
      const owner = make(
        "text",
        {
          x: ownerX,
          y: 0,
          "font-size": subSize,
          fill: C.muted,
          "text-anchor": "end",
          ...mono
        },
        g
      );
      const hotOwner = make(
        "text",
        {
          x: ownerX,
          y: 0,
          "font-size": subSize,
          fill: C.accentText,
          "text-anchor": "end",
          ...mono,
          opacity: 0
        },
        g
      );
      rows.push({ g, ty, hty, code, hotCode, owner, hotOwner, k: null });
    }

    F = {
      ins,
      sdl,
      sdlNodes,
      toHttp,
      toClient,
      trailNodes,
      genPacket,
      pulse,
      pulseHalo,
      glow,
      glow2,
      slots,
      neckPath,
      mover,
      moverGlint,
      ring,
      core,
      rimC,
      hi1,
      hi2,
      band,
      rows
    };
  };

  const layout = () => {
    const box = host.getBoundingClientRect();
    const w = box.width || 600;
    const h = box.height || 514;
    const scale = (l) => Math.min(w / l.W, h / l.H);
    let next = "phone";
    if (scale(LAYOUTS.desk) >= MIN_SCALE) next = "desk";
    else if (scale(LAYOUTS.mid) >= MIN_SCALE) next = "mid";
    const s = scale(LAYOUTS[next]);
    const nextFloor = Math.round((MIN_PX / s) * 20) / 20;
    if (next !== mode || Math.abs(nextFloor - floor) > 0.04) {
      mode = next;
      L = LAYOUTS[mode];
      floor = nextFloor;
      build();
      return true;
    }
    return false;
  };

  const draw = (t) => {
    const { node, left, gen } = L;
    const R = node.R;

    // Module cards: module k holds its card from just after module k-3 leaves
    // until it departs itself, so a card is only ever empty for a breath.
    for (let j = 0; j < 3; j++) {
      const s = F.slots[SLOT_OF[j]];
      const c = Math.floor((t - HOLD - DEPART - j * P) / (3 * P)) + 1;
      const k = j + 3 * c;
      const q = t - (k * P + DEPART - 3 * P);
      if (s.k !== k) {
        s.k = k;
        const m = MODULES[mod(k, MODULES.length)];
        s.name.textContent = m[0];
        s.ty.textContent = m[1];
      }
      const enter = smooth((q - HOLD) / 0.45);
      const away = q >= 3 * P;
      const leave = away ? 1 - smooth((q - 3 * P - 0.12) / (HOLD - 0.12)) : 1;
      set(s.label, "opacity", enter * leave);
      set(s.label, "transform", `translate(0 ${(1 - enter) * 4})`);
      const br = away
        ? 0
        : left.r *
          Math.max(0, backOut((q - HOLD - 0.12) / 0.6)) *
          (q > HOLD + 0.12 ? 1 : 0);
      set(s.ball, "r", br);
      set(s.glint, "r", br * 0.24);
      const socket = away
        ? smooth((q - 3 * P) / 0.25)
        : 1 - smooth((q - HOLD) / 0.35);
      set(s.ghost, "opacity", 0.9 * socket);
    }

    // The module currently on its way in.
    const k = Math.floor(t / P);
    const u = t - k * P;
    const lane = SLOT_OF[mod(k, 3)];
    const s = F.ins[lane];
    const trail = F.trailNodes[lane];
    for (const other of F.trailNodes)
      if (other !== trail) set(other, "opacity", 0);
    set(
      trail,
      "opacity",
      0.75 * smooth((u - DEPART) / 0.45) * (1 - smooth((u - 1.6) / 0.9))
    );

    // The schema breathes once as a module settles into it.
    const swell = 0.04 * Math.sin(Math.PI * clamp((u - (MOVE - 0.8)) / 1.2));
    if (u >= DEPART && u < MOVE + 0.05) {
      // Glide to a kiss just outside the rim, let the neck form, then get pulled in.
      const len = s.travel.len;
      const kiss = 1 - (R + left.r + 5) / len;
      const f =
        u < ARRIVE
          ? kiss * sine((u - DEPART) / (ARRIVE - DEPART))
          : kiss +
            (1 - (R * 0.25) / len - kiss) *
              sine((u - ARRIVE) / (MOVE - ARRIVE));
      along(s.travel, f, pt);
      const dist = node.x - pt.x + Math.abs(node.y - pt.y);
      const r =
        left.r *
        (dist < R ? 0.6 + 0.4 * smooth((dist - R * 0.35) / (R * 0.65)) : 1);
      set(F.mover, "cx", pt.x);
      set(F.mover, "cy", pt.y);
      set(F.mover, "r", r);
      set(F.moverGlint, "cx", pt.x - r * 0.36);
      set(F.moverGlint, "cy", pt.y - r * 0.38);
      set(F.moverGlint, "r", r * 0.24);
      set(F.moverGlint, "opacity", 0.7 * smooth((dist - R + r * 0.5) / r));
      set(
        F.neckPath,
        "d",
        neck(node.x, node.y, R * (1 + swell), pt.x, pt.y, r)
      );
    } else {
      set(F.mover, "r", 0);
      set(F.moverGlint, "r", 0);
      set(F.neckPath, "d", "");
    }
    const cr = R * (1 + swell);
    set(F.core, "r", cr);
    set(F.rimC, "r", cr);
    const h1x = node.x - cr * 0.34;
    const h1y = node.y - cr * 0.47;
    set(F.hi1, "cx", h1x);
    set(F.hi1, "cy", h1y);
    set(F.hi1, "rx", cr * 0.36);
    set(F.hi1, "ry", cr * 0.19);
    set(F.hi1, "transform", `rotate(-32 ${h1x} ${h1y})`);
    const h2x = node.x + cr * 0.46;
    const h2y = node.y + cr * 0.48;
    set(F.hi2, "cx", h2x);
    set(F.hi2, "cy", h2y);
    set(F.hi2, "rx", cr * 0.14);
    set(F.hi2, "ry", cr * 0.055);
    set(F.hi2, "transform", `rotate(-42 ${h2x} ${h2y})`);
    const rk = clamp((u - (MOVE - 0.45)) / 1.4);
    set(F.ring, "r", R * (1.1 + 0.24 * (1 - (1 - rk) * (1 - rk))));
    set(F.ring, "opacity", rk > 0 && rk < 1 ? 0.5 * (1 - rk) : 0);

    // Runtime: one soft pulse from the schema to HTTP after each join, then on
    // down to the clients that call it.
    const kj = Math.floor((t - JOIN) / P);
    const v = t - JOIN - kj * P;
    const hp = (v - PULSE_AT) / PULSE_DUR;
    const dp = (v - PULSE_AT - PULSE_DUR - 0.25) / DROP_DUR;
    let pa = 0;
    if (hp > 0 && hp < 1) {
      along(F.toHttp, sine(hp), pt);
      pa = smooth(hp / 0.15) * (1 - smooth((hp - 0.8) / 0.2));
    } else if (dp > 0 && dp < 1) {
      along(F.toClient, sine(dp), pt);
      pa = 0.7 * smooth(dp / 0.2) * (1 - smooth((dp - 0.75) / 0.25));
    }
    if (pa > 0) {
      set(F.pulse, "cx", pt.x);
      set(F.pulse, "cy", pt.y);
      set(F.pulseHalo, "cx", pt.x);
      set(F.pulseHalo, "cy", pt.y);
    }
    set(F.pulse, "opacity", 0.9 * pa);
    set(F.pulseHalo, "opacity", 0.14 * pa);
    const gw = v - PULSE_AT - PULSE_DUR * 0.85;
    set(
      F.glow,
      "opacity",
      gw > 0 && gw < GLOW_DUR
        ? 0.5 *
            smooth(gw / 0.15) *
            (1 - smooth((gw - 0.15) / (GLOW_DUR - 0.15)))
        : 0
    );
    const gw2 = v - PULSE_AT - PULSE_DUR - 0.25 - DROP_DUR * 0.85;
    set(
      F.glow2,
      "opacity",
      gw2 > 0 && gw2 < GLOW_DUR
        ? 0.32 *
            smooth(gw2 / 0.15) *
            (1 - smooth((gw2 - 0.15) / (GLOW_DUR - 0.15)))
        : 0
    );

    // Build time: the module that just took a card sends its SDL down the bus to codegen.
    const pk = Math.floor((t - CG0) / P);
    const w = t - CG0 - pk * P;
    const cgLane = SLOT_OF[mod(pk, 3)];
    for (let i = 0; i < F.sdlNodes.length; i++) {
      set(
        F.sdlNodes[i],
        "opacity",
        i === cgLane
          ? 0.7 * smooth(w / 0.3) * (1 - smooth((w - CG_DUR) / 0.6))
          : 0
      );
    }
    const gp = w / CG_DUR;
    if (gp < 1) {
      along(F.sdl[cgLane], sine(gp), pt);
      set(F.genPacket, "cx", pt.x);
      set(F.genPacket, "cy", pt.y);
      set(
        F.genPacket,
        "opacity",
        smooth(gp / 0.15) * (1 - smooth((gp - 0.85) / 0.15))
      );
    } else {
      set(F.genPacket, "opacity", 0);
    }

    // Codegen rows: newest on top, older ones step down, the fourth fades out.
    // The rows are always the modules on the cards, newest card first.
    const K = Math.floor((t - ROW0) / P);
    const since = t - ROW0 - K * P;
    const e = smooth(since / ROW_DUR);
    const heat =
      since < HOT_HOLD ? 1 : 1 - smooth((since - HOT_HOLD) / HOT_FADE);
    set(F.band, "opacity", C.band * smooth(since / 0.3) * heat);
    const n = F.rows.length;
    const last = gen.rows - 1;
    for (let i = 0; i < n; i++) {
      const rk2 = K - mod(K - i, n);
      const row = F.rows[mod(rk2, n)];
      if (row.k !== rk2) {
        row.k = rk2;
        const m = MODULES[mod(rk2, MODULES.length)];
        row.ty.textContent = m[1];
        row.hty.textContent = m[1];
        row.owner.textContent = m[0];
        row.hotOwner.textContent = m[0];
      }
      let y;
      let op;
      let x = 0;
      if (rk2 === K) {
        // The new row prints in place once the row below has made room,
        // so it never overlaps the header or its neighbour.
        const a = smooth((since - ROW_DUR * 0.35) / (ROW_DUR * 0.75));
        y = 0;
        op = a;
        x = (1 - a) * -6;
      } else {
        const idx = K - rk2 - 1 + e;
        y = idx > last ? last + (idx - last) * 0.5 : idx;
        op = idx > last ? 1 - smooth((idx - last) / 0.7) : 1;
      }
      set(
        row.g,
        "transform",
        `translate(${x} ${gen.y + gen.rowY + y * gen.rowH})`
      );
      set(row.g, "opacity", op);
      const hot = rk2 === K ? heat : 0;
      set(row.hotCode, "opacity", hot);
      set(row.hotOwner, "opacity", hot);
      set(row.code, "opacity", 1 - hot);
      set(row.owner, "opacity", 1 - hot);
    }
  };

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let raf = 0;
  let last = 0;
  let clock = STILL_AT;
  let onScreen = true;
  const loop = (now) => {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    clock += dt;
    draw(clock);
    raf = requestAnimationFrame(loop);
  };
  const running = () => onScreen && !document.hidden && !reduced.matches;
  const sync = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (running()) raf = requestAnimationFrame(loop);
    else draw(reduced.matches ? STILL_AT : clock);
  };

  const rebuild = () => {
    build();
    draw(clock);
  };

  const resize = new ResizeObserver(() => {
    if (layout()) draw(clock);
  });
  const visibility = new IntersectionObserver((entries) => {
    onScreen = entries.some((x) => x.isIntersecting);
    sync();
  });

  layout();
  draw(clock);
  resize.observe(host);
  visibility.observe(host);
  document.addEventListener("visibilitychange", sync);
  reduced.addEventListener("change", sync);
  // Cards are sized with room to spare, but rebuilding once the real fonts
  // arrive keeps every text node on the final metrics.
  document.fonts.ready.then(rebuild).catch(() => undefined);
  sync();

  return {
    setTheme(next) {
      themeName = next === "dark" ? "dark" : "light";
      C = THEMES[themeName];
      rebuild();
    }
  };
}
