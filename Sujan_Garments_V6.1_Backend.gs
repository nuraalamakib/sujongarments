/*******************************************************
 * SUJAN GARMENTS V6.1 - GOOGLE APPS SCRIPT BACKEND
 *
 * MASTER SHEET: Sheet1
 * A = Date
 * B = Time
 * C = Source
 * D = Name
 * E = Mobile
 * F = Details
 * G = Type
 * H = Amount
 * I = Transaction ID
 *
 * LIVE MIRROR SHEETS:
 * Customer = customer transactions
 * Company  = company transactions
 *
 * IMPORTANT:
 * - Sheet1 remains the master/legacy sheet so existing data is preserved.
 * - Customer and Company are rebuilt from Sheet1 after every mutation.
 * - New rows are always written at Row 2, so newest entries stay on top.
 * - Transaction ID is the safety key for edit/delete/deduplication.
 *******************************************************/

var ss = SpreadsheetApp.getActiveSpreadsheet();
var SHEET_NAME = 'Sheet1';
var CUSTOMER_SHEET_NAME = 'Customer';
var COMPANY_SHEET_NAME = 'Company';

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet_() {
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('Sheet "' + SHEET_NAME + '" not found.');
  return sh;
}

function normalize_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function validEntryDate_(dateString) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateString || '');
}

function formatEntryDate_(yyyyMmDd, timezone) {
  if (!validEntryDate_(yyyyMmDd)) {
    return Utilities.formatDate(new Date(), timezone, 'dd/MM/yy');
  }

  var parts = yyyyMmDd.split('-');
  return parts[2] + '/' + parts[1] + '/' + parts[0].slice(-2);
}

function formatTransactionTime_(dateObject, timezone) {
  return Utilities.formatDate(dateObject, timezone, 'h:mm a');
}

function ensureTransactionIdColumn_(sheet) {
  var header = normalize_(sheet.getRange(1, 9).getValue());

  if (header !== 'Transaction ID') {
    sheet.getRange(1, 9).setValue('Transaction ID').setFontWeight('bold');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var idRange = sheet.getRange(2, 9, lastRow - 1, 1);
  var ids = idRange.getValues();
  var changed = false;

  for (var i = 0; i < ids.length; i++) {
    if (!normalize_(ids[i][0])) {
      ids[i][0] = 'LEGACY-' + Utilities.getUuid();
      changed = true;
    }
  }

  if (changed) idRange.setValues(ids);
}

function findTransactionRow_(sheet, transactionId) {
  transactionId = normalize_(transactionId);
  if (!transactionId) return -1;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  var ids = sheet.getRange(2, 9, lastRow - 1, 1).getValues();
  var foundRow = -1;

  for (var i = 0; i < ids.length; i++) {
    if (normalize_(ids[i][0]) === transactionId) {
      if (foundRow !== -1) {
        throw new Error(
          'Duplicate Transaction ID found. No edit/delete was performed: ' + transactionId
        );
      }
      foundRow = i + 2;
    }
  }

  return foundRow;
}

/* =====================================================
   SEPARATE CUSTOMER / COMPANY SHEETS
===================================================== */

function ensureMirrorSheet_(sheetName) {
  var sh = ss.getSheetByName(sheetName);

  if (!sh) {
    sh = ss.insertSheet(sheetName);
  }

  var headers = [
    'Date',
    'Time',
    'Source',
    'Name',
    'Mobile',
    'Details',
    'Type',
    'Amount',
    'Transaction ID'
  ];

  sh.getRange(1, 1, 1, 9).setValues([headers]);
  sh.getRange(1, 1, 1, 9).setFontWeight('bold');

  sh.setFrozenRows(1);

  return sh;
}

function rebuildMirrorSheets_() {
  var master = getSheet_();
  ensureTransactionIdColumn_(master);

  var customerSheet = ensureMirrorSheet_(CUSTOMER_SHEET_NAME);
  var companySheet = ensureMirrorSheet_(COMPANY_SHEET_NAME);

  var lastRow = master.getLastRow();

  var allRows = [];
  if (lastRow >= 2) {
    allRows = master.getRange(2, 1, lastRow - 1, 9).getValues();
  }

  var customers = [];
  var companies = [];

  allRows.forEach(function(row) {
    var source = normalize_(row[2]).toLowerCase();

    if (source === 'customer') {
      customers.push(row);
    } else if (source === 'company') {
      companies.push(row);
    }
  });

  function writeMirror_(sheet, rows) {
    var maxRows = sheet.getMaxRows();

    if (maxRows > 1) {
      sheet.getRange(2, 1, maxRows - 1, 9).clearContent();
    }

    if (rows.length) {
      sheet.getRange(2, 1, rows.length, 9).setValues(rows);
      sheet.getRange(2, 5, rows.length, 1).setNumberFormat('@');
      sheet.getRange(2, 8, rows.length, 1).setNumberFormat('#,##0.00');
      sheet.getRange(2, 1, rows.length, 1).setNumberFormat('@');
      sheet.getRange(2, 2, rows.length, 1).setNumberFormat('@');
    }
  }

  writeMirror_(customerSheet, customers);
  writeMirror_(companySheet, companies);

  return {
    customerRows: customers.length,
    companyRows: companies.length
  };
}

/*
 * One-time/manual repair tool.
 * Run this once after replacing the backend so existing Sheet1
 * records are copied into Customer and Company.
 */
function setupSeparateSheets() {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    var result = rebuildMirrorSheets_();

    Logger.log(
      'Separate sheets rebuilt. Customer=' +
      result.customerRows +
      ', Company=' +
      result.companyRows
    );

    return result;

  } finally {
    try {
      lock.releaseLock();
    } catch (_) {}
  }
}

