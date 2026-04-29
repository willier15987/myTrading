/**
 * Replay Trade Log helper for Google Sheets.
 *
 * Usage:
 * 1. Open your Google Sheet.
 * 2. Extensions -> Apps Script.
 * 3. Paste this file into Code.gs.
 * 4. Run setupReplayTradeLog().
 *
 * The script keeps the user's existing trade-log style and adds the required
 * interval field for future AI replay review.
 */

const REPLAY_SHEET_NAME = '複盤紀錄';
const SPREADSHEET_FILE_ID = '1prIhYelkvN64xwMTFeV3tT9Ls2Q46uj1Ec2-zXRCrPI';

const REPLAY_HEADERS = [
  '交易ID',
  '幣種',
  '週期',
  '入場時間',
  '入場價格',
  '止盈價格',
  '止損價格',
  '入場理由',
  '關單價格',
  '關單時間',
  '關單理由',
  '儲存時間',
  '多/空',
  'RR',
];

const INTERVAL_OPTIONS = ['15m', '1h', '4h', '1d'];
const DIRECTION_OPTIONS = ['多', '空', 'long', 'short'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('複盤工具')
    .addItem('初始化 / 修復欄位', 'setupReplayTradeLog')
    .addItem('補齊交易ID與RR', 'normalizeReplayRows')
    .addToUi();
}

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    const payload = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : '{}');
    validateUploadToken_(payload);

    const positions = Array.isArray(payload.positions) ? payload.positions : [];
    const ss = getSpreadsheet_();
    const sheet = getOrCreateReplaySheet_(ss);

    ensureHeaders_(sheet);
    applyFormatting_(sheet);
    applyValidations_(sheet);

    const result = upsertReplayRows_(sheet, positions);

    return jsonOutput_({
      ok: true,
      sheet: REPLAY_SHEET_NAME,
      received: positions.length,
      appended: result.appended,
      updated: result.updated,
    });
  } catch (err) {
    return jsonOutput_({
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (err) {
      // Ignore release failures after timeout or early errors.
    }
  }
}

function setupReplayTradeLog() {
  const ss = getSpreadsheet_();
  const sheet = getOrCreateReplaySheet_(ss);

  ensureHeaders_(sheet);
  applyFormatting_(sheet);
  applyValidations_(sheet);
  normalizeReplayRows();

  SpreadsheetApp.getUi().alert('複盤紀錄欄位已初始化完成。');
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_FILE_ID);
}

function validateUploadToken_(payload) {
  const expected = PropertiesService.getScriptProperties().getProperty('UPLOAD_TOKEN');
  if (!expected) return;
  if (payload.token !== expected) {
    throw new Error('Invalid upload token.');
  }
}

function upsertReplayRows_(sheet, positions) {
  const headerMap = getHeaderMap_(sheet);
  const idColumn = headerMap['交易ID'];
  const existingIds = new Map();
  const lastRow = sheet.getLastRow();

  if (lastRow >= 2 && idColumn) {
    const ids = sheet.getRange(2, idColumn, lastRow - 1, 1).getValues();
    ids.forEach((row, index) => {
      const id = String(row[0] || '').trim();
      if (id) existingIds.set(id, index + 2);
    });
  }

  const rowsToAppend = [];
  let updated = 0;

  positions.forEach((position, index) => {
    const rowValues = positionToReplayRow_(position, index);
    const tradeId = String(rowValues[0] || '').trim();
    const existingRow = tradeId ? existingIds.get(tradeId) : null;

    if (existingRow) {
      sheet.getRange(existingRow, 1, 1, REPLAY_HEADERS.length).setValues([rowValues]);
      updated += 1;
      return;
    }

    rowsToAppend.push(rowValues);
  });

  if (rowsToAppend.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToAppend.length, REPLAY_HEADERS.length).setValues(rowsToAppend);
  }

  return {
    appended: rowsToAppend.length,
    updated,
  };
}

function positionToReplayRow_(position, index) {
  const direction = normalizeDirection_(position.direction);
  const entry = Number(position.entry_price);
  const tp = Number(position.tp_price);
  const sl = Number(position.sl_price);
  const rr = calculateRR_(direction, entry, tp, sl);

  return [
    position.id || makeTradeId_(position.symbol, position.entry_ts, index + 2),
    position.symbol || '',
    position.interval || '',
    toDate_(position.entry_ts),
    finiteOrBlank_(entry),
    finiteOrBlank_(tp),
    finiteOrBlank_(sl),
    position.entry_reason || '',
    finiteOrBlank_(Number(position.exit_price)),
    position.exit_ts ? toDate_(position.exit_ts) : '',
    position.exit_reason || '',
    new Date(),
    direction === 'long' ? '多' : direction === 'short' ? '空' : '',
    rr !== null ? rr : '',
  ];
}

function normalizeReplayRows() {
  const ss = getSpreadsheet_();
  const sheet = getOrCreateReplaySheet_(ss);
  const headerMap = getHeaderMap_(sheet);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return;

  for (let row = 2; row <= lastRow; row += 1) {
    const symbol = getCellValue_(sheet, row, headerMap['幣種']);
    const entryTime = getCellValue_(sheet, row, headerMap['入場時間']);
    const entryPrice = Number(getCellValue_(sheet, row, headerMap['入場價格']));
    const tpPrice = Number(getCellValue_(sheet, row, headerMap['止盈價格']));
    const slPrice = Number(getCellValue_(sheet, row, headerMap['止損價格']));
    const direction = normalizeDirection_(getCellValue_(sheet, row, headerMap['多/空']));

    if (!symbol && !entryTime && !entryPrice) continue;

    const tradeIdCell = sheet.getRange(row, headerMap['交易ID']);
    if (!tradeIdCell.getValue()) {
      tradeIdCell.setValue(makeTradeId_(symbol, entryTime, row));
    }

    const savedAtCell = sheet.getRange(row, headerMap['儲存時間']);
    if (!savedAtCell.getValue()) {
      savedAtCell.setValue(new Date());
    }

    const rrCell = sheet.getRange(row, headerMap['RR']);
    if (!rrCell.getValue() && direction && entryPrice > 0 && tpPrice > 0 && slPrice > 0) {
      const rr = calculateRR_(direction, entryPrice, tpPrice, slPrice);
      if (rr !== null) rrCell.setValue(rr);
    }
  }
}

