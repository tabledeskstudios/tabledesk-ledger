/**
 * TableDesk Ledger backend (Google Apps Script).
 *
 * Setup (one time):
 *   1. Go to script.new, paste this whole file over the default code.
 *   2. Replace TOKEN below with your secret (the app setup screen needs the same value).
 *   3. Run setup() once from the editor toolbar and grant permissions.
 *      The execution log prints the URL of the "TableDesk Ledger Data" spreadsheet.
 *   4. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *      Copy the /exec URL into the app's setup screen.
 *
 * The token gate keeps strangers out even if the URL leaks. Rotate by changing
 * TOKEN here, hitting Deploy > Manage deployments > Edit > New version, and
 * updating the app's setup screen.
 */

var TOKEN = 'PASTE_YOUR_TOKEN_HERE';

var CATEGORIES = [
  'Going Out/Entertainment', 'Groceries', 'Uber/Taxi', 'Household Necessities',
  'Fitness', 'Gifts / Charity', 'Flights', 'Other', 'Housing', 'Electric / Gas',
  'Water / Sewer / Trash', 'Internet', 'Savings', 'Student Loan Payment'
];

// Default monthly budgets, editable any time in the Budgets tab of the data sheet.
var DEFAULT_BUDGETS = {
  'Going Out/Entertainment': 2000, 'Groceries': 600, 'Uber/Taxi': 100,
  'Household Necessities': 100, 'Fitness': 600, 'Gifts / Charity': 100,
  'Flights': 1000, 'Other': 250, 'Housing': 3827, 'Electric / Gas': 200,
  'Water / Sewer / Trash': 0, 'Internet': 75, 'Savings': 1500,
  'Student Loan Payment': 186.33
};

var ENTRY_HEADER = ['id', 'ts', 'date', 'type', 'category', 'amount', 'notes', 'source', 'imported'];

function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  var ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('TableDesk Ledger Data');
    props.setProperty('SHEET_ID', ss.getId());
  }
  var entries = ss.getSheetByName('Entries') || ss.insertSheet('Entries');
  if (entries.getLastRow() === 0) {
    entries.appendRow(ENTRY_HEADER);
    entries.setFrozenRows(1);
  }
  // keep dates as plain text so Sheets never coerces them into Date cells
  entries.getRange(1, 3, entries.getMaxRows(), 1).setNumberFormat('@');
  var budgets = ss.getSheetByName('Budgets') || ss.insertSheet('Budgets');
  if (budgets.getLastRow() === 0) {
    budgets.appendRow(['category', 'monthly_budget']);
    CATEGORIES.forEach(function (c) { budgets.appendRow([c, DEFAULT_BUDGETS[c]]); });
    budgets.setFrozenRows(1);
  }
  var config = ss.getSheetByName('Config') || ss.insertSheet('Config');
  if (config.getLastRow() === 0) {
    config.appendRow(['key', 'value', 'note']);
    config.appendRow(['starting_cash', 760, 'Cash on hand before the first app entry. Edit me.']);
    config.setFrozenRows(1);
  }
  var extra = ss.getSheetByName('Sheet1');
  if (extra && ss.getSheets().length > 1) ss.deleteSheet(extra);
  Logger.log('Data spreadsheet ready: ' + ss.getUrl());
}

function sheet_(name) {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Run setup() once from the editor first.');
  return SpreadsheetApp.openById(id).getSheetByName(name);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function isoDate_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v);
}

function readAll_() {
  var sh = sheet_('Entries');
  var rows = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (r[0] === '') continue;
    out.push({
      id: String(r[0]), ts: String(r[1]), date: isoDate_(r[2]), type: String(r[3]),
      category: String(r[4]), amount: Number(r[5]), notes: String(r[6]),
      source: String(r[7]), imported: String(r[8]) === 'yes'
    });
  }
  return out;
}

function readBudgets_() {
  var rows = sheet_('Budgets').getDataRange().getValues();
  var out = {};
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] !== '') out[String(rows[i][0])] = Number(rows[i][1]) || 0;
  }
  return out;
}

