/**
 * EshrafProgramManager — AppendRows.gs (v4)
 * مسار الكتابة الوحيد للتطبيق:
 *   1) action 'append'        → إضافة صفوف إلى الأرشيف النهائي بمطابقة أسماء أعمدة الترويسة
 *                               (ترويسة واحدة أعلى الملف فقط إذا كان فارغاً — لا ترويسة لكل أسبوع،
 *                               وعمود ناقص يُضاف في خلية ترويسة فارغة أو نهاية الترويسة — لا تغيير
 *                               للبيانات التاريخية، وسطر وسم قسم (MAGIC_HEADER + تسمية الأسبوع) قبل
 *                               كل دفعة — ومنع تكرار بمفتاح: الأسبوع + اسم المشرف + النوع + الأيام).
 *   2) action 'deleteRows'    → حذف صفوف محددة تحديداً من ملف الردود — لا يُستدعى إلا بعد
 *                               تحقق التطبيق من وصول الصفوف للأرشيف. لا يُحذف صف 1 (الترويسة)
 *                               ولا أي صف غير مدرَج في القائمة. يطابق بالصيغتين (timestamp أولاً
 *                               أو الاسم أولاً مع طابع زمني في أي عمود).
 *   3) action 'setWeekHeader' → تحديث تسمية الأسبوع في صف الترويسة (صف 1) فقط — تجهيز الاستمارة
 *                               للأسبوع الجديد بعد نجاح الترحيل والحذف. لا يُمس أي صف بيانات
 *                               ولا تُنشأ ترويسة متكررة، مع قراءة تحقق بعد الكتابة.
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
    if (payload.action === 'setWeekHeader') return setWeekHeader_(payload);
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

  /* المطابقة بالاسم: إن أرسل التطبيق خلايا الترويسة التي راجعها فعلياً — يجب أن تطابق صف 1
     الحالي حرفياً، وإلا نتوقف قبل أي كتابة (ترحيل آمن: الحذف لن يجري أصلاً). */
  var headerPatched = 0;
  var headerExtended = 0;
  if (payload.headerCells && payload.headerCells.length) {
    var hLastCol = sh.getLastColumn();
    var actual = hLastCol > 0 ? sh.getRange(1, 1, 1, hLastCol).getValues()[0] : [];
    if (!headerMatches_(actual, payload.headerCells)) {
      return json_({ ok: false, code: 'HEADER_MISMATCH', error: 'تغيّرت ترويسة الهدف منذ قراءتها — أعد المعاينة.' });
    }
    if (payload.headerPatch && payload.headerPatch.length) {
      for (var p = 0; p < payload.headerPatch.length; p++) {
        var col = payload.headerPatch[p].col | 0;
        var nm = String(payload.headerPatch[p].name || '');
        if (col < 1 || !nm) continue;
        var cur = col <= sh.getLastColumn() ? String(sh.getRange(1, col).getValue() == null ? '' : sh.getRange(1, col).getValue()).trim() : '';
        if (cur && cur !== nm) return json_({ ok: false, code: 'HEADER_MISMATCH', error: 'خلية ترويسة مشغولة: ' + cur });
        if (!cur) { sh.getRange(1, col).setValue(nm); headerPatched++; }
      }
    }
    if (payload.headerExtend && payload.headerExtend.length) {
      var base = payload.headerCells.length;
      for (var x = 0; x < payload.headerExtend.length; x++) {
        var nameX = String(payload.headerExtend[x] || '');
        if (!nameX) continue;
        var colX = base + 1 + x;
        var curX = colX <= sh.getLastColumn() ? String(sh.getRange(1, colX).getValue() == null ? '' : sh.getRange(1, colX).getValue()).trim() : '';
        if (curX && curX !== nameX) return json_({ ok: false, code: 'HEADER_MISMATCH', error: 'عمود ترويسة ممتد مشغول: ' + curX });
        if (!curX) { sh.getRange(1, colX).setValue(nameX); headerExtended++; }
      }
    }
  }

  if (!rows.length) return json_({ ok: true, appended: 0, skipped: 0, headerWritten: headerWritten, headerPatched: headerPatched, headerExtended: headerExtended });

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

  return json_({ ok: true, appended: toAppend.length, skipped: skipped, headerWritten: headerWritten, headerPatched: headerPatched, headerExtended: headerExtended });
}

