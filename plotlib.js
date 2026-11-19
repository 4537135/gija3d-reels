// Runs INSIDE the sandboxed art iframe (see template.html). Gives scene code a small, accurate
// graphing toolkit on a 920x620 canvas. Everything is a pure function of the arguments, so
// each frame renders identically. Scene code signature:  draw(ctx, t, d, P, C)
//   t = seconds into the scene, d = scene length, C = { accent, ink, muted, grid, dim }
const P = (() => {
  let W = 920, H = 620; // the sandbox calls P.setup() with the real canvas size (1080x1920 in math format)
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const ease = u => { u = clamp(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
  // prog(t, start, end): eased 0..1 as t goes start..end (seconds)
  const prog = (t, a, b) => ease((t - a) / Math.max(b - a, 1e-6));
  const C = { accent: '#C6FF00', ink: '#F2EFE8', muted: '#8A8780', grid: 'rgba(255,255,255,0.09)', dim: '#4a4944' };

  function text(ctx, x, y, str, o = {}) {
    ctx.save();
    // o.font: 'math' = italic serif like typeset formulas, 'title' = heavy sans, default = brand display font
    ctx.font = o.font === 'math' ? `italic ${o.weight || 400} ${o.size || 28}px "Cambria Math", Cambria, "Times New Roman", serif`
      : o.font === 'title' ? `${o.weight || 800} ${o.size || 28}px Manrope, "Segoe UI", Arial, sans-serif`
      : `${o.weight || 200} ${o.size || 28}px Unbounded, sans-serif`;
    ctx.fillStyle = o.color || C.ink; ctx.globalAlpha *= o.alpha ?? 1;
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.baseline || 'middle';
    ctx.fillText(String(str), x, y);
    ctx.restore();
  }

  // Stroke a list of [px,py] points, breaking at gaps (null) and drawing only the first `progress` share.
  function strokePts(ctx, pts, o = {}) {
    const n = Math.max(0, Math.floor(pts.length * clamp(o.progress ?? 1)));
    if (n < 2) return;
    ctx.save();
    ctx.strokeStyle = o.color || C.accent; ctx.lineWidth = o.width || 5;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.globalAlpha *= o.alpha ?? 1;
    if (o.dash) ctx.setLineDash(o.dash);
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      if (!p) { pen = false; continue; }
      if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; }
    }
    ctx.stroke(); ctx.restore();
  }

  // axes(ctx, { x:[min,max], y:[min,max], box:[left,top,width,height], equal, grid, axis, step:[sx,sy], numbers })
  function axes(ctx, o = {}) {
    let [x0, x1] = o.x || [-5, 5], [y0, y1] = o.y || [-5, 5];
    const [bl, bt, bw, bh] = o.box || [60, 20, W - 120, H - 40];
    if (o.equal) { // same scale on both axes (circles stay round): grow the tighter range
      const sx = bw / (x1 - x0), sy = bh / (y1 - y0);
      if (sx > sy) { const c = (x0 + x1) / 2, half = bw / sy / 2; x0 = c - half; x1 = c + half; }
      else { const c = (y0 + y1) / 2, half = bh / sx / 2; y0 = c - half; y1 = c + half; }
    }
    const X = x => bl + ((x - x0) / (x1 - x0)) * bw, Y = y => bt + bh - ((y - y0) / (y1 - y0)) * bh;
    const nice = span => { const r = span / 8, p = Math.pow(10, Math.floor(Math.log10(r))), m = r / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };
    const [sx, sy] = o.step || [nice(x1 - x0), nice(y1 - y0)];
    const fmt = v => String(+v.toFixed(6));
    const clip = fn => { ctx.save(); ctx.beginPath(); ctx.rect(bl - 4, bt - 4, bw + 8, bh + 8); ctx.clip(); fn(); ctx.restore(); };

    ctx.save();
    if (o.grid !== false) {
      ctx.strokeStyle = C.grid; ctx.lineWidth = 2; ctx.beginPath();
      for (let v = Math.ceil(x0 / sx) * sx; v <= x1 + 1e-9; v += sx) { ctx.moveTo(X(v), bt); ctx.lineTo(X(v), bt + bh); }
      for (let v = Math.ceil(y0 / sy) * sy; v <= y1 + 1e-9; v += sy) { ctx.moveTo(bl, Y(v)); ctx.lineTo(bl + bw, Y(v)); }
      ctx.stroke();
    }
    if (o.axis !== false) {
      ctx.strokeStyle = C.muted; ctx.lineWidth = 3; ctx.beginPath();
      if (y0 <= 0 && y1 >= 0) { ctx.moveTo(bl, Y(0)); ctx.lineTo(bl + bw, Y(0)); }
      if (x0 <= 0 && x1 >= 0) { ctx.moveTo(X(0), bt); ctx.lineTo(X(0), bt + bh); }
      ctx.stroke();
    }
    ctx.restore();
    if (o.numbers) {
      const ay = clamp(Y(0), bt, bt + bh), ax = clamp(X(0), bl, bl + bw);
      for (let v = Math.ceil(x0 / sx) * sx; v <= x1 + 1e-9; v += sx) if (Math.abs(v) > 1e-9) text(ctx, X(v), ay + 22, fmt(v), { size: 18, color: C.muted, align: 'center' });
      for (let v = Math.ceil(y0 / sy) * sy; v <= y1 + 1e-9; v += sy) if (Math.abs(v) > 1e-9) text(ctx, ax - 12, Y(v), fmt(v), { size: 18, color: C.muted, align: 'right' });
    }

    const g = {
      x0, x1, y0, y1, X, Y, box: [bl, bt, bw, bh],
      // y = fn(x). opts: from, to, progress (0..1 draw-on), color, width, dash, alpha, samples
      plot(fn, q = {}) {
        const a = q.from ?? x0, b = q.to ?? x1, N = q.samples || 600, pts = [];
        const jump = (y1 - y0) * 3;
        let prev = null;
        for (let i = 0; i <= N; i++) {
          const x = a + ((b - a) * i) / N, y = fn(x);
          if (!Number.isFinite(y) || (prev !== null && Math.abs(y - prev) > jump)) { pts.push(null); prev = null; continue; }
          pts.push([X(x), Y(y)]); prev = y;
        }
        clip(() => strokePts(ctx, pts, q));
        return g;
      },
      // parametric: x = fx(s), y = fy(s) for s in q.t = [a,b]
      param(fx, fy, q = {}) {
        const [a, b] = q.t || [0, 1], N = q.samples || 800, pts = [];
        for (let i = 0; i <= N; i++) {
          const s = a + ((b - a) * i) / N, x = fx(s), y = fy(s);
          pts.push(Number.isFinite(x) && Number.isFinite(y) ? [X(x), Y(y)] : null);
        }
        clip(() => strokePts(ctx, pts, q));
        return g;
      },
      // polar: r = rf(theta) for theta in q.theta = [a,b]; q.rot rotates the whole curve (radians), q.at = [cx,cy] moves its pole
      polar(rf, q = {}) {
        const [a, b] = q.theta || [0, 2 * Math.PI], rot = q.rot || 0, [cx, cy] = q.at || [0, 0];
        return g.param(s => cx + rf(s) * Math.cos(s + rot), s => cy + rf(s) * Math.sin(s + rot), { ...q, t: [a, b] });
      },
      // filled region between y = fn(x) and y = (q.base ?? 0) for x in [a,b]
      area(fn, a, b, q = {}) {
        const N = 300, base = q.base ?? 0;
        clip(() => {
          ctx.save(); ctx.fillStyle = q.color || C.accent; ctx.globalAlpha *= q.alpha ?? 0.25;
          ctx.beginPath(); ctx.moveTo(X(a), Y(base));
          for (let i = 0; i <= N; i++) { const x = a + ((b - a) * i) / N, y = fn(x); ctx.lineTo(X(x), Y(Number.isFinite(y) ? y : base)); }
          ctx.lineTo(X(b), Y(base)); ctx.closePath(); ctx.fill(); ctx.restore();
        });
        return g;
      },
      line(xa, ya, xb, yb, q = {}) { strokePts(ctx, [[X(xa), Y(ya)], [X(xb), Y(yb)]], { color: C.ink, width: 3, ...q }); return g; },
      // closed or open polygon through math-coordinate points [[x,y],...]; q.fill = colour to fill
      poly(points, q = {}) {
        ctx.save(); ctx.beginPath();
        points.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
        if (q.close !== false) ctx.closePath();
        ctx.globalAlpha *= q.alpha ?? 1;
        if (q.fill) { ctx.fillStyle = q.fill; ctx.fill(); }
        if (q.color || !q.fill) { ctx.strokeStyle = q.color || C.ink; ctx.lineWidth = q.width || 3; ctx.lineJoin = 'round'; ctx.stroke(); }
        ctx.restore(); return g;
      },
      circle(x, y, r, q = {}) { // r in math units (use equal:true so it stays round)
        ctx.save(); ctx.beginPath(); ctx.ellipse(X(x), Y(y), Math.abs(X(r) - X(0)), Math.abs(Y(r) - Y(0)), 0, 0, 2 * Math.PI);
        ctx.globalAlpha *= q.alpha ?? 1;
        if (q.fill) { ctx.fillStyle = q.fill; ctx.fill(); }
        if (q.color || !q.fill) { ctx.strokeStyle = q.color || C.ink; ctx.lineWidth = q.width || 3; if (q.dash) ctx.setLineDash(q.dash); ctx.stroke(); }
        ctx.restore(); return g;
      },
      dot(x, y, q = {}) {
        ctx.save(); ctx.fillStyle = q.color || C.accent; ctx.globalAlpha *= q.alpha ?? 1;
        ctx.beginPath(); ctx.arc(X(x), Y(y), q.r || 10, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
        if (q.label) text(ctx, X(x) + (q.dx ?? 16), Y(y) + (q.dy ?? -18), q.label, { size: q.size || 24, color: q.labelColor || C.ink });
        return g;
      },
      text(x, y, str, q = {}) { text(ctx, X(x) + (q.dx || 0), Y(y) + (q.dy || 0), str, q); return g; },
    };
    return g;
  }

  // row(ctx, cx, y, [['r₁', colour], [' + ', colour], ...], { size, font }): one centred line made of coloured pieces
  function row(ctx, cx, y, parts, o = {}) {
    const q = { size: 44, font: 'math', ...o, align: 'left' };
    const widths = parts.map(([s]) => measure(ctx, s, q));
    let x = cx - widths.reduce((a, b) => a + b, 0) / 2;
    parts.forEach(([s, color], i) => { text(ctx, x, y, s, { ...q, color: color || C.ink }); x += widths[i]; });
    return x;
  }
  function measure(ctx, str, o = {}) {
    ctx.save();
    ctx.font = o.font === 'math' ? `italic ${o.weight || 400} ${o.size || 28}px "Cambria Math", Cambria, "Times New Roman", serif`
      : o.font === 'title' ? `${o.weight || 800} ${o.size || 28}px Manrope, "Segoe UI", Arial, sans-serif`
      : `${o.weight || 200} ${o.size || 28}px Unbounded, sans-serif`;
    const w = ctx.measureText(String(str)).width; ctx.restore(); return w;
  }
  // frac(ctx, cx, y, top, bottom, { size, color, topColor, bottomColor }): a stacked fraction centred at (cx, y); returns its width
  function frac(ctx, cx, y, top, bottom, o = {}) {
    const q = { size: 44, font: 'math', ...o }, w = Math.max(measure(ctx, top, q), measure(ctx, bottom, q)) + q.size * 0.3;
    text(ctx, cx, y - q.size * 0.62, top, { ...q, align: 'center', color: o.topColor || o.color || C.ink });
    text(ctx, cx, y + q.size * 0.62, bottom, { ...q, align: 'center', color: o.bottomColor || o.color || C.ink });
    ctx.save(); ctx.strokeStyle = o.color || C.ink; ctx.lineWidth = Math.max(2, q.size / 18);
    ctx.beginPath(); ctx.moveTo(cx - w / 2, y); ctx.lineTo(cx + w / 2, y); ctx.stroke(); ctx.restore();
    return w;
  }
  // tint('#168579', 0.4) -> lighter (towards white); negative -> darker. alpha('#168579', 0.3) -> rgba string.
  const rgb = hex => { const h = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const tint = (hex, u) => '#' + rgb(hex).map(v => Math.round(u >= 0 ? v + (255 - v) * u : v * (1 + u)).toString(16).padStart(2, '0')).join('');
  const alpha = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
  const api = { C, clamp, lerp, ease, prog, text, measure, row, frac, axes, tint, alpha, PI: Math.PI, TAU: 2 * Math.PI,
    get W() { return W; }, get H() { return H; },
    setup(o = {}) { if (o.w) W = o.w; if (o.h) H = o.h; Object.assign(C, o.colors || {}); } };
  return api;
})();
