/* TableDesk Ledger — pure data math. No DOM, testable in any JS engine. */
(function (root) {
  "use strict";

  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  function monthKey(dateStr) { return String(dateStr).slice(0, 7); }
  function dayOf(dateStr) { return parseInt(String(dateStr).slice(8, 10), 10); }

  function monthLabel(mk, short) {
    var y = mk.slice(0, 4), m = parseInt(mk.slice(5, 7), 10);
    var name = MONTH_NAMES[m - 1] || "?";
    return short ? name.slice(0, 3) + " " + y.slice(2) : name + " " + y;
  }

  function daysInMonth(mk) {
    var y = parseInt(mk.slice(0, 4), 10), m = parseInt(mk.slice(5, 7), 10);
    return new Date(y, m, 0).getDate();
  }

  function fmtMoney(n, compact) {
    var neg = n < 0; n = Math.abs(n);
    var s;
    if (compact && n >= 10000) {
      s = "$" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    } else {
      var fixed = n.toFixed(2).replace(/\.00$/, "");
      var parts = fixed.split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      s = "$" + parts.join(".");
    }
    return neg ? "-" + s : s;
  }

  function entriesForMonth(entries, mk) {
    return entries.filter(function (e) { return monthKey(e.date) === mk; });
  }

  function totals(entries) {
    var t = { income: 0, expense: 0 };
    entries.forEach(function (e) { t[e.type] += e.amount; });
    return t;
  }

  function categorySpend(entries, mk) {
    var out = {};
    entriesForMonth(entries, mk).forEach(function (e) {
      if (e.type !== "expense") return;
      out[e.category] = (out[e.category] || 0) + e.amount;
    });
    return out;
  }

  /* Cumulative spend per day of month: [{x: day, y: cumulative}], days 0..lastDay.
     Day 0 anchors the line at $0 before the month starts. */
  function cumulativeDaily(entries, mk, lastDay) {
    var perDay = {};
    entriesForMonth(entries, mk).forEach(function (e) {
      if (e.type !== "expense") return;
      var d = dayOf(e.date);
      perDay[d] = (perDay[d] || 0) + e.amount;
    });
    var pts = [{ x: 0, y: 0 }], run = 0;
    for (var d = 1; d <= lastDay; d++) {
      run += perDay[d] || 0;
      pts.push({ x: d, y: run });
    }
    return pts;
  }

  function paceLine(totalBudget, nDays) {
    var pts = [];
    for (var d = 0; d <= nDays; d++) pts.push({ x: d, y: totalBudget * d / nDays });
    return pts;
  }

  /* [{mk, income, expense}] sorted ascending, only months that have entries. */
  function monthlyTotals(entries) {
    var acc = {};
    entries.forEach(function (e) {
      var mk = monthKey(e.date);
      if (!acc[mk]) acc[mk] = { mk: mk, income: 0, expense: 0 };
      acc[mk][e.type] += e.amount;
    });
    return Object.keys(acc).sort().map(function (k) { return acc[k]; });
  }

  /* Daily running series across the full entry span.
     valueOf(entry) returns the signed delta an entry contributes.
     Returns {points: [{x: i, y}], labels: [dateStr per i]} with one point per
     calendar day from first entry to lastDate (inclusive). */
  function runningDaily(entries, startValue, valueOf, lastDate) {
    var dated = entries.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (dated.length === 0) return { points: [], labels: [] };
    var perDay = {};
    dated.forEach(function (e) {
      perDay[e.date] = (perDay[e.date] || 0) + valueOf(e);
    });
    var first = dated[0].date;
    var last = lastDate && lastDate > dated[dated.length - 1].date ? lastDate : dated[dated.length - 1].date;
    var points = [], labels = [];
    var cur = first, run = startValue, i = 0;
    while (cur <= last && i < 1200) {
      run += perDay[cur] || 0;
      points.push({ x: i, y: run });
      labels.push(cur);
      cur = nextDay(cur);
      i++;
    }
    return { points: points, labels: labels };
  }

  function nextDay(dateStr) {
    var y = parseInt(dateStr.slice(0, 4), 10),
        m = parseInt(dateStr.slice(5, 7), 10),
        d = parseInt(dateStr.slice(8, 10), 10);
    var dt = new Date(y, m - 1, d + 1);
    return pad4(dt.getFullYear()) + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function pad4(n) { return String(n); }

  /* Clean axis ticks: ~n values, rounded steps, always includes 0 when min >= 0. */
  function niceTicks(min, max, n) {
    if (min > 0) min = 0;
    if (max <= min) max = min + 1;
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log(span / n) / Math.LN10));
    var err = span / n / step;
    if (err >= 7.5) step *= 10;
    else if (err >= 3.5) step *= 5;
    else if (err >= 1.5) step *= 2;
    var ticks = [];
    var start = Math.ceil(min / step) * step;
    for (var v = start; v <= max + step * 0.001; v += step) {
      ticks.push(Math.round(v * 100) / 100);
    }
    return ticks;
  }

  root.TDLCalc = {
    monthKey: monthKey, dayOf: dayOf, monthLabel: monthLabel,
    daysInMonth: daysInMonth, fmtMoney: fmtMoney,
    entriesForMonth: entriesForMonth, totals: totals,
    categorySpend: categorySpend, cumulativeDaily: cumulativeDaily,
    paceLine: paceLine, monthlyTotals: monthlyTotals,
    runningDaily: runningDaily, nextDay: nextDay, niceTicks: niceTicks
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