function readConfig_() {
  var rows = sheet_('Config').getDataRange().getValues();
  var out = {};
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] !== '') out[String(rows[i][0])] = rows[i][1];
  }
  return out;
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.token !== TOKEN) return json_({ ok: false, error: 'bad token' });
  if (p.action === 'ping') return json_({ ok: true, pong: true });
  if (p.action === 'data') {
    return json_({ ok: true, entries: readAll_(), budgets: readBudgets_(), config: readConfig_() });
  }
  return json_({ ok: false, error: 'unknown action' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad json' });
  }
  if (body.token !== TOKEN) return json_({ ok: false, error: 'bad token' });

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (body.action === 'add') {
      var en = body.entry || {};
      var amount = Number(en.amount);
      if (!isFinite(amount) || amount <= 0) return json_({ ok: false, error: 'bad amount' });
      if (en.type !== 'expense' && en.type !== 'income') return json_({ ok: false, error: 'bad type' });
      if (en.type === 'expense' && CATEGORIES.indexOf(en.category) === -1) {
        return json_({ ok: false, error: 'bad category' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(en.date))) return json_({ ok: false, error: 'bad date' });
      var id = en.id && /^[a-z0-9-]{8,40}$/.test(en.id) ? en.id : Utilities.getUuid();
      // Idempotent: the offline queue may retry a send that already landed.
      var existing = readAll_();
      for (var i = 0; i < existing.length; i++) {
        if (existing[i].id === id) return json_({ ok: true, id: id, duplicate: true });
      }
      sheet_('Entries').appendRow([
        id, new Date().toISOString(), String(en.date), en.type,
        en.type === 'income' ? 'Income' : en.category, amount,
        String(en.notes || '').slice(0, 200), String(en.source || '').slice(0, 20), ''
      ]);
      return json_({ ok: true, id: id });
    }
    if (body.action === 'add_many') {
      // Bulk load used by tools/sync_from_excel.py to seed workbook history.
      // Entries arrive pre-deduped with stable ids; skip any id already present.
      var list = body.entries || [];
      if (list.length > 500) return json_({ ok: false, error: 'too many (max 500 per call)' });
      var have = {};
      readAll_().forEach(function (x) { have[x.id] = true; });
      var rows = [];
      for (var m = 0; m < list.length; m++) {
        var en2 = list[m];
        var amt = Number(en2.amount);
        if (!en2.id || have[en2.id]) continue;
        if (!isFinite(amt) || amt <= 0) continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(en2.date))) continue;
        if (en2.type !== 'expense' && en2.type !== 'income') continue;
        have[en2.id] = true;
        rows.push([
          String(en2.id), new Date().toISOString(), String(en2.date), en2.type,
          en2.type === 'income' ? 'Income' : String(en2.category), amt,
          String(en2.notes || '').slice(0, 200), String(en2.source || '').slice(0, 20),
          en2.imported ? 'yes' : ''
        ]);
      }
      if (rows.length) {
        var sh0 = sheet_('Entries');
        sh0.getRange(sh0.getLastRow() + 1, 1, rows.length, ENTRY_HEADER.length).setValues(rows);
      }
      return json_({ ok: true, added: rows.length, skipped: list.length - rows.length });
    }
    if (body.action === 'set_budgets') {
      // Mirror the workbook's projected amounts (tools/sync_from_excel.py).
      var nb = body.budgets || {};
      var bsh = sheet_('Budgets');
      var brows = bsh.getDataRange().getValues();
      var seen = {}, changed = 0;
      for (var bi = 1; bi < brows.length; bi++) {
        var bcat = String(brows[bi][0]);
        if (bcat === '') continue;
        seen[bcat] = true;
        if (nb.hasOwnProperty(bcat)) {
          var bv = Number(nb[bcat]);
          if (isFinite(bv) && bv >= 0 && bv !== Number(brows[bi][1])) {
            bsh.getRange(bi + 1, 2).setValue(bv);
            changed++;
          }
        }
      }
      for (var ci = 0; ci < CATEGORIES.length; ci++) {
        var cc = CATEGORIES[ci];
        if (!seen[cc] && nb.hasOwnProperty(cc)) {
          var cv = Number(nb[cc]);
          if (isFinite(cv) && cv >= 0) { bsh.appendRow([cc, cv]); changed++; }
        }
      }
      return json_({ ok: true, updated: changed });
    }
    if (body.action === 'delete') {
      var sh = sheet_('Entries');
      var rows = sh.getDataRange().getValues();
      for (var j = 1; j < rows.length; j++) {
        if (String(rows[j][0]) === String(body.id)) {
          if (String(rows[j][8]) === 'yes') return json_({ ok: false, error: 'already imported to Excel' });
          sh.deleteRow(j + 1);
          return json_({ ok: true });
        }
      }
      return json_({ ok: false, error: 'not found' });
    }
    if (body.action === 'mark_imported') {
      var ids = body.ids || [];
      var sh2 = sheet_('Entries');
      var rows2 = sh2.getDataRange().getValues();
      var marked = 0;
      for (var k = 1; k < rows2.length; k++) {
        if (ids.indexOf(String(rows2[k][0])) !== -1) {
          sh2.getRange(k + 1, 9).setValue('yes');
          marked++;
        }
      }
      return json_({ ok: true, marked: marked });
    }
    return json_({ ok: false, error: 'unknown action' });
  } finally {
    lock.releaseLock();
  }
}
