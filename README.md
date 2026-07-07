# TableDesk Ledger

Phone-first budget capture and dashboard for the Budget 2026 workbook.
Log expenses and income as they happen; see month-to-date budget burn,
trends, savings, and cash balance. Entries land in a private Google Sheet
and get pulled into `Budget 2026.xlsx` on demand by a safe import script.

```
iPhone (this app, GitHub Pages)
   -> Google Apps Script web app (your account)
      -> "TableDesk Ledger Data" Google Sheet   (capture inbox)
         -> tools/import_to_excel.py            (run on the Mac, on demand)
            -> Budget 2026.xlsx                 (source of truth, untouched otherwise)
```

No secrets live in this repo. The app asks for the web app URL and token
once, on the phone, and stores them locally on the device.

## One-time setup

### 1. Backend (5 minutes, in your Google account)

1. Open script.new in a browser where you are signed in to Google.
2. Paste the contents of `setup/Code.gs` (the local copy with the real token;
   `apps-script/Code.gs` in the repo is the same file with a placeholder).
3. Toolbar: select the `setup` function and Run it once. Grant permissions.
   The execution log prints the URL of your new "TableDesk Ledger Data" sheet.
4. Deploy > New deployment > type: Web app. Execute as: **Me**.
   Who has access: **Anyone**. Deploy, then copy the `/exec` URL.

### 2. Phone

1. Open the app URL in Safari on the iPhone.
2. Tap the gear, paste the `/exec` URL and the token, Test connection, Save.
3. Share button > **Add to Home Screen**. It runs fullscreen like an app,
   works offline, and queues entries until it can sync.

### 3. Mac (for imports)

Fill `tools/config.json` (already gitignored) with the same `/exec` URL.

## Daily use

Just log things. Expense categories mirror the workbook exactly; income
takes a source (Alana / Max) because the workbook tracks income per person.
The Board tab shows month-to-date burn vs budget pace, category meters,
income vs expenses, cash balance, and the savings stash. Budgets and
starting cash are editable any time in the Budgets / Config tabs of the
Google Sheet; the app picks changes up on refresh.

## Keeping the app and the workbook in step

Two scripts, both safe to run any time, in any order:

```
python3 tools/sync_from_excel.py --dry-run    # Excel -> Sheet: see what's missing
python3 tools/sync_from_excel.py              # push workbook history into the Sheet
python3 tools/import_to_excel.py --dry-run    # Sheet -> Excel: see the plan
python3 tools/import_to_excel.py              # write app entries into the workbook
```

`sync_from_excel.py` makes the app's dashboard reflect everything already in
the workbook: it reads every visible month's Input blocks plus the income
actual cells and adds whatever the Sheet is missing, marked imported so it
can never bounce back into Excel. Dedup is by content (category + date +
amount, counted), so hand-typed rows, app entries, and repeat runs coexist.
Run it once at the start, and again after any session of typing entries
directly into Excel.

Income reconciliation assumes the workbook is truth: if a month's income
cell exceeds the Sheet's entries, the difference is added as a "from
workbook" entry; if the Sheet exceeds the workbook, that's app income you
have not imported yet, and the import script will surface it as a conflict
(`--force-income` accepts the app total).

## Importing into the workbook

The script closes the loop: backup, edit a temp copy, validate, swap, then
mark the entries imported in the Sheet so they can never import twice.
Expense entries append into the month Input-tab blocks (inserting rows and
extending formulas if a block fills up). Income sets the month tab's
Alana/Max actual cells; a cell that already has a different manual value is
reported as a conflict and skipped unless you pass `--force-income`.
Entries marked imported show an "in Excel" tag in the app and lose their
delete button.

If marking fails after a successful import, do NOT re-run the import.
Run `python3 tools/import_to_excel.py --mark-only tools/last_import_ids.json`.

## Updating the app

Edits pushed to this repo go live on GitHub Pages automatically (about a
minute). The service worker fetches network-first, so the phone gets the
new version the next time the app opens with a connection; no reinstall,
no re-adding to the home screen. The one-time Apps Script setup only needs
revisiting if `apps-script/Code.gs` itself changes: paste the new file over
the old one, then Deploy > Manage deployments > Edit > New version (the
/exec URL stays the same).

## Notes

- Rotate the token by editing it in Apps Script, re-deploying, and updating
  the app's gear screen plus `tools/config.json`.
- Data math is unit-tested: `jsc calc.js tools/test_calc.js`
  (jsc lives in /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/).
- Icons regenerate with `python3 tools/make_icons.py`.
