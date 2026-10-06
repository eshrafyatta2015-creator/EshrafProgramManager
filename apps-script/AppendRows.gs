/**
 * EshrafProgramManager — AppendRows.gs
 * كتابة الصفوف الجديدة في جدول الأرشيف مع منع التكرار (قسم الأسبوع فقط).
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
 * ملاحظة: لا تضع هذا الرابط داخل أي ملف في GitHub إن كان يُعد حساساً —
 * يُحفظ محلياً في المتصفح فقط، ولا يحتوي مفاتيح.
 */

var ADMIN_SHEET_ID = '1rthlmaZES8c95kUI6ErfD4YgiymWq4RoKXNXqgoBPnI';
var MAGIC_HEADER = '(اخترمن القائمة)اسم المشرف';

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (payload.action !== 'append') {
      return json_({ ok: false, error: 'action غير مدعوم' });
    }
    var rows = payload.rows || [];
    if (!rows.length) return json_({ ok: true, appended: 0, skipped: 0 });

    var ss = SpreadsheetApp.openById(payload.sheetId || ADMIN_SHEET_ID);
    var sh = ss.getSheets()[0];
    var lastRow = sh.getLastRow();
    var lastCol = Math.max(sh.getLastColumn(), 16);
    var all = lastRow > 0 ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [];

    // حدود قسم الأسبوع المحدد (آخر صف رأس يحتوي اسم الأسبوع في العمود B)
    var weekLabel = String(payload.weekLabel || '');
    var sectionStart = -1;
    if (weekLabel) {
      for (var i = all.length - 1; i >= 0; i--) {
        var b = String(all[i][1] || '');
        var a = String(all[i][0] || '');
        if (b.indexOf(weekLabel) !== -1 && a === MAGIC_HEADER) {
          sectionStart = i + 1; // أول صف بيانات بعد الرأس (1-based)
          break;
        }
      }
    }

    var seen = {};
    if (sectionStart > 0) {
      for (var j = sectionStart; j < all.length; j++) {
        seen[rowKey_(all[j])] = true;
      }
    }

    var toAppend = [];
    var skipped = 0;
    for (var k = 0; k < rows.length; k++) {
      var key = rowKey_(rows[k]);
      if (seen[key]) { skipped++; continue; }
      seen[key] = true;
      toAppend.push(rows[k]);
    }

    if (toAppend.length) {
      sh.getRange(lastRow + 1, 1, toAppend.length, toAppend[0].length).setValues(toAppend);
    }

    return json_({ ok: true, appended: toAppend.length, skipped: skipped, section: weekLabel || '(كل الورقة)' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** مفتاح السجل: المشرف + المدرسة/الفعالية لستة الأيام + النوع */
function rowKey_(row) {
  var cells = [];
  for (var i = 0; i < row.length; i++) cells.push(String(row[i] == null ? '' : row[i]).trim());
  var type = cells.length >= 16 ? cells[15] : (cells.length >= 15 ? cells[14] : '');
  var parts = [cells[0]];
  for (var d = 1; d <= 12 && d < cells.length; d++) parts.push(cells[d]);
  parts.push(type);
  return parts.join('|');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, service: 'EshrafProgramManager AppendRows', hint: 'استخدم POST' });
}