/* مطابقة خلايا صف 1 الحالي مع الخلايا التي راجعها التطبيق (الفارغة زائدة مسموحة) */
function headerMatches_(actual, expected) {
  var a = cells_(actual);
  var b = cells_(expected);
  var n = Math.min(a.length, b.length);
  for (var i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  for (var j = n; j < a.length; j++) if (a[j]) return false;
  for (var q = n; q < b.length; q++) if (b[q]) return false;
  return true;
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
  /* نبدأ من الصف 2 — صف 1 (الترويسة) لا يُحذف أبداً، ولا أي صف غير مطابق للمواصفة.
     مطابقة الصيغتين: timestamp أولاً (ردود الاستمارة) أو الاسم أولاً مع طابع زمني في أي عمود
     (صفوف الأرشيف المطابقة بالاسم) — الصف بلا طابع زمني لا يطابق أي هدف ولا يُحذف. */
  for (var r = 1; r < all.length; r++) {
    var cells = cells_(all[r]);
    var c0 = cells[0];
    var c1 = cells[1];
    if (!c0 || !c1) continue;
    if (c0.toLowerCase() === 'timestamp' || c0 === MAGIC_HEADER) continue;
    if (WEEK_RE.test(c0) && !TS_RE.test(c0)) continue;
    var ts = '';
    var name = '';
    if (TS_RE.test(c0)) {
      ts = c0;
      name = c1;
    } else {
      name = c0;
      for (var q = 1; q < cells.length; q++) {
        if (TS_RE.test(cells[q])) { ts = cells[q]; break; }
      }
    }
    if (!ts) continue;
    var k2 = ts + '\u0001' + norm_(name);
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

/* ---------------- تحديث تسمية الأسبوع في صف الترويسة (صف 1) فقط ----------------
   تجهيز الاستمارة للأسبوع الجديد بعد نجاح الترحيل والحذف:
   لا يُمس أي صف بيانات، ولا تُنشأ ترويسة متكررة، مع قراءة تحقق بعد الكتابة. */
function setWeekHeader_(payload) {
  var oldLabel = String(payload.oldLabel == null ? '' : payload.oldLabel).trim();
  var newLabel = String(payload.newLabel == null ? '' : payload.newLabel).trim();
  if (!oldLabel || !newLabel) return json_({ ok: false, code: 'BAD_LABEL', error: 'تسمية أسبوع ناقصة.' });
  if (oldLabel === newLabel) return json_({ ok: true, updated: 0, already: true, verified: true });

  var ss = SpreadsheetApp.openById(payload.sheetId || RESPONSES_SHEET_ID);
  var sh = ss.getSheets()[0];
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return json_({ ok: false, code: 'EMPTY', error: 'لا توجد ترويسة للتحديث.' });

  var row = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var updated = 0;
  var already = 0;
  for (var i = 0; i < row.length; i++) {
    var s = String(row[i] == null ? '' : row[i]);
    if (s.indexOf(newLabel) >= 0) { already++; continue; }
    if (s.indexOf(oldLabel) >= 0) {
      row[i] = s.split(oldLabel).join(newLabel);
      updated++;
    }
  }
  if (!updated && !already) {
    return json_({ ok: false, code: 'LABEL_NOT_FOUND', error: 'لم يُعثر على التسمية القديمة في صف الترويسة.' });
  }
  if (updated) sh.getRange(1, 1, 1, row.length).setValues([row]);

  /* قراءة تحقق من الملف نفسه: لا نُبلِّغ نجاحاً إلا بتأكيد فعلي */
  var back = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var sawNew = false;
  for (var j = 0; j < back.length; j++) {
    var b = String(back[j] == null ? '' : back[j]);
    if (b.indexOf(oldLabel) >= 0) {
      return json_({ ok: false, code: 'VERIFY_FAILED', error: 'التسمية القديمة ما زالت موجودة بعد الكتابة.', updated: updated });
    }
    if (b.indexOf(newLabel) >= 0) sawNew = true;
  }
  if (updated && !sawNew) {
    return json_({ ok: false, code: 'VERIFY_FAILED', error: 'التسمية الجديدة غير موجودة بعد الكتابة.', updated: updated });
  }
  return json_({ ok: true, updated: updated, already: already > 0 && !updated, verified: true });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, service: 'EshrafProgramManager AppendRows v4', hint: 'استخدم POST: append | deleteRows | setWeekHeader' });
}