function getOrCreateReplaySheet_(ss) {
  return ss.getSheetByName(REPLAY_SHEET_NAME) || ss.insertSheet(REPLAY_SHEET_NAME);
}

function ensureHeaders_(sheet) {
  const maxColumns = Math.max(sheet.getLastColumn(), REPLAY_HEADERS.length);
  const existing = sheet.getRange(1, 1, 1, maxColumns).getValues()[0].map(String);
  const existingSet = new Set(existing.filter(Boolean));

  if (existingSet.size === 0) {
    sheet.getRange(1, 1, 1, REPLAY_HEADERS.length).setValues([REPLAY_HEADERS]);
    return;
  }

  let insertAt = sheet.getLastColumn();
  REPLAY_HEADERS.forEach(header => {
    if (existingSet.has(header)) return;

    if (header === '週期' && existingSet.has('幣種')) {
      const symbolIndex = existing.indexOf('幣種') + 1;
      sheet.insertColumnAfter(symbolIndex);
      sheet.getRange(1, symbolIndex + 1).setValue('週期');
      existing.splice(symbolIndex, 0, '週期');
      existingSet.add('週期');
      insertAt = sheet.getLastColumn();
      return;
    }

    insertAt += 1;
    sheet.getRange(1, insertAt).setValue(header);
    existingSet.add(header);
  });

  reorderHeaders_(sheet);
}

function reorderHeaders_(sheet) {
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const currentHeaders = values[0].map(String);
  const currentIndex = new Map(currentHeaders.map((header, index) => [header, index]));

  const reordered = values.map(row => {
    const next = REPLAY_HEADERS.map(header => {
      const index = currentIndex.get(header);
      return index == null ? '' : row[index];
    });

    currentHeaders.forEach((header, index) => {
      if (header && !REPLAY_HEADERS.includes(header)) next.push(row[index]);
    });

    return next;
  });

  sheet.clearContents();
  sheet.getRange(1, 1, reordered.length, reordered[0].length).setValues(reordered);
}

function applyFormatting_(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, REPLAY_HEADERS.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1f2937');
  headerRange.setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, REPLAY_HEADERS.length);

  const headerMap = getHeaderMap_(sheet);
  setNumberFormat_(sheet, headerMap['入場時間'], 'yyyy-mm-dd hh:mm:ss');
  setNumberFormat_(sheet, headerMap['關單時間'], 'yyyy-mm-dd hh:mm:ss');
  setNumberFormat_(sheet, headerMap['儲存時間'], 'yyyy-mm-dd hh:mm:ss');
  setNumberFormat_(sheet, headerMap['入場價格'], '0.########');
  setNumberFormat_(sheet, headerMap['止盈價格'], '0.########');
  setNumberFormat_(sheet, headerMap['止損價格'], '0.########');
  setNumberFormat_(sheet, headerMap['關單價格'], '0.########');
  setNumberFormat_(sheet, headerMap['RR'], '0.00');
}

function applyValidations_(sheet) {
  const headerMap = getHeaderMap_(sheet);
  const maxRows = Math.max(sheet.getMaxRows() - 1, 1);

  const intervalRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(INTERVAL_OPTIONS, true)
    .setAllowInvalid(false)
    .build();

  const directionRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(DIRECTION_OPTIONS, true)
    .setAllowInvalid(false)
    .build();

  sheet.getRange(2, headerMap['週期'], maxRows, 1).setDataValidation(intervalRule);
  sheet.getRange(2, headerMap['多/空'], maxRows, 1).setDataValidation(directionRule);
}

function getHeaderMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.reduce((acc, header, index) => {
    if (header) acc[String(header)] = index + 1;
    return acc;
  }, {});
}

function getCellValue_(sheet, row, col) {
  if (!col) return '';
  return sheet.getRange(row, col).getValue();
}

function setNumberFormat_(sheet, col, format) {
  if (!col) return;
  const maxRows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, col, maxRows, 1).setNumberFormat(format);
}

function normalizeDirection_(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === '多' || text === 'long') return 'long';
  if (text === '空' || text === 'short') return 'short';
  return '';
}

function calculateRR_(direction, entry, tp, sl) {
  const reward = direction === 'long' ? tp - entry : entry - tp;
  const risk = direction === 'long' ? entry - sl : sl - entry;
  if (risk <= 0 || reward <= 0) return null;
  return Math.round((reward / risk) * 100) / 100;
}

function finiteOrBlank_(value) {
  return Number.isFinite(value) ? value : '';
}

function toDate_(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string' && value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return '';
}

function makeTradeId_(symbol, entryTime, row) {
  const symbolText = String(symbol || 'TRADE').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const date = toDate_(entryTime);
  const timestamp = date instanceof Date
    ? Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyyMMddHHmmss')
    : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss');
  return `${symbolText}-${timestamp}-${row}`;
}

function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