/* =====================================================
   EDIT TRANSACTION
   Changes ONLY H = Amount in Sheet1, then rebuilds mirrors.
===================================================== */
function editTransaction_(sheet, transactionId, amount) {
  var rowNumber = findTransactionRow_(sheet, transactionId);

  if (rowNumber < 2) {
    return jsonOutput_({
      status: 'error',
      message: 'Transaction not found.'
    });
  }

  amount = Number(amount);

  if (!isFinite(amount) || amount <= 0) {
    return jsonOutput_({
      status: 'error',
      message: 'Invalid amount.'
    });
  }

  amount = Math.round(amount * 100) / 100;

  var source = normalize_(
    sheet.getRange(rowNumber, 3).getDisplayValue()
  ).toLowerCase();

  /* ONLY H is changed in the master row. */
  sheet.getRange(rowNumber, 8).setValue(amount);
  sheet.getRange(rowNumber, 8).setNumberFormat('#,##0.00');

  SpreadsheetApp.flush();

  var mirrorWarning = '';

  try {
    rebuildMirrorSheets_();
  } catch (mirrorError) {
    mirrorWarning = String(
      mirrorError && mirrorError.message
        ? mirrorError.message
        : mirrorError
    );
  }

  var updatedRow = sheet.getRange(rowNumber, 1, 1, 9).getValues()[0];

  return jsonOutput_({
    status: 'success',
    action: 'editTransaction',
    transactionId: transactionId,
    source: source,
    amount: amount,
    rowNumber: rowNumber,
    row: updatedRow,
    mirrorStatus: mirrorWarning ? 'warning' : 'ok',
    mirrorWarning: mirrorWarning,
    message: mirrorWarning
      ? 'Transaction updated in master Sheet. Mirror sheet update needs attention.'
      : 'Transaction amount updated successfully.'
  });
}

