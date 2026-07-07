/* TableDesk Ledger — app logic. Data math lives in calc.js (TDLCalc). */
(function () {
  "use strict";
  var C = window.TDLCalc;

  /* Category order: most-used first (his call), fixed money colors per entity. */
  var CATEGORIES = [
    "Going Out/Entertainment", "Groceries", "Uber/Taxi", "Household Necessities",
    "Fitness", "Gifts / Charity", "Flights", "Other", "Housing", "Electric / Gas",
    "Water / Sewer / Trash", "Internet", "Savings", "Student Loan Payment"
  ];
  var INCOME_SOURCES = ["Alana", "Max", "Other"];

  var LS_CFG = "tdl.cfg", LS_CACHE = "tdl.cache", LS_QUEUE = "tdl.queue";

  var state = {
    cfg: loadLS(LS_CFG, null),
    cache: loadLS(LS_CACHE, { entries: [], budgets: {}, config: {}, fetchedAt: null }),
    queue: loadLS(LS_QUEUE, []),
    view: "log",
    entryType: "expense",
    category: CATEGORIES[0],
    source: INCOME_SOURCES[0],
    boardMonth: null,
    sending: false
  };

  function loadLS(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function saveLS(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function currentMK() { return todayStr().slice(0, 7); }

  function el(id) { return document.getElementById(id); }
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ---------------- API ---------------- */

  function apiGet(params) {
    var url = state.cfg.url + "?token=" + encodeURIComponent(state.cfg.token) + "&" + params;
    return withTimeout(fetch(url, { redirect: "follow" })).then(function (r) { return r.json(); });
  }
  function apiPost(body) {
    body.token = state.cfg.token;
    return withTimeout(fetch(state.cfg.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow"
    })).then(function (r) { return r.json(); });
  }
  function withTimeout(promise) {
    return Promise.race([promise, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error("timeout")); }, 20000);
    })]);
  }

  function flushQueue() {
    if (!state.cfg || state.queue.length === 0 || state.sending) return Promise.resolve();
    state.sending = true;
    var item = state.queue[0];
    return apiPost({ action: "add", entry: item }).then(function (res) {
      state.sending = false;
      if (res && res.ok) {
        state.queue.shift();
        saveLS(LS_QUEUE, state.queue);
        renderPending();
        return flushQueue();
      }
      if (res && res.error && res.error.indexOf("bad") === 0) {
        state.queue.shift(); // permanently rejected, drop it
        saveLS(LS_QUEUE, state.queue);
        toast("Entry rejected by server: " + res.error);
        renderPending();
      }
    }).catch(function () { state.sending = false; });
  }

  function fetchData(manual) {
    if (!state.cfg) return Promise.resolve();
    el("main").classList.add("loading");
    return flushQueue().then(function () {
      return apiGet("action=data");
    }).then(function (res) {
      if (!res || !res.ok) throw new Error(res && res.error || "bad response");
      state.cache = {
        entries: res.entries || [], budgets: res.budgets || {},
        config: res.config || {}, fetchedAt: new Date().toTimeString().slice(0, 5)
      };
      saveLS(LS_CACHE, state.cache);
      renderAll();
    }).catch(function (err) {
      if (manual) toast("Sync failed: " + err.message);
    }).then(function () {
      el("main").classList.remove("loading");
    });
  }

  /* Entries = server cache + still-queued locals (deduped by id). */
  function allEntries() {
    var ids = {};
    state.cache.entries.forEach(function (e) { ids[e.id] = true; });
    return state.cache.entries.concat(state.queue.filter(function (q) { return !ids[q.id]; })
      .map(function (q) {
        return { id: q.id, date: q.date, type: q.type, notes: q.notes, source: q.source || "",
                 category: q.type === "income" ? "Income" : q.category, amount: q.amount, imported: false };
      }));
  }
  function budgetTotal() {
    var t = 0, b = state.cache.budgets;
    Object.keys(b).forEach(function (k) { t += b[k]; });
    return t;
  }

  /* ---------------- toast / tooltip ---------------- */

  var toastTimer = null;
  function toast(msg) {
    var t = el("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  var tip = null;
  function tipShow(clientX, clientY, title, rows) {
    if (!tip) tip = el("tooltip");
    tip.textContent = "";
    var tt = make("div", "tt-title", title);
    tip.appendChild(tt);
    rows.forEach(function (r) {
      var row = make("div", "tt-row");
      var key = make("span", "tt-key");
      key.style.background = r.color;
      row.appendChild(key);
      row.appendChild(make("span", "tt-val", r.value));
      row.appendChild(make("span", "tt-name", r.name));
      tip.appendChild(row);
    });
    tip.hidden = false;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var x = Math.min(Math.max(8, clientX + 14), window.innerWidth - w - 8);
    var y = clientY - h - 14;
    if (y < 8) y = clientY + 18;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  function tipHide() { if (!tip) tip = el("tooltip"); tip.hidden = true; }

  /* ---------------- SVG chart engine ---------------- */

  var SVGNS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function legend(container, items, swatchKind) {
    var lg = make("div", "legend");
    items.forEach(function (it) {
      var li = make("div", "legend-item");
      var sw = make("span", "legend-swatch" + (swatchKind === "rect" ? " rect" : ""));
      sw.style.background = it.color;
      li.appendChild(sw);
      li.appendChild(make("span", null, it.name));
      lg.appendChild(li);
    });
    container.appendChild(lg);
  }

  /* opts: {series:[{name,color,points,stepped,marker,endLabel}], xTicks:[{x,label}],
            xLabelOf(x), yFmt(v), height} */
  function lineChart(container, opts) {
    container.textContent = "";
    if (opts.series.length > 1) {
      legend(container, opts.series.map(function (s) { return { name: s.name, color: s.color }; }));
    }
    var W = Math.max(280, container.clientWidth || 320);
    var H = opts.height || 210;
    var M = { l: 48, r: 14, t: 10, b: 24 };
    var pw = W - M.l - M.r, ph = H - M.t - M.b;

    var xs = [], ymax = 0;
    opts.series.forEach(function (s) {
      s.points.forEach(function (p) {
        if (xs.indexOf(p.x) === -1) xs.push(p.x);
        if (p.y > ymax) ymax = p.y;
      });
    });
    xs.sort(function (a, b) { return a - b; });
    if (xs.length === 0) { container.appendChild(make("p", "hint", "No data yet.")); return; }
    var xmin = xs[0], xmax = xs[xs.length - 1];
    if (xmax === xmin) xmax = xmin + 1;
    var yticks = C.niceTicks(0, ymax * 1.05 || 1, 4);
    var ytop = yticks[yticks.length - 1];
    if (ytop < ymax) ytop = ymax;

    function X(v) { return M.l + (v - xmin) / (xmax - xmin) * pw; }
    function Y(v) { return M.t + ph - (v / ytop) * ph; }

    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img" });
    var surface = cssVar("--surface"), gridC = cssVar("--grid"),
        baseC = cssVar("--baseline"), mutedC = cssVar("--muted"), inkC = cssVar("--ink");

    yticks.forEach(function (tv) {
      if (tv === 0) return;
      svg.appendChild(svgEl("line", { x1: M.l, x2: W - M.r, y1: Y(tv), y2: Y(tv), stroke: gridC, "stroke-width": 1 }));
      var lbl = svgEl("text", { x: M.l - 6, y: Y(tv) + 4, "text-anchor": "end", "font-size": 11, fill: mutedC });
      lbl.textContent = opts.yFmt(tv);
      svg.appendChild(lbl);
    });
    svg.appendChild(svgEl("line", { x1: M.l, x2: W - M.r, y1: Y(0), y2: Y(0), stroke: baseC, "stroke-width": 1 }));

    (opts.xTicks || []).forEach(function (t) {
      var lbl = svgEl("text", { x: X(t.x), y: H - 8, "text-anchor": "middle", "font-size": 11, fill: mutedC });
      lbl.textContent = t.label;
      svg.appendChild(lbl);
    });

    opts.series.forEach(function (s) {
      if (s.points.length === 0) return;
      var d = "M " + X(s.points[0].x) + " " + Y(s.points[0].y);
      for (var i = 1; i < s.points.length; i++) {
        var p = s.points[i];
        if (s.stepped) d += " H " + X(p.x) + " V " + Y(p.y);
        else d += " L " + X(p.x) + " " + Y(p.y);
      }
      svg.appendChild(svgEl("path", {
        d: d, fill: "none", stroke: s.color, "stroke-width": 2,
        "stroke-linejoin": "round", "stroke-linecap": "round",
        "stroke-dasharray": s.dashed ? "5 4" : "none"
      }));
      var last = s.points[s.points.length - 1];
      if (s.marker) {
        svg.appendChild(svgEl("circle", {
          cx: X(last.x), cy: Y(last.y), r: 4.5, fill: s.color, stroke: surface, "stroke-width": 2
        }));
      }
      if (s.endLabel) {
        var tx = X(last.x) - 8, anchor = "end";
        var ty = Y(last.y) - 9;
        if (ty < M.t + 10) ty = Y(last.y) + 16;
        var lab = svgEl("text", { x: tx, y: ty, "text-anchor": anchor, "font-size": 12, "font-weight": 600, fill: inkC });
        lab.textContent = opts.yFmt(last.y);
        svg.appendChild(lab);
      }
    });

    /* crosshair + tooltip */
    var cross = svgEl("line", { x1: 0, x2: 0, y1: M.t, y2: M.t + ph, stroke: baseC, "stroke-width": 1, visibility: "hidden" });
    svg.appendChild(cross);
    var overlay = svgEl("rect", { x: M.l, y: M.t, width: pw, height: ph, fill: "transparent" });
    svg.appendChild(overlay);

    var activeIdx = -1;
    function showAt(idx, clientX, clientY) {
      if (idx < 0 || idx >= xs.length) return;
      activeIdx = idx;
      var xv = xs[idx];
      cross.setAttribute("x1", X(xv));
      cross.setAttribute("x2", X(xv));
      cross.setAttribute("visibility", "visible");
      var rows = [];
      opts.series.forEach(function (s) {
        var pt = null;
        for (var i = 0; i < s.points.length; i++) if (s.points[i].x === xv) pt = s.points[i];
        if (pt) rows.push({ color: s.color, value: opts.yFmt(pt.y), name: s.name });
      });
      var rect = svg.getBoundingClientRect();
      var cx = clientX !== undefined ? clientX : rect.left + X(xv);
      var cy = clientY !== undefined ? clientY : rect.top + M.t + 20;
      tipShow(cx, cy, opts.xLabelOf(xv), rows);
    }
    function hide() { cross.setAttribute("visibility", "hidden"); tipHide(); activeIdx = -1; }

    overlay.addEventListener("pointermove", function (ev) {
      var rect = svg.getBoundingClientRect();
      var px = (ev.clientX - rect.left) * (W / rect.width);
      var best = 0, bd = Infinity;
      for (var i = 0; i < xs.length; i++) {
        var d = Math.abs(X(xs[i]) - px);
        if (d < bd) { bd = d; best = i; }
      }
      showAt(best, ev.clientX, ev.clientY);
    });
    overlay.addEventListener("pointerleave", hide);
    container.tabIndex = 0;
    container.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowRight") { showAt(Math.min(xs.length - 1, activeIdx < 0 ? xs.length - 1 : activeIdx + 1)); ev.preventDefault(); }
      else if (ev.key === "ArrowLeft") { showAt(Math.max(0, activeIdx < 0 ? xs.length - 1 : activeIdx - 1)); ev.preventDefault(); }
      else if (ev.key === "Escape") hide();
    });
    container.addEventListener("blur", hide);

    container.appendChild(svg);
  }

  /* opts: {groups:[{label, tip, values:[v,...]}], series:[{name,color}], yFmt} */
  function columnChart(container, opts) {
    container.textContent = "";
    legend(container, opts.series, "rect");
    var W = Math.max(280, container.clientWidth || 320);
    var H = 200;
    var M = { l: 48, r: 10, t: 10, b: 24 };
    var pw = W - M.l - M.r, ph = H - M.t - M.b;
    var ymax = 0;
    opts.groups.forEach(function (g) { g.values.forEach(function (v) { if (v > ymax) ymax = v; }); });
    var yticks = C.niceTicks(0, ymax * 1.05 || 1, 4);
    var ytop = yticks[yticks.length - 1];
    if (ytop < ymax) ytop = ymax;
    function Y(v) { return M.t + ph - (v / ytop) * ph; }

    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img" });
    var gridC = cssVar("--grid"), baseC = cssVar("--baseline"), mutedC = cssVar("--muted");
    yticks.forEach(function (tv) {
      if (tv === 0) return;
      svg.appendChild(svgEl("line", { x1: M.l, x2: W - M.r, y1: Y(tv), y2: Y(tv), stroke: gridC, "stroke-width": 1 }));
      var lbl = svgEl("text", { x: M.l - 6, y: Y(tv) + 4, "text-anchor": "end", "font-size": 11, fill: mutedC });
      lbl.textContent = opts.yFmt(tv);
      svg.appendChild(lbl);
    });

    var band = pw / opts.groups.length;
    var n = opts.series.length;
    var barW = Math.min(24, (band - 8 - 2 * (n - 1)) / n);

    opts.groups.forEach(function (g, gi) {
      var total = n * barW + 2 * (n - 1);
      var x0 = M.l + gi * band + (band - total) / 2;
      var rects = [];
      g.values.forEach(function (v, si) {
        var x = x0 + si * (barW + 2);
        var y = Y(v), h = Y(0) - y;
        var r = Math.min(4, h, barW / 2);
        var d = "M " + x + " " + Y(0) +
                " L " + x + " " + (y + r) +
                " Q " + x + " " + y + " " + (x + r) + " " + y +
                " L " + (x + barW - r) + " " + y +
                " Q " + (x + barW) + " " + y + " " + (x + barW) + " " + (y + r) +
                " L " + (x + barW) + " " + Y(0) + " Z";
        var path = svgEl("path", { d: d, fill: opts.series[si].color });
        rects.push(path);
        svg.appendChild(path);
      });
      var lbl = svgEl("text", { x: M.l + gi * band + band / 2, y: H - 8, "text-anchor": "middle", "font-size": 11, fill: mutedC });
      lbl.textContent = g.label;
      svg.appendChild(lbl);

      var hit = svgEl("rect", { x: M.l + gi * band, y: M.t, width: band, height: ph, fill: "transparent" });
      hit.addEventListener("pointermove", function (ev) {
        rects.forEach(function (rc) { rc.setAttribute("opacity", "0.8"); });
        tipShow(ev.clientX, ev.clientY, g.tip, g.values.map(function (v, si) {
          return { color: opts.series[si].color, value: opts.yFmt(v), name: opts.series[si].name };
        }));
      });
      hit.addEventListener("pointerleave", function () {
        rects.forEach(function (rc) { rc.removeAttribute("opacity"); });
        tipHide();
      });
      svg.appendChild(hit);
    });
    svg.appendChild(svgEl("line", { x1: M.l, x2: W - M.r, y1: Y(0), y2: Y(0), stroke: baseC, "stroke-width": 1 }));
    container.appendChild(svg);
  }

  /* table twin */
  function buildTable(containerId, headers, rows) {
    var host = el(containerId);
    host.textContent = "";
    var table = make("table");
    var thr = make("tr");
    headers.forEach(function (h) { thr.appendChild(make("th", null, h)); });
    var thead = make("thead"); thead.appendChild(thr); table.appendChild(thead);
    var tbody = make("tbody");
    rows.forEach(function (r) {
      var tr = make("tr");
      r.forEach(function (cell) { tr.appendChild(make("td", null, cell)); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(table);
  }

  /* ---------------- LOG view ---------------- */

  function renderChips() {
    var view = el("view-log");
    view.classList.toggle("mode-expense", state.entryType === "expense");
    view.classList.toggle("mode-income", state.entryType === "income");
    el("in-notes").placeholder = state.entryType === "expense" ? "taco night" : "july paycheck";
    var grid = el("chip-grid");
    grid.textContent = "";
    var items = state.entryType === "expense" ? CATEGORIES : INCOME_SOURCES;
    var active = state.entryType === "expense" ? state.category : state.source;
    items.forEach(function (name) {
      var b = make("button", "chip" + (name === active ? " is-active" : ""), name);
      b.type = "button";
      b.addEventListener("click", function () {
        if (state.entryType === "expense") state.category = name;
        else state.source = name;
        renderChips();
        renderMtdNote();
      });
      grid.appendChild(b);
    });
  }

  function renderMtdNote() {
    var box = el("mtd-note");
    var mk = currentMK();
    var entries = allEntries();
    box.hidden = false;
    if (state.entryType === "income") {
      var inc = C.totals(C.entriesForMonth(entries, mk)).income;
      el("mtd-label").textContent = "Income · " + C.monthLabel(mk);
      el("mtd-pct").textContent = "";
      el("mtd-sub").textContent = C.fmtMoney(inc) + " logged so far this month";
      el("mtd-fill").parentElement.hidden = true;
      return;
    }
    el("mtd-fill").parentElement.hidden = false;
    var cat = state.category;
    var spent = C.categorySpend(entries, mk)[cat] || 0;
    var budget = state.cache.budgets[cat] || 0;
    el("mtd-label").textContent = cat + " · " + C.monthLabel(mk);
    if (budget > 0) {
      var pct = spent / budget * 100;
      var exact = isExact(spent, budget);
      el("mtd-pct").textContent = Math.round(pct) + "%";
      el("mtd-sub").textContent = C.fmtMoney(spent) + " of " + C.fmtMoney(budget) +
        (exact ? " · right on budget"
          : pct <= 100 ? " · " + C.fmtMoney(budget - spent) + " left"
          : " · " + C.fmtMoney(spent - budget) + " over");
      setMeter(el("mtd-fill"), pct, exact);
    } else {
      el("mtd-pct").textContent = "";
      el("mtd-sub").textContent = C.fmtMoney(spent) + " spent · no budget set";
      setMeter(el("mtd-fill"), spent > 0 ? 100 : 0, false);
    }
  }

  /* exact = actual matches budget to the cent: green, never red.
     Red is reserved for strictly over budget. */
  function setMeter(fill, pct, exact) {
    fill.style.width = Math.min(100, pct) + "%";
    fill.classList.toggle("done", !!exact);
    fill.classList.toggle("warn", !exact && pct >= 85 && pct <= 100);
    fill.classList.toggle("over", !exact && pct > 100);
  }
  function isExact(spent, budget) {
    return budget > 0 && Math.abs(spent - budget) < 0.005;
  }

  function parseAmount(raw) {
    var s = String(raw).replace(/[$,\s]/g, "");
    if (!/^\d*\.?\d{0,2}$/.test(s) || s === "" || s === ".") return null;
    var n = parseFloat(s);
    if (!isFinite(n) || n <= 0 || n > 5000000) return null;
    return Math.round(n * 100) / 100;
  }

  function saveEntry() {
    if (!state.cfg) { openConfig("Connect your sheet first."); return; }
    var amount = parseAmount(el("in-amount").value);
    if (amount === null) { toast("Enter a valid amount"); el("in-amount").focus(); return; }
    var date = el("in-date").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("Pick a date"); return; }
    var entry = {
      id: (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.floor(Math.random() * 1e6)),
      type: state.entryType,
      category: state.entryType === "expense" ? state.category : "Income",
      source: state.entryType === "income" ? state.source : "",
      amount: amount,
      date: date,
      notes: el("in-notes").value.trim()
    };
    state.queue.push(entry);
    saveLS(LS_QUEUE, state.queue);
    renderPending();
    el("in-amount").value = "";
    el("in-notes").value = "";
    renderMtdNote();
    toast((state.entryType === "expense" ? "Logged " : "Income ") + C.fmtMoney(amount) + " ✓");
    flushQueue().then(function () { renderPending(); });
  }

  function renderPending() {
    var b = el("pending-badge");
    if (state.queue.length > 0) {
      b.hidden = false;
      b.textContent = state.queue.length + " queued";
    } else b.hidden = true;
  }

  /* ---------------- BOARD view ---------------- */

  function monthOptions() {
    var entries = allEntries();
    var set = {};
    entries.forEach(function (e) { set[C.monthKey(e.date)] = true; });
    set[currentMK()] = true;
    return Object.keys(set).sort().reverse();
  }

  function renderBoard() {
    var entries = allEntries();
    var mk = state.boardMonth || currentMK();

    var sel = el("sel-month");
    sel.textContent = "";
    monthOptions().forEach(function (m) {
      var o = make("option", null, C.monthLabel(m));
      o.value = m;
      if (m === mk) o.selected = true;
      sel.appendChild(o);
    });
    el("board-updated").textContent = state.cache.fetchedAt ? "synced " + state.cache.fetchedAt : "not synced yet";

    var monthEntries = C.entriesForMonth(entries, mk);
    var t = C.totals(monthEntries);
    var bTotal = budgetTotal();
    var days = C.daysInMonth(mk);
    var isCurrent = mk === currentMK();
    var today = parseInt(todayStr().slice(8), 10);

    /* hero */
    el("hero-label").textContent = "Spent in " + C.monthLabel(mk);
    el("hero-value").textContent = C.fmtMoney(t.expense);
    el("hero-sub").textContent = "of " + C.fmtMoney(bTotal) + " budgeted";
    var pctSpent = bTotal > 0 ? t.expense / bTotal * 100 : 0;
    setMeter(el("hero-fill"), pctSpent, isExact(t.expense, bTotal));
    var chip = el("hero-delta");
    var ref = isCurrent ? bTotal * today / days : bTotal;
    var refName = isCurrent ? "pace" : "budget";
    var diff = ref - t.expense;
    chip.textContent = "";
    chip.className = "delta-chip " + (diff >= 0 ? "good" : "bad");
    chip.textContent = diff >= 0
      ? C.fmtMoney(diff) + " under " + refName
      : "▲ " + C.fmtMoney(-diff) + " over " + refName;

    /* tiles */
    var all = C.totals(entries);
    var startCash = Number(state.cache.config.starting_cash) || 0;
    var cash = startCash + all.income - all.expense;
    el("tile-cash").textContent = C.fmtMoney(cash, true);
    el("tile-cash-sub").textContent = "all time, started at " + C.fmtMoney(startCash, true);
    el("tile-income").textContent = C.fmtMoney(t.income, true);
    el("tile-income-sub").textContent = C.monthLabel(mk, true);
    var savedMonth = C.categorySpend(entries, mk)["Savings"] || 0;
    var savedAll = 0;
    entries.forEach(function (e) { if (e.type === "expense" && e.category === "Savings") savedAll += e.amount; });
    el("tile-savings").textContent = C.fmtMoney(savedMonth, true);
    el("tile-savings-sub").textContent = "stash " + C.fmtMoney(savedAll, true) + " all time";
    var left = bTotal - t.expense;
    el("tile-left").textContent = C.fmtMoney(left, true);
    el("tile-left-sub").textContent = left >= 0 ? "still in the " + C.monthLabel(mk, true) + " budget" : "over budget";

    renderCumulative(entries, mk, bTotal, days, isCurrent, today, t.expense);
    renderCategories(entries, mk);
    renderMonths(entries);
    renderCashAndStash(entries, startCash);
    el("empty-state").hidden = !!state.cfg;
  }

  function renderCumulative(entries, mk, bTotal, days, isCurrent, today, spent) {
    var cum = C.cumulativeDaily(entries, mk, days);
    var actual = isCurrent ? cum.slice(0, today + 1) : cum;
    var pace = C.paceLine(bTotal, days);
    var expenseC = cssVar("--s-expense"), paceC = cssVar("--pace");
    el("sub-cumulative").textContent = C.fmtMoney(spent) + " spent through " +
      (isCurrent ? "day " + today : "month end") + " · budget " + C.fmtMoney(bTotal);
    var ticks = [1, 8, 15, 22, days].map(function (d) {
      return { x: d, label: C.monthLabel(mk, true).slice(0, 3) + " " + d };
    });
    lineChart(el("chart-cumulative"), {
      series: [
        { name: "Spent", color: expenseC, points: actual, stepped: true, marker: true, endLabel: true },
        { name: "Budget pace", color: paceC, points: pace, dashed: true }
      ],
      xTicks: ticks,
      xLabelOf: function (x) { return x === 0 ? "start" : C.monthLabel(mk, true).slice(0, 3) + " " + x; },
      yFmt: function (v) { return C.fmtMoney(v, true); }
    });
    buildTable("table-cumulative", ["Day", "Spent", "Pace"], cum.filter(function (p, i) {
      return i > 0 && (i % 7 === 0 || i === cum.length - 1 || (isCurrent && p.x === today));
    }).map(function (p) {
      return [String(p.x), C.fmtMoney(p.y), C.fmtMoney(pace[p.x].y)];
    }));
  }

  function renderCategories(entries, mk) {
    var spend = C.categorySpend(entries, mk);
    var host = el("chart-categories");
    host.textContent = "";
    var totalSpent = 0;
    Object.keys(spend).forEach(function (k) { totalSpent += spend[k]; });
    el("sub-categories").textContent = C.monthLabel(mk) + " · " + C.fmtMoney(totalSpent) + " across " +
      Object.keys(spend).length + " categories";
    var rows = CATEGORIES.map(function (cat) {
      return { cat: cat, spent: spend[cat] || 0, budget: state.cache.budgets[cat] || 0 };
    }).sort(function (a, b) { return b.spent - a.spent; });
    rows.forEach(function (r) {
      var row = make("div", "cat-row");
      var top = make("div", "cat-top");
      var name = make("span", "cat-name" + (r.spent === 0 ? " dim" : ""), r.cat);
      var pct = r.budget > 0 ? r.spent / r.budget * 100 : (r.spent > 0 ? 100 : 0);
      var exact = isExact(r.spent, r.budget);
      if (exact) name.appendChild(make("span", "cat-flag good", " ✓ on budget"));
      else if (pct > 100 && r.budget > 0) name.appendChild(make("span", "cat-flag over", " ▲ over"));
      else if (pct >= 85 && r.budget > 0) name.appendChild(make("span", "cat-flag warn", " near cap"));
      var amt = make("span", "cat-amt",
        C.fmtMoney(r.spent) + (r.budget > 0 ? " of " + C.fmtMoney(r.budget) : " · no budget"));
      top.appendChild(name); top.appendChild(amt);
      var meter = make("div", "meter");
      var fill = make("div", "meter-fill");
      meter.appendChild(fill);
      row.appendChild(top); row.appendChild(meter);
      host.appendChild(row);
      setMeter(fill, pct, exact);
    });
  }

  function renderMonths(entries) {
    var mt = C.monthlyTotals(entries);
    var incomeC = cssVar("--s-income"), expenseC = cssVar("--s-expense");
    columnChart(el("chart-months"), {
      groups: mt.map(function (m) {
        return { label: C.monthLabel(m.mk, true), tip: C.monthLabel(m.mk), values: [m.income, m.expense] };
      }),
      series: [{ name: "Income", color: incomeC }, { name: "Expenses", color: expenseC }],
      yFmt: function (v) { return C.fmtMoney(v, true); }
    });
    buildTable("table-months", ["Month", "Income", "Expenses", "Net"], mt.map(function (m) {
      return [C.monthLabel(m.mk), C.fmtMoney(m.income), C.fmtMoney(m.expense), C.fmtMoney(m.income - m.expense)];
    }));
  }

  function renderCashAndStash(entries, startCash) {
    var today = todayStr();
    var cash = C.runningDaily(entries, startCash, function (e) {
      return e.type === "income" ? e.amount : -e.amount;
    }, today);
    var stash = C.runningDaily(entries, 0, function (e) {
      return e.type === "expense" && e.category === "Savings" ? e.amount : 0;
    }, today);
    var cashC = cssVar("--s-cash"), savC = cssVar("--s-savings");

    [{ id: "chart-cash", tId: "table-cash", data: cash, color: cashC, name: "Cash" },
     { id: "chart-stash", tId: "table-stash", data: stash, color: savC, name: "Savings" }]
      .forEach(function (spec) {
        var ticks = [];
        spec.data.labels.forEach(function (d, i) {
          if (d.slice(8) === "01") ticks.push({ x: i, label: C.monthLabel(d.slice(0, 7), true) });
        });
        if (ticks.length === 0 && spec.data.labels.length > 0) {
          ticks.push({ x: 0, label: spec.data.labels[0].slice(5) });
        }
        lineChart(el(spec.id), {
          series: [{ name: spec.name, color: spec.color, points: spec.data.points, marker: true, endLabel: true }],
          xTicks: ticks,
          xLabelOf: function (x) { return spec.data.labels[x] || ""; },
          yFmt: function (v) { return C.fmtMoney(v, true); },
          height: 190
        });
        /* table: one row per day the value changed */
        var rows = [], prev = null;
        spec.data.points.forEach(function (p, i) {
          if (prev === null || p.y !== prev) rows.push([spec.data.labels[i], C.fmtMoney(p.y)]);
          prev = p.y;
        });
        buildTable(spec.tId, ["Date", spec.name], rows);
      });
  }

  /* ---------------- HISTORY view ---------------- */

  function renderHistory() {
    var host = el("history-list");
    host.textContent = "";
    var entries = allEntries().slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
    if (entries.length === 0) {
      host.appendChild(make("p", "hint", "Nothing logged yet."));
      return;
    }
    var byDay = {};
    entries.forEach(function (e) {
      if (!byDay[e.date]) byDay[e.date] = [];
      byDay[e.date].push(e);
    });
    Object.keys(byDay).sort().reverse().forEach(function (d) {
      var group = make("div", "day-group");
      group.appendChild(make("div", "day-head", C.monthLabel(C.monthKey(d), true) + " " + parseInt(d.slice(8), 10)));
      byDay[d].forEach(function (e) {
        var row = make("div", "entry-row");
        var main = make("div", "entry-main");
        var catLine = make("div", "entry-cat", e.type === "income" ? "Income" + (e.source ? " · " + e.source : "") : e.category);
        main.appendChild(catLine);
        if (e.notes) main.appendChild(make("div", "entry-notes", e.notes));
        row.appendChild(main);
        var amt = make("span", "entry-amt" + (e.type === "income" ? " income" : ""),
          (e.type === "income" ? "+" : "") + C.fmtMoney(e.amount));
        row.appendChild(amt);
        if (e.imported) {
          row.appendChild(make("span", "entry-tag", "in Excel"));
        } else {
          var del = make("button", "entry-del", "×");
          del.type = "button";
          del.setAttribute("aria-label", "Delete entry");
          del.addEventListener("click", function () { deleteEntry(e); });
          row.appendChild(del);
        }
        group.appendChild(row);
      });
      host.appendChild(group);
    });
  }

  function deleteEntry(e) {
    if (!confirm("Delete " + (e.type === "income" ? "income" : e.category) + " " + C.fmtMoney(e.amount) + "?")) return;
    var qi = -1;
    state.queue.forEach(function (q, i) { if (q.id === e.id) qi = i; });
    if (qi >= 0) {
      state.queue.splice(qi, 1);
      saveLS(LS_QUEUE, state.queue);
      renderPending(); renderHistory();
      return;
    }
    apiPost({ action: "delete", id: e.id }).then(function (res) {
      if (res && res.ok) {
        state.cache.entries = state.cache.entries.filter(function (x) { return x.id !== e.id; });
        saveLS(LS_CACHE, state.cache);
        renderHistory();
        toast("Deleted");
      } else toast("Delete failed: " + (res && res.error || "offline"));
    }).catch(function () { toast("Delete failed: offline"); });
  }

  /* ---------------- config ---------------- */

  function openConfig(msg) {
    el("cfg-url").value = state.cfg ? state.cfg.url : "";
    el("cfg-token").value = state.cfg ? state.cfg.token : "";
    el("cfg-status").textContent = msg || "";
    el("config-dialog").showModal();
  }

  function testConnection() {
    var url = el("cfg-url").value.trim(), token = el("cfg-token").value.trim();
    var status = el("cfg-status");
    if (!url || !token) { status.textContent = "Fill in both fields first."; return; }
    status.textContent = "Testing…";
    withTimeout(fetch(url + "?token=" + encodeURIComponent(token) + "&action=ping", { redirect: "follow" }))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        status.textContent = res && res.ok ? "Connected ✓" : "Reached the server but: " + (res && res.error);
      })
      .catch(function (err) { status.textContent = "Could not reach it: " + err.message; });
  }

  function saveConfig() {
    var url = el("cfg-url").value.trim(), token = el("cfg-token").value.trim();
    if (!url || !token) return;
    state.cfg = { url: url, token: token };
    saveLS(LS_CFG, state.cfg);
    el("log-hint").hidden = true;
    fetchData(true);
  }

  /* ---------------- wiring ---------------- */

  function switchView(name) {
    state.view = name;
    ["log", "board", "history"].forEach(function (v) {
      el("view-" + v).hidden = v !== name;
    });
    document.querySelectorAll(".tab").forEach(function (tb) {
      tb.classList.toggle("is-active", tb.dataset.view === name);
    });
    if (name === "board") renderBoard();
    if (name === "history") renderHistory();
    el("empty-state").hidden = !!state.cfg || name !== "board";
  }

  function renderAll() {
    renderChips();
    renderMtdNote();
    renderPending();
    if (state.view === "board") renderBoard();
    if (state.view === "history") renderHistory();
  }

  /* Dev preview: ?demo=1 fills the view with sample data (memory only, never saved). */
  function seedDemo() {
    var entries = [];
    var cats = [["Groceries", 4, 65], ["Going Out/Entertainment", 6, 80], ["Uber/Taxi", 5, 14],
                ["Household Necessities", 2, 40], ["Fitness", 1, 189], ["Housing", 1, 3827],
                ["Student Loan Payment", 1, 186.33], ["Savings", 1, 1500], ["Internet", 1, 75]];
    ["2026-05", "2026-06", "2026-07"].forEach(function (mk, mi) {
      cats.forEach(function (c, ci) {
        for (var i = 0; i < c[1]; i++) {
          var day = 1 + ((ci * 5 + i * 6 + mi) % (mi === 2 ? 6 : 27));
          entries.push({ id: mk + c[0] + i, date: mk + "-" + (day < 10 ? "0" : "") + day,
            type: "expense", category: c[0], amount: c[2] * (0.7 + 0.6 * ((i + ci) % 3) / 2),
            notes: i === 0 ? "sample" : "", source: "", imported: mi < 2 });
        }
      });
      entries.push({ id: mk + "inc1", date: mk + "-05", type: "income", category: "Income", amount: 4858, notes: "", source: "Max", imported: false });
      entries.push({ id: mk + "inc2", date: mk + "-12", type: "income", category: "Income", amount: 5080, notes: "", source: "Alana", imported: false });
    });
    state.cache = {
      entries: entries,
      budgets: { "Going Out/Entertainment": 2000, "Groceries": 600, "Uber/Taxi": 100,
        "Household Necessities": 100, "Fitness": 600, "Gifts / Charity": 100, "Flights": 1000,
        "Other": 250, "Housing": 3827, "Electric / Gas": 200, "Water / Sewer / Trash": 0,
        "Internet": 75, "Savings": 1500, "Student Loan Payment": 186.33 },
      config: { starting_cash: 760 },
      fetchedAt: "demo"
    };
    state.cfg = { url: "demo", token: "demo" };
  }

  /* Keep the date field and MTD math on today's date across suspend/resume:
     iOS freezes the PWA for days; on wake, roll the default date forward unless
     the user picked a date by hand. */
  var lastDefaultDate = null;
  function refreshToday() {
    var t = todayStr();
    if (el("in-date").value === lastDefaultDate) el("in-date").value = t;
    if (t !== lastDefaultDate) {
      lastDefaultDate = t;
      renderMtdNote();
      if (state.view === "board") renderBoard();
    }
  }

  function init() {
    if (location.search.indexOf("demo=1") !== -1) seedDemo();
    lastDefaultDate = todayStr();
    el("in-date").value = lastDefaultDate;

    document.querySelectorAll(".seg-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        state.entryType = b.dataset.type;
        document.querySelectorAll(".seg-btn").forEach(function (x) {
          x.classList.toggle("is-active", x === b);
        });
        renderChips();
        renderMtdNote();
      });
    });
    el("btn-save").addEventListener("click", saveEntry);
    el("btn-config").addEventListener("click", function () { openConfig(); });
    el("btn-refresh").addEventListener("click", function () { fetchData(true); });
    el("cfg-test").addEventListener("click", testConnection);
    el("cfg-save").addEventListener("click", saveConfig);
    el("sel-month").addEventListener("change", function () {
      state.boardMonth = el("sel-month").value;
      renderBoard();
    });
    document.querySelectorAll(".tab").forEach(function (tb) {
      tb.addEventListener("click", function () { switchView(tb.dataset.view); });
    });
    document.querySelectorAll(".tablebtn").forEach(function (tb) {
      tb.addEventListener("click", function () {
        var target = el("table-" + tb.dataset.table);
        var open = target.hidden;
        target.hidden = !open;
        tb.setAttribute("aria-pressed", String(open));
      });
    });

    window.addEventListener("online", function () { flushQueue().then(renderPending); });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) { refreshToday(); flushQueue().then(renderPending); }
    });
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (state.view === "board") renderBoard(); }, 200);
    });
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
        if (state.view === "board") renderBoard();
      });
    }

    renderAll();
    if (!state.cfg) {
      el("log-hint").hidden = false;
      el("log-hint").textContent = "Not connected yet. Tap the gear (top right) and paste your web app URL and token.";
    } else {
      fetchData(false);
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  init();
})();
