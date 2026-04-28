# Google Sheet Upload Setup

This project can upload replay positions directly to Google Sheets through a Google Apps Script Web App.

## 1. Install the Apps Script

1. Open the target Google Sheet.
2. Go to `Extensions -> Apps Script`.
3. Paste `google_apps_script/replay_trade_log.gs` into `Code.gs`.
4. Run `setupReplayTradeLog()` once.

The script creates or repairs the `複盤紀錄` sheet and includes the required `週期` column.

## 2. Optional Upload Token

The Web App URL can write to the sheet. For basic protection, set a script property:

```text
UPLOAD_TOKEN=your-private-token
```

In Apps Script:

1. Open `Project Settings`.
2. Add script property `UPLOAD_TOKEN`.

If this property is not set, the script accepts uploads without a token.

## 3. Deploy Web App

In Apps Script:

1. Click `Deploy -> New deployment`.
2. Type: `Web app`.
3. Execute as: `Me`.
4. Who has access: `Anyone`.
5. Copy the Web App URL ending in `/exec`.

## 4. Configure Local Backend

Set these environment variables before starting the backend:

```powershell
$env:GOOGLE_SHEET_WEBAPP_URL="https://script.google.com/macros/s/.../exec"
$env:GOOGLE_SHEET_UPLOAD_TOKEN="your-private-token"
python run.py
```

`GOOGLE_SHEET_UPLOAD_TOKEN` is only needed if you set `UPLOAD_TOKEN` in Apps Script.

The backend also reads these values from a local `.env` file in the project root. `.env` is ignored by Git.

## Upload Behavior

- New trades are appended to the bottom of the sheet.
- Existing trades with the same `交易ID` are updated in place.
- Existing rows are not deleted.