/* =====================================================
   DELETE TRANSACTION
   Removes ONLY the selected complete master row, then
   rebuilds Customer/Company mirrors.
===================================================== */
function deleteTransaction_(sheet, transactionId) {
  transactionId = normalize_(transactionId);

  if (!transactionId) {
    return jsonOutput_({
      status: 'error',
      message: 'Transaction ID is required.'
    });
  }

  var rowNumber = findTransactionRow_(sheet, transactionId);

  if (rowNumber < 2) {
    return jsonOutput_({
      status: 'notFound',
      transactionId: transactionId,
      message: 'Transaction not found. Nothing was deleted.'
    });
  }

  var liveId = normalize_(
    sheet.getRange(rowNumber, 9).getDisplayValue()
  );

  if (liveId !== transactionId) {
    return jsonOutput_({
      status: 'error',
      message: 'Transaction changed before deletion. Nothing was deleted.'
    });
  }

  var deletedRow = sheet.getRange(rowNumber, 1, 1, 9).getValues()[0];

  sheet.deleteRow(rowNumber);
  SpreadsheetApp.flush();

  var mirrorWarning = '';

  try {
    rebuildMirrorSheets_();
  } catch (mirrorError) {
    mirrorWarning = String(
      mirrorError && mirrorError.message
        ? mirrorError.message
        : mirrorError
    );
  }

  return jsonOutput_({
    status: 'success',
    action: 'deleteTransaction',
    transactionId: transactionId,
    rowNumber: rowNumber,
    deletedRow: deletedRow,
    mirrorStatus: mirrorWarning ? 'warning' : 'ok',
    mirrorWarning: mirrorWarning,
    message: mirrorWarning
      ? 'Master transaction deleted. Mirror sheet update needs attention.'
      : 'Complete transaction row deleted successfully.'
  });
}

