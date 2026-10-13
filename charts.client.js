// Runs in the browser (inlined into the encrypted page). Draws the "Grafici" view from the embedded data.
// Averages follow the same rules as the build: weights, recupero already applied, groups weighted by
// group_weight, maturità subjects count with their last semester in "Anno", neutra subjects left out.
(function () {
  var DATA = JSON.parse(document.getElementById('chart-data').textContent);
  var root = document.getElementById('charts');
  if (!root) return;
  var NS = 'http://www.w3.org/2000/svg';
  var C = { line: '#7c9cff', grid: '#263046', axis: '#8b95a7', good: '#3ecf8e', ok: '#f5b942', bad: '#ff6b6b', surface: '#161d2b' };

  function h(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toIt(ch) { return ch >= 4 ? 6 + (ch - 4) * 2 : 1 + ((ch - 1) * 5) / 3; }
  function status(ch) { return ch >= 5 ? 'good' : ch >= 4 ? 'ok' : 'bad'; }
  function fmt(n) { return (Math.round(n * 100) / 100).toString(); }
  function wavg(gs) {
    var w = 0, s = 0;
    gs.forEach(function (g) { w += g.w; s += g.v * g.w; });
    return w > 0 ? s / w : null;
  }
  function inScope(g, unit, y, period) {
    if (period === 'anno') return unit.maturita ? String(g.sem) === y.lastSem : true;
    return String(g.sem) === period;
  }
  function unitAvg(unit, gs, y, period) {
    var leaves = unit.children || [{ id: unit.id, w: 1 }];
    var sw = 0, s = 0;
    leaves.forEach(function (l) {
      var a = wavg(gs.filter(function (g) { return g.s === l.id && inScope(g, unit, y, period); }));
      if (a !== null && l.w > 0) { sw += l.w; s += a * l.w; }
    });
    return sw > 0 ? s / sw : null;
  }
  function overall(gs, y, period) {
    var vals = y.units.filter(function (u) { return !u.neutra; })
      .map(function (u) { return unitAvg(u, gs, y, period); })
      .filter(function (v) { return v !== null; });
    return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
  }
  function leafName(y, id) { return (y.leaves.filter(function (l) { return l.id === id; })[0] || {}).name || 'Altro'; }
  function leafUnit(y, id) {
    return y.units.filter(function (u) { return u.id === id || (u.children || []).some(function (c) { return c.id === id; }); })[0];
  }
  var fmtDay = function (d) { var p = d.split('-'); return +p[2] + '/' + +p[1]; };

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function svg(h) { return el('svg', { viewBox: '0 0 340 ' + h, class: 'chart', role: 'img' }); }

  // ---------- tooltip (tap or hover) ----------
  var tip = document.createElement('div');
  tip.className = 'tip'; tip.hidden = true; document.body.appendChild(tip);
  function showTip(e, text) {
    tip.innerHTML = text; tip.hidden = false;
    var x = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, e.clientX - tip.offsetWidth / 2));
    tip.style.left = x + 'px'; tip.style.top = (e.clientY - tip.offsetHeight - 14) + 'px';
  }
  function hint(node, text) {
    node.addEventListener('pointerenter', function (e) { showTip(e, text); });
    node.addEventListener('pointerdown', function (e) { e.stopPropagation(); showTip(e, text); });
    node.addEventListener('pointerleave', function () { tip.hidden = true; });
  }
  document.addEventListener('pointerdown', function () { tip.hidden = true; });
  window.addEventListener('scroll', function () { tip.hidden = true; }, { passive: true });

  // ---------- chart types ----------
  // Line on the Italian scale (1–10) with the 6 line, plus optional grade dots.
  function lineChart(points, dots) {
    var H = 190, L = 30, R = 330, T = 12, B = 160;
    var s = svg(H);
    var all = points.map(function (p) { return p.y; }).concat((dots || []).map(function (p) { return p.y; }));
    var lo = Math.max(1, Math.floor(Math.min.apply(null, all.concat([6])) - 0.5)), hi = 10;
    var t0 = new Date(points[0].x).getTime(), t1 = new Date(points[points.length - 1].x).getTime();
    if (dots && dots.length) { t0 = Math.min(t0, new Date(dots[0].x).getTime()); t1 = Math.max(t1, new Date(dots[dots.length - 1].x).getTime()); }
    if (t1 === t0) { t0 -= 86400000; t1 += 86400000; }
    var X = function (d) { return L + ((new Date(d).getTime() - t0) / (t1 - t0)) * (R - L); };
    var Y = function (v) { return B - ((v - lo) / (hi - lo)) * (B - T); };
    for (var v = lo; v <= hi; v++) {
      if ((hi - lo) > 6 && v % 2 && v !== 6) continue;
      el('line', { x1: L, x2: R, y1: Y(v), y2: Y(v), stroke: C.grid, 'stroke-width': 1, 'stroke-dasharray': v === 6 ? '4 4' : '' , opacity: v === 6 ? 1 : 0.6 }, s);
      el('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', class: v === 6 ? 'ax six' : 'ax' }, s).textContent = v;
    }
    el('text', { x: L, y: H - 8, class: 'ax' }, s).textContent = fmtDay(points[0].x);
    el('text', { x: R, y: H - 8, 'text-anchor': 'end', class: 'ax' }, s).textContent = fmtDay(points[points.length - 1].x);
    (dots || []).forEach(function (p) {
      el('circle', { cx: X(p.x), cy: Y(p.y), r: 4, fill: C[status(p.ch)], stroke: C.surface, 'stroke-width': 2, opacity: 0.85 }, s);
    });
    if (points.length > 1) {
      el('polyline', { points: points.map(function (p) { return X(p.x) + ',' + Y(p.y); }).join(' '), fill: 'none', stroke: C.line, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, s);
    }
    var last = points[points.length - 1];
    el('circle', { cx: X(last.x), cy: Y(last.y), r: 5, fill: C.line, stroke: C.surface, 'stroke-width': 2 }, s);
    // Generous invisible hit targets.
    points.concat(dots || []).forEach(function (p) {
      hint(el('circle', { cx: X(p.x), cy: Y(p.y), r: 14, fill: 'transparent' }, s), p.tip);
    });
    return s;
  }

  // Horizontal bars (one per subject), value label at the end.
  function barsH(items) {
    var row = 30, H = items.length * row + 8, L = 118, R = 300;
    var s = svg(H);
    var X = function (v) { return L + ((v - 1) / 9) * (R - L); };
    el('line', { x1: X(6), x2: X(6), y1: 0, y2: H, stroke: C.axis, 'stroke-dasharray': '4 4', opacity: 0.6 }, s);
    items.forEach(function (it, i) {
      var y = i * row + 6;
      var name = it.label.length > 16 ? it.label.slice(0, 15) + '…' : it.label;
      el('text', { x: L - 8, y: y + 15, 'text-anchor': 'end', class: 'lb' }, s).textContent = name;
      el('rect', { x: L, y: y + 4, width: Math.max(4, X(it.it) - L), height: 14, rx: 4, fill: C[status(it.ch)] }, s);
      el('text', { x: X(it.it) + 6, y: y + 15, class: 'val' }, s).textContent = fmt(it.it);
      hint(el('rect', { x: 0, y: y, width: 340, height: row, fill: 'transparent' }, s), '<b>' + h(it.label) + '</b><br>' + fmt(it.it) + ' <small>(CH ' + fmt(it.ch) + ')</small>');
    });
    return s;
  }

  // Vertical count bars.
  function barsV(items) {
    var H = 178, T = 26, B = 148;
    var s = svg(H);
    var max = Math.max.apply(null, items.map(function (i) { return i.n; }).concat([1]));
    // Thin bars: at most 56px wide, centred when there are only a few.
    var bw = Math.min(56, 324 / items.length), L = (340 - bw * items.length) / 2, R = 340 - L;
    el('line', { x1: L, x2: R, y1: B, y2: B, stroke: C.grid }, s);
    items.forEach(function (it, i) {
      var h = (it.n / max) * (B - T), x = L + i * bw + 2;
      if (it.n) {
        el('rect', { x: x, y: B - h, width: bw - 4, height: h, rx: 4, fill: it.color || C.line }, s);
        el('text', { x: x + (bw - 4) / 2, y: B - h - 5, 'text-anchor': 'middle', class: 'val' }, s).textContent = it.n;
      }
      el('text', { x: x + (bw - 4) / 2, y: B + 16, 'text-anchor': 'middle', class: 'ax' }, s).textContent = it.label;
      if (it.sub) el('text', { x: x + (bw - 4) / 2, y: B + 28, 'text-anchor': 'middle', class: 'ax small' }, s).textContent = it.sub;
      hint(el('rect', { x: L + i * bw, y: T, width: bw, height: B - T + 30, fill: 'transparent' }, s), it.tip);
    });
    return s;
  }

  // ---------- view ----------
  var state = { period: null, subject: '' };
  function currentYear() {
    var sel = document.getElementById('year');
    var y = sel ? sel.value : DATA[0] && DATA[0].year;
    return DATA.filter(function (d) { return d.year === y; })[0] || DATA[0];
  }
  function card(title, note, node) {
    var c = document.createElement('div');
    c.className = 'card chart-card';
    c.innerHTML = '<div class="chart-title">' + title + '</div>' + (note ? '<div class="chart-note">' + note + '</div>' : '');
    if (typeof node === 'string') { var p = document.createElement('div'); p.className = 'muted'; p.textContent = node; c.appendChild(p); }
    else c.appendChild(node);
    return c;
  }

  function render() {
    var y = currentYear();
    root.innerHTML = '';
    if (!y || !y.grades.length) { root.innerHTML = '<div class="card muted">Ancora nessun voto.</div>'; return; }
    if (!state.period || (state.period !== 'anno' && y.semesters.indexOf(state.period) < 0)) state.period = y.lastSem;

    // Filters: one row above the charts.
    var f = document.createElement('div');
    f.className = 'chart-filters';
    f.innerHTML = '<div class="seg small">' + y.semesters.map(function (s) { return '<button data-p="' + s + '">Sem. ' + s + '</button>'; }).join('') +
      '<button data-p="anno">Anno</button></div>' +
      '<select id="c-subject"><option value="">Tutte le materie</option>' + y.leaves.map(function (l) { return '<option value="' + h(l.id) + '">' + h(l.name) + '</option>'; }).join('') + '</select>';
    root.appendChild(f);
    f.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.p === state.period);
      b.addEventListener('click', function () { state.period = b.dataset.p; render(); });
    });
    var sel = f.querySelector('select');
    if (y.leaves.some(function (l) { return l.id === state.subject; })) sel.value = state.subject; else state.subject = '';
    sel.addEventListener('change', function () { state.subject = sel.value; render(); });

    var period = state.period;
    var periodLabel = period === 'anno' ? "l'anno" : 'il semestre ' + period;
    var gs = y.grades.slice().sort(function (a, b) { return a.d.localeCompare(b.d); });
    // Grades that belong to the chosen period (for maturità subjects "Anno" means the last semester).
    var inPeriod = gs.filter(function (g) { var u = leafUnit(y, g.s); return u && inScope(g, u, y, period); });
    var picked = state.subject ? inPeriod.filter(function (g) { return g.s === state.subject; }) : inPeriod;

    if (state.subject) {
      // Subject trend: running average after each grade, plus the grades themselves.
      var pts = [], acc = [];
      picked.forEach(function (g) {
        acc.push(g); var a = wavg(acc);
        if (a !== null) pts.push({ x: g.d, y: toIt(a), tip: fmtDay(g.d) + ' · media <b>' + fmt(toIt(a)) + '</b>' });
      });
      var dots = picked.map(function (g) { return { x: g.d, y: toIt(g.v), ch: g.v, tip: fmtDay(g.d) + ' · ' + h(g.t || 'voto') + ': <b>' + fmt(toIt(g.v)) + '</b> <small>(CH ' + fmt(g.v) + ')</small>' }; });
      root.appendChild(card('Andamento: ' + h(leafName(y, state.subject)), 'Linea = media, punti = singoli voti, per ' + periodLabel + '.',
        pts.length ? lineChart(pts, dots) : 'Nessun voto in questo periodo.'));
    } else {
      // Overall average after each day with grades.
      var days = [], seen = {};
      inPeriod.forEach(function (g) { if (!seen[g.d]) { seen[g.d] = 1; days.push(g.d); } });
      var ov = days.map(function (d) {
        var a = overall(gs.filter(function (g) { return g.d <= d; }), y, period);
        return a === null ? null : { x: d, y: toIt(a), tip: fmtDay(d) + ' · media generale <b>' + fmt(toIt(a)) + '</b>' };
      }).filter(Boolean);
      root.appendChild(card('Media generale nel tempo', 'Come è cambiata la media dopo ogni voto, per ' + periodLabel + '.',
        ov.length ? lineChart(ov) : 'Nessun voto in questo periodo.'));

      // Average per subject, best first.
      var items = y.units.filter(function (u) { return !u.neutra; }).map(function (u) {
        var a = unitAvg(u, gs, y, period);
        return a === null ? null : { label: u.name, ch: a, it: toIt(a) };
      }).filter(Boolean).sort(function (a, b) { return b.it - a.it; });
      root.appendChild(card('Media per materia', 'La linea tratteggiata è il 6. Tocca una barra per i dettagli.',
        items.length ? barsH(items) : 'Nessun voto in questo periodo.'));
    }

    // Grade distribution (Swiss half points, labelled in Italian).
    var buckets = [];
    for (var b = 1; b <= 6; b += 0.5) buckets.push(b);
    var dist = buckets.map(function (b) {
      var n = picked.filter(function (g) { return Math.round(g.v * 2) / 2 === b; }).length;
      return { label: fmt(toIt(b)), sub: 'CH ' + b, n: n, color: C[status(b)], tip: n + (n === 1 ? ' voto' : ' voti') + ' da <b>' + fmt(toIt(b)) + '</b> <small>(CH ' + b + ')</small>' };
    }).filter(function (it, i, arr) { return it.n || (i > 0 && arr.slice(0, i).some(function (x) { return x.n; }) && arr.slice(i).some(function (x) { return x.n; })); });
    root.appendChild(card('Distribuzione dei voti', (state.subject ? h(leafName(y, state.subject)) : 'Tutte le materie') + ', ' + periodLabel + '.',
      dist.length ? barsV(dist) : 'Nessun voto in questo periodo.'));

    // Grades per month.
    var months = {}, order = [];
    picked.forEach(function (g) { var m = g.d.slice(0, 7); if (!months[m]) { months[m] = 0; order.push(m); } months[m]++; });
    var mItems = order.map(function (m) {
      var name = new Date(m + '-15').toLocaleDateString('it-CH', { month: 'short' });
      return { label: name, n: months[m], tip: '<b>' + new Date(m + '-15').toLocaleDateString('it-CH', { month: 'long', year: 'numeric' }) + '</b>: ' + months[m] + (months[m] === 1 ? ' voto' : ' voti') };
    });
    root.appendChild(card('Voti per mese', null, mItems.length ? barsV(mItems) : 'Nessun voto in questo periodo.'));
  }

  var ysel = document.getElementById('year');
  if (ysel) ysel.addEventListener('change', render);
  render();
})();
