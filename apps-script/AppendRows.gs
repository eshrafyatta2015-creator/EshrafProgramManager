/**
 * EshrafProgramManager — AppendRows.gs (v3)
 * مسار الكتابة الوحيد للتطبيق:
 *   1) action 'append'      → إضافة صفوف بتنسيق ردود الاستمارة إلى الأرشيف النهائي
 *                             (ترويسة واحدة أعلى الملف فقط إذا كان فارغاً — لا ترويسة لكل أسبوع،
 *                             وسطر وسم قسم (MAGIC_HEADER + تسمية الأسبوع) قبل كل دفعة ليُسند
 *                             الصفوف لأسبوعها حتى إن كانت طوابعها الزمنية أقدم من بدايته —
 *                             ومنع تكرار بمفتاح: الأسبوع + اسم المشرف + النوع + الأيام).
 *   2) action 'deleteRows'  → حذف صفوف محددة تحديداً من ملف الردود — لا يُستدعى إلا بعد
 *                             تحقق التطبيق من وصول الصفوف للأرشيف. لا يُحذف صف 1 (الترويسة)
 *                             ولا أي صف غير مدرَج في القائمة.
 *
 * طريقة النشر:
 * 1) افتح جدول الأرشيف: https://docs.google.com/spreadsheets/d/1rthlmaZES8c95kUI6ErfD4YgiymWq4RoKXNXqgoBPnI/edit
 * 2) الإضافات (Extensions) → Apps Script
 * 3) احذف المحتوى الحالي والصق هذا الملف بالكامل → احفظ
 * 4) Deploy → New deployment → Type: Web app
 *    - Execute as: Me (صاحب الحساب)
 *    - Who has access: Anyone
 * 5) انسخ رابط الويب أب (.../exec) والصقه في: الإعدادات ← ربط الخدمات
 *
 * ملاحظة: الرابط يُحفظ محلياً في المتصفح فقط، ولا يحتوي مفاتيح — لا تضعه داخل المستودع.
 */