/* =====================================================
   POST
===================================================== */
function doPost(e) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    var sheet = getSheet_();
    ensureTransactionIdColumn_(sheet);
    ensureMirrorSheet_(CUSTOMER_SHEET_NAME);
    ensureMirrorSheet_(COMPANY_SHEET_NAME);

    if (!e || !e.postData || !e.postData.contents) {
      return jsonOutput_({
        status: 'error',
        message: 'No POST data received.'
      });
    }

    var p;

    try {
      p = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return jsonOutput_({
        status: 'error',
        message: 'Invalid JSON data.'
      });
    }

    var action = normalize_(p.action);

    if (action === 'editTransaction') {
      return editTransaction_(
        sheet,
        normalize_(p.transactionId),
        p.amount
      );
    }

    if (action === 'deleteTransaction') {
      return deleteTransaction_(
        sheet,
        normalize_(p.transactionId)
      );
    }

    /* =================================================
       NORMAL NEW TRANSACTION
    ================================================= */

    var transactionId = normalize_(p.transactionId);
    var source = normalize_(p.source).toLowerCase();
    var type = normalize_(p.type);
    var name = normalize_(p.name);
    var mobile = normalize_(p.mobile).replace(/\D/g, '');
    var details = normalize_(p.details);
    var amount = Number(p.amount);

    if (!transactionId) {
      return jsonOutput_({
        status: 'error',
        message: 'Transaction ID is required.'
      });
    }

    if (!name) {
      return jsonOutput_({
        status: 'error',
        message: 'Name is required.'
      });
    }

    if (!isFinite(amount) || amount <= 0) {
      return jsonOutput_({
        status: 'error',
        message: 'Invalid amount.'
      });
    }

    if (source !== 'customer' && source !== 'company') {
      return jsonOutput_({
        status: 'error',
        message: 'Invalid source.'
      });
    }

    var existingRow = findTransactionRow_(sheet, transactionId);

    if (existingRow >= 2) {
      var existingRowData =
        sheet.getRange(existingRow, 1, 1, 9).getValues()[0];

      return jsonOutput_({
        status: 'duplicate',
        transactionId: transactionId,
        row: existingRowData,
        message: 'This transaction already exists.'
      });
    }

    var timezone =
      ss.getSpreadsheetTimeZone() || 'Asia/Dhaka';

    var now = new Date();

    var entryDate = formatEntryDate_(
      normalize_(p.entryDate),
      timezone
    );

    var submittedTime = formatTransactionTime_(
      now,
      timezone
    );

    /* New transaction ALWAYS becomes Row 2. */
    sheet.insertRowBefore(2);

    var newRow = [
      entryDate,
      submittedTime,
      source,
      name,
      mobile,
      details,
      type,
      amount,
      transactionId
    ];

    sheet.getRange(2, 1, 1, 9).setValues([newRow]);

    sheet.getRange(2, 5).setNumberFormat('@');
    sheet.getRange(2, 8).setNumberFormat('#,##0.00');
    sheet.getRange(2, 1).setNumberFormat('@');
    sheet.getRange(2, 2).setNumberFormat('@');

    SpreadsheetApp.flush();

    var mirrorWarning = '';

    try {
      rebuildMirrorSheets_();
    } catch (mirrorError) {
      mirrorWarning = String(
        mirrorError && mirrorError.message
          ? mirrorError.message
          : mirrorError
      );
    }

    return jsonOutput_({
      status: 'success',
      transactionId: transactionId,
      date: entryDate,
      time: submittedTime,
      row: newRow,
      mirrorStatus: mirrorWarning ? 'warning' : 'ok',
      mirrorWarning: mirrorWarning,
      message: mirrorWarning
        ? 'Transaction saved in master Sheet. Mirror update needs attention.'
        : 'Transaction saved successfully.'
    });

  } catch (err) {
    return jsonOutput_({
      status: 'error',
      message: String(
        err && err.message
          ? err.message
          : err
      )
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {}
  }
}

/* =====================================================
   GET ALL DATA
   The app continues reading Sheet1 so existing logic
   and old records remain fully compatible.
===================================================== */
function doGet() {
  try {
    var sheet = getSheet_();
    ensureTransactionIdColumn_(sheet);

    var lastRow = sheet.getLastRow();
    var lastColumn = Math.max(sheet.getLastColumn(), 9);

    if (lastRow < 1) {
      return jsonOutput_([]);
    }

    var data = sheet
      .getRange(1, 1, lastRow, lastColumn)
      .getValues();

    return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return jsonOutput_({
      status: 'error',
      message: String(
        err && err.message
          ? err.message
          : err
      )
    });
  }
}

/* =====================================================
   ONE-TIME / SAFE SETUP
===================================================== */

function setupTransactionIds() {
  var sheet = getSheet_();
  ensureTransactionIdColumn_(sheet);
}

function setupSeparateSheetsOnly() {
  return setupSeparateSheets();
}

function testBackend() {
  var sheet = getSheet_();
  ensureTransactionIdColumn_(sheet);
  ensureMirrorSheet_(CUSTOMER_SHEET_NAME);
  ensureMirrorSheet_(COMPANY_SHEET_NAME);

  Logger.log(
    'Backend connected. Master=' +
    sheet.getName() +
    ', Customer=' +
    CUSTOMER_SHEET_NAME +
    ', Company=' +
    COMPANY_SHEET_NAME
  );
}

/* =====================================================
   SAFE AUDIT HELPERS
   These DO NOT modify data.
===================================================== */

function auditTransactionIds() {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log('No transaction rows found.');
    return;
  }

  var data =
    sheet.getRange(2, 1, lastRow - 1, 9).getValues();

  var seen = {};
  var duplicateIds = [];
  var orphanRows = [];

  for (var i = 0; i < data.length; i++) {
    var rowNumber = i + 2;
    var row = data[i];
    var id = normalize_(row[8]);
    var hasAH = false;

    for (var c = 0; c < 8; c++) {
      if (normalize_(row[c]) !== '') {
        hasAH = true;
        break;
      }
    }

    if (id && seen[id]) {
      duplicateIds.push(
        id +
        ' (rows ' +
        seen[id] +
        ' and ' +
        rowNumber +
        ')'
      );
    } else if (id) {
      seen[id] = rowNumber;
    }

    if (id && !hasAH) {
      orphanRows.push(
        rowNumber +
        ' -> ' +
        id
      );
    }
  }

  Logger.log(
    'Duplicate Transaction IDs: ' +
    (
      duplicateIds.length
        ? duplicateIds.join(', ')
        : 'None'
    )
  );

  Logger.log(
    'Orphan ID rows (A:H empty): ' +
    (
      orphanRows.length
        ? orphanRows.join(', ')
        : 'None'
    )
  );
}
