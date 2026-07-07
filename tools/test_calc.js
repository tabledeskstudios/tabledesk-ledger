/* calc.js unit tests — run with macOS JavaScriptCore:
   jsc calc.js tools/test_calc.js */
var C = globalThis.TDLCalc;
var fails = 0, count = 0;
function eq(got, want, name) {
  count++;
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; print("FAIL " + name + "\n  got  " + g + "\n  want " + w); }
}

var E = [
  { id: "1", date: "2026-07-02", type: "expense", category: "Groceries", amount: 50, imported: false },
  { id: "2", date: "2026-07-02", type: "expense", category: "Groceries", amount: 25.5, imported: false },
  { id: "3", date: "2026-07-05", type: "expense", category: "Savings", amount: 500, imported: false },
  { id: "4", date: "2026-07-10", type: "income", category: "Income", amount: 3000, source: "Max", imported: false },
  { id: "5", date: "2026-08-01", type: "expense", category: "Flights", amount: 400, imported: false },
  { id: "6", date: "2026-08-03", type: "income", category: "Income", amount: 1000, source: "Alana", imported: false }
];

eq(C.monthKey("2026-07-02"), "2026-07", "monthKey");
eq(C.dayOf("2026-07-02"), 2, "dayOf");
eq(C.monthLabel("2026-07"), "July 2026", "monthLabel long");
eq(C.monthLabel("2026-07", true), "Jul 26", "monthLabel short");
eq(C.daysInMonth("2026-02"), 28, "daysInMonth feb");
eq(C.daysInMonth("2028-02"), 29, "daysInMonth leap");
eq(C.daysInMonth("2026-07"), 31, "daysInMonth jul");

eq(C.fmtMoney(1234.5), "$1,234.50", "fmtMoney cents");
eq(C.fmtMoney(1234567), "$1,234,567", "fmtMoney big whole");
eq(C.fmtMoney(0), "$0", "fmtMoney zero");
eq(C.fmtMoney(-42.25), "-$42.25", "fmtMoney negative");
eq(C.fmtMoney(15250, true), "$15.3K", "fmtMoney compact");
eq(C.fmtMoney(9000, true), "$9,000", "fmtMoney compact under 10k");

eq(C.entriesForMonth(E, "2026-07").length, 4, "entriesForMonth");
eq(C.totals(C.entriesForMonth(E, "2026-07")), { income: 3000, expense: 575.5 }, "totals july");
eq(C.categorySpend(E, "2026-07"), { Groceries: 75.5, Savings: 500 }, "categorySpend");

var cum = C.cumulativeDaily(E, "2026-07", 31);
eq(cum.length, 32, "cumulative len (day 0..31)");
eq(cum[0], { x: 0, y: 0 }, "cumulative day0");
eq(cum[2], { x: 2, y: 75.5 }, "cumulative day2");
eq(cum[4], { x: 4, y: 75.5 }, "cumulative day4 flat");
eq(cum[5], { x: 5, y: 575.5 }, "cumulative day5");
eq(cum[31], { x: 31, y: 575.5 }, "cumulative day31");

var pace = C.paceLine(3100, 31);
eq(pace[0].y, 0, "pace day0");
eq(pace[31].y, 3100, "pace last");
eq(pace[15].y, 1500, "pace mid");

eq(C.monthlyTotals(E), [
  { mk: "2026-07", income: 3000, expense: 575.5 },
  { mk: "2026-08", income: 1000, expense: 400 }
], "monthlyTotals");

var cash = C.runningDaily(E, 760, function (e) { return e.type === "income" ? e.amount : -e.amount; }, "2026-08-04");
eq(cash.labels[0], "2026-07-02", "runningDaily first label");
eq(cash.labels[cash.labels.length - 1], "2026-08-04", "runningDaily extends to lastDate");
eq(cash.points[0].y, 760 - 75.5, "runningDaily day1 value");
eq(cash.points[cash.points.length - 1].y, 760 - 75.5 - 500 + 3000 - 400 + 1000, "runningDaily final value");
eq(cash.labels[30], "2026-08-01", "runningDaily crosses month");

var stash = C.runningDaily(E, 0, function (e) {
  return e.type === "expense" && e.category === "Savings" ? e.amount : 0;
}, "2026-08-04");
eq(stash.points[stash.points.length - 1].y, 500, "stash final");

eq(C.nextDay("2026-07-31"), "2026-08-01", "nextDay month roll");
eq(C.nextDay("2026-12-31"), "2027-01-01", "nextDay year roll");
eq(C.nextDay("2028-02-28"), "2028-02-29", "nextDay leap");

var t1 = C.niceTicks(0, 9338, 4);
eq(t1[0], 0, "ticks start 0");
eq(t1[t1.length - 1] >= 8000, true, "ticks reach high");
var clean = t1.every(function (v) { return v % 2000 === 0 || v % 2500 === 0 || v % 1000 === 0; });
eq(clean, true, "ticks are round");
var t2 = C.niceTicks(0, 87, 4);
eq(t2.indexOf(20) !== -1 || t2.indexOf(25) !== -1, true, "small ticks sane");

/* empty data safety */
eq(C.runningDaily([], 0, function () { return 0; }, "2026-07-01"), { points: [], labels: [] }, "runningDaily empty");
eq(C.monthlyTotals([]), [], "monthlyTotals empty");
eq(C.cumulativeDaily([], "2026-07", 31)[31], { x: 31, y: 0 }, "cumulative empty month");

if (fails === 0) print("ALL " + count + " TESTS PASS");
else { print(fails + "/" + count + " FAILED"); quit(1); }