var ADMIN_SHEET_ID = '1rthlmaZES8c95kUI6ErfD4YgiymWq4RoKXNXqgoBPnI';
var RESPONSES_SHEET_ID = '16Sw_4TjAM0fhYKicxyZE0EzGoT98ZnlMSxYKxU3ILLk';
var MAGIC_HEADER = '(اخترمن القائمة)اسم المشرف';
var TS_RE = /^\d{1,2}\/\d{1,2}\/\d{4}/;
var WEEK_RE = /\d{1,2}\/\d{1,2}\s*-\s*\d{1,2}\/\d{1,2}/;

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (payload.action === 'append') return append_(payload);
    if (payload.action === 'deleteRows') return deleteRows_(payload);
    return json_({ ok: false, error: 'action غير مدعوم' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ---------------- الإضافة إلى الأرشيف ---------------- */

function append_(payload) {
  var rows = payload.rows || [];
  var ss = SpreadsheetApp.openById(payload.sheetId || ADMIN_SHEET_ID);
  var sh = ss.getSheets()[0];

  var lastRow = sh.getLastRow();
  var headerWritten = false;
  /* ترويسة واحدة أعلى الملف — تُكتب فقط إذا كان الملف فارغاً كلياً (§13/§26) */
  if (lastRow === 0 && payload.headerRow && payload.headerRow.length) {
    sh.getRange(1, 1, 1, payload.headerRow.length).setValues([payload.headerRow]);
    headerWritten = true;
    lastRow = 1;
  }

  if (!rows.length) return json_({ ok: true, appended: 0, skipped: 0, headerWritten: headerWritten });

  var lastCol = Math.max(sh.getLastColumn(), 17);
  var all = lastRow > 0 ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [];
  var seen = seenKeys_(all);

  /* أسبوع الدفعة (من تسمية الأسبوع) — مفتاح الصفوف الجديدة يُنسب له لا لطابعها الزمني */
  var newWeek = weekStartOfLabel_(payload.weekLabel) || '';

  var toAppend = [];
  var skipped = 0;
  for (var k = 0; k < rows.length; k++) {
    var key = rowKey_(cells_(rows[k]), newWeek);
    if (!key) continue;
    if (seen[key]) { skipped++; continue; }
    seen[key] = true;
    toAppend.push(rows[k]);
  }

  if (toAppend.length) {
    var cols = toAppend[0].length;
    var outRows = [];
    /* وسم قسم قبل الصفوف: يقرأه التطبيق (parseAdminCsv) ليربط هذه الصفوف بأسبوعها الصحيح */
    if (payload.weekLabel) {
      var mrow = [MAGIC_HEADER, String(payload.weekLabel)];
      while (mrow.length < cols) mrow.push('');
      outRows.push(mrow);
    }
    outRows = outRows.concat(toAppend);
    var startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, 1, outRows.length, cols).setValues(outRows);
  }

  return json_({ ok: true, appended: toAppend.length, skipped: skipped, headerWritten: headerWritten });
}

/* مفاتيح كل صفوف الورقة الحالية — يتتبع أسبوع كل قسم من رؤوس الأقسام القديمة */
function seenKeys_(all) {
  var seen = {};
  var week = '';
  for (var i = 0; i < all.length; i++) {
    var cells = cells_(all[i]);
    var a = cells[0];
    if (!a && !cells[1]) continue;
    var na = norm_(a);
    if (a === MAGIC_HEADER || na === 'اسم المشرف') {
      var w0 = weekStartOfLabel_(cells[1]);
      if (w0) week = w0;
      continue;
    }
    if (na.toLowerCase() === 'timestamp') continue;
    if (WEEK_RE.test(a)) {
      var w1 = weekStartOfLabel_(a);
      if (w1) week = w1;
      continue;
    }
    var key = rowKey_(cells, week);
    if (key) seen[key] = true;
  }
  return seen;
}

/* مفتاح السجل: الأسبوع + اسم المشرف (موحّد للمقارنة) + النوع + محتوى الأيام
   يدعم الصيغتين: ردود الاستمارة (timestamp أولاً) والأرشيف القديم (الاسم أولاً). */
function rowKey_(cells, week) {
  var w = week || '';
  var name = '';
  var type = '';
  var days = [];
  var d;
  if (TS_RE.test(cells[0])) {
    /* الأسبوع الممرّر (من وسم القسم) أولاً — طابع الصف الزمني احتياطي فقط:
       صفوف الإرسال المبكر طوابعها أقدم من بداية أسبوعها. */
    w = w || weekStartOfDate_(cells[0]);
    name = norm_(cells[1] || '');
    type = isType_(cells[16]) ? cells[16] : '';
    for (d = 2; d <= 13 && d < cells.length; d++) days.push(cells[d]);
  } else {
    name = norm_(cells[0] || '');
    if (cells.length >= 16 && isType_(cells[15])) type = cells[15];
    else if (cells.length >= 15 && isType_(cells[14])) type = cells[14];
    for (d = 1; d <= 12 && d < cells.length; d++) days.push(cells[d]);
  }
  if (!name) return '';
  return [w, name, type, days.join('~')].join('|');
}

function isType_(v) {
  var t = String(v == null ? '' : v).trim();
  return t === 'تخطيط' || t === 'فعلي';
}

function cells_(row) {
  var out = [];
  for (var i = 0; i < row.length; i++) out.push(String(row[i] == null ? '' : row[i]).trim());
  return out;
}

/* تطبيع الاسم للمقارنة فقط (كما في التطبيق) */
function norm_(s) {
  return String(s == null ? '' : s)
    .replace(/\u0640/g, '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

function iso_(d) {
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/* بداية الأسبوع (أحد) من طابع زمني dd/mm/yyyy */
function weekStartOfDate_(ts) {
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(ts || '').trim());
  if (!m) return '';
  var d = new Date(+m[3], +m[2] - 1, +m[1]);
  d.setDate(d.getDate() - d.getDay());
  return iso_(d);
}

/* بداية الأسبوع من تسمية 4/10-10/10 (نفس منطق التطبيق: سنة حالية إن كانت الأحد) */
function weekStartOfLabel_(label) {
  var m = /(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})/.exec(String(label || ''));
  if (!m) return '';
  var nowYear = new Date().getFullYear();
  var years = [nowYear, nowYear - 1, nowYear + 1];
  var start = null;
  for (var i = 0; i < years.length; i++) {
    var cand = new Date(years[i], +m[2] - 1, +m[1]);
    if (cand.getFullYear() === years[i] && cand.getMonth() === +m[2] - 1 &&
        cand.getDate() === +m[1] && cand.getDay() === 0) {
      start = cand;
      break;
    }
  }
  if (!start) start = new Date(nowYear, +m[2] - 1, +m[1]);
  return iso_(start);
}

/* ---------------- الحذف من ملف الردود (بعد التحقق فقط) ---------------- */

function deleteRows_(payload) {
  var targets = payload.rows || [];
  var expected = targets.length;
  if (!expected) return json_({ ok: true, deleted: 0, expected: 0 });

  var ss = SpreadsheetApp.openById(payload.sheetId || RESPONSES_SHEET_ID);
  var sh = ss.getSheets()[0];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return json_({ ok: true, deleted: 0, expected: expected });

  var lastCol = Math.max(sh.getLastColumn(), 17);
  var all = sh.getRange(1, 1, lastRow, lastCol).getValues();

  var want = {};
  for (var i = 0; i < targets.length; i++) {
    var key = String(targets[i].t == null ? '' : targets[i].t).trim() + '\u0001' + norm_(targets[i].s);
    want[key] = (want[key] || 0) + 1;
  }

  var rowNumbers = [];
  /* نبدأ من الصف 2 — صف 1 (الترويسة) لا يُحذف أبداً، ولا أي صف غير مطابق للمواصفة */
  for (var r = 1; r < all.length; r++) {
    var c0 = String(all[r][0] == null ? '' : all[r][0]).trim();
    var c1 = String(all[r][1] == null ? '' : all[r][1]).trim();
    if (!c0 || !c1) continue;
    if (c0.toLowerCase() === 'timestamp' || c0 === MAGIC_HEADER) continue;
    var k2 = c0 + '\u0001' + norm_(c1);
    if (want[k2] > 0) {
      rowNumbers.push(r + 1);
      want[k2]--;
    }
  }

  /* حذف من الأسفل إلى الأعلى حتى تبقى ترقيم الصفوف صحيحاً */
  var deleted = 0;
  for (var j = rowNumbers.length - 1; j >= 0; j--) {
    sh.deleteRow(rowNumbers[j]);
    deleted++;
  }

  return json_({ ok: true, deleted: deleted, expected: expected });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, service: 'EshrafProgramManager AppendRows v3', hint: 'استخدم POST: append | deleteRows' });
}
