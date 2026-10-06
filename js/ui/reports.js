/* التقارير — فلاتر + جداول + تصدير (Excel/CSV/Google Sheets) */

import { CFG } from '../config.js';
import { escapeHtml, formatDate, downloadBlob, csvSerialize, ltr } from '../utils.js';
import { tableHtml, toast, showModal, confirmModal, emptyState, htmlCell } from './components.js';
import { filterRecords, buildStatusReport, flattenDetail, reportTable } from '../services/reportService.js';
import { buildExportPlan } from '../services/exportService.js';
import { exportExcel, downloadCsv } from '../services/exportService.js';
import { appendData, verifyAppendInCsv, recordKey } from '../services/sheetsService.js';
import { logAdd } from '../services/logService.js';
import { App, go } from './app.js';

let resultCache = null;

function f() {
  return App.reportFilters;
}

function ensureFilters() {
  const d = App.reportFilters;
  if (!d.weekStart) d.weekStart = App.week ? App.week.start : '';
  if (!d.from) d.from = App.week ? App.week.start : '';
  if (!d.to) d.to = App.week ? App.week.end : '';
}

function controlsHtml(app) {
  const ff = f();
  const weeks = (app.data.weeks || []);
  const schools = (app.data.lists && app.data.lists.schools) || [];
  return '<div class="filter-grid">' +
    '<label class="field"><span>الأسبوع</span><select data-f="weekStart">' +
      '<option value="">كل الأسابيع</option>' +
      weeks.map((w) => '<option value="' + w.start + '"' + (ff.weekStart === w.start ? ' selected' : '') + '>أسبوع ' + w.label + '</option>').join('') +
    '</select></label>' +
    '<label class="field"><span>المشرف</span><select data-f="supervisorNorm">' +
      '<option value="">الجميع</option>' +
      app.data.master.map((s) => '<option value="' + escapeHtml(s.nameNorm) + '"' + (ff.supervisorNorm === s.nameNorm ? ' selected' : '') + '>' + escapeHtml(s.name) + '</option>').join('') +
    '</select></label>' +
    '<label class="field"><span>المدرسة</span><select data-f="school">' +
      '<option value="">الكل</option>' +
      schools.map((s) => '<option value="' + escapeHtml(s) + '"' + (ff.school === s ? ' selected' : '') + '>' + escapeHtml(s) + '</option>').join('') +
    '</select></label>' +
    '<label class="field"><span>نوع البرنامج</span><select data-f="type">' +
      '<option value="">الكل</option><option value="' + CFG.typePlanning + '"' + (ff.type === CFG.typePlanning ? ' selected' : '') + '>تخطيط</option>' +
      '<option value="' + CFG.typeActual + '"' + (ff.type === CFG.typeActual ? ' selected' : '') + '>فعلي</option>' +
    '</select></label>' +
    '<label class="field"><span>حالة الإرسال</span><select data-f="status">' +
      '<option value="">الكل</option>' +
      '<option value="sentAny"' + (ff.status === 'sentAny' ? ' selected' : '') + '>أرسل</option>' +
      '<option value="planning"' + (ff.status === 'planning' ? ' selected' : '') + '>أرسل التخطيط فقط</option>' +
      '<option value="actual"' + (ff.status === 'actual' ? ' selected' : '') + '>أرسل الفعلي</option>' +
      '<option value="none"' + (ff.status === 'none' ? ' selected' : '') + '>لم يرسل</option>' +
    '</select></label>' +
    '<label class="field"><span>من تاريخ</span><input type="date" data-f="from" value="' + escapeHtml(ff.from || '') + '"></label>' +
    '<label class="field"><span>إلى تاريخ</span><input type="date" data-f="to" value="' + escapeHtml(ff.to || '') + '"></label>' +
    '<label class="field"><span>بحث</span><input type="search" data-f="query" placeholder="اسم/ملاحظات" value="' + escapeHtml(ff.query || '') + '"></label>' +
    '<div class="filter-actions">' +
      '<button class="btn btn-primary" id="r-show">عرض التقرير</button>' +
      '<button class="btn btn-ghost" id="r-reset">إعادة ضبط</button>' +
    '</div>' +
  '</div>';
}

export function render(root, app) {
  ensureFilters();
  root.innerHTML =
    '<div class="card">' +
      '<h3>🔎 فلاتر التقرير</h3>' +
      controlsHtml(app) +
    '</div>' +
    '<div class="report-actions" id="r-actions"></div>' +
    '<div id="r-result">' + emptyState('اضبط الفلاتر ثم اضغط عرض التقرير') + '</div>';

  root.querySelectorAll('[data-f]').forEach((el) => {
    const ev = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => { f()[el.dataset.f] = el.value; });
  });

  root.querySelector('#r-show').addEventListener('click', () => runReport(root, app));
  root.querySelector('#r-reset').addEventListener('click', () => {
    App.reportFilters = {};
    resultCache = null;
    render(root, app);
  });

  if (resultCache) paintResult(root, app, resultCache);
}

function runReport(root, app) {
  const ff = f();
  const week = ff.weekStart ? (app.data.weeks || []).find((w) => w.start === ff.weekStart) : app.week;
  const statusRep = buildStatusReport(app.data.master, app.data.records, week, app.phones, ff.status || 'all');
  const recs = filterRecords(app.data.records, {
    supervisorNorm: ff.supervisorNorm,
    school: ff.school,
    type: ff.type,
    weekStart: ff.weekStart,
    query: ff.query,
    from: ff.from,
    to: ff.to,
  });
  const detail = flattenDetail(recs);
  resultCache = { week, statusRep, recs, detail, ff: { ...ff } };
  paintResult(root, app, resultCache);
}

function paintResult(root, app, res) {
  const { week, statusRep, detail } = res;
  const t = reportTable(statusRep.rows);
  const maxRows = 300;
  const shown = detail.slice(0, maxRows);

  const actions = root.querySelector('#r-actions');
  actions.innerHTML =
    '<div class="card report-head">' +
      '<div><h3>📊 تقرير حالة الإرسال' + (week ? ' — أسبوع ' + ltr(week.label) : ' — كل الأسابيع') + '</h3>' +
      '<p class="muted">عدد المشرفين في التقرير: ' + statusRep.rows.length + ' · صفوف التفاصيل: ' + detail.length + '</p></div>' +
      '<div class="btn-row">' +
        '<button class="btn btn-primary" id="r-xlsx">📊 تصدير Excel</button>' +
        '<button class="btn" id="r-csv">📄 تصدير CSV</button>' +
        '<button class="btn btn-accent" id="r-sheets">📤 تصدير البيانات إلى Google Sheets</button>' +
      '</div>' +
    '</div>';

  root.querySelector('#r-result').innerHTML =
    '<div class="card">' + tableHtml(t.head, t.body.map((r) => r.map((c, i) => {
      if (i === 5) return htmlCell('<span class="pill mini">' + escapeHtml(c) + '</span>');
      if (i === 1 || i === 4) return htmlCell(escapeHtml(ltr(c)));
      return c;
    }))) + '</div>' +
    '<div class="card"><h3>🗓 تفاصيل السجلات</h3>' +
      tableHtml(
        ['المشرف', 'الأسبوع', 'النوع', 'اليوم', 'المدرسة', 'الفعالية', 'الملاحظات', 'المصدر', 'الوقت'],
        shown.map((d) => [d.supervisor, ltr(d.week ? d.week.label : ''), d.type || '', d.dayLabel, d.school, d.activity, d.notes, d.source, d.timestamp])
      ) +
      (detail.length > maxRows ? '<p class="muted">يُعرض أول ' + maxRows + ' صفوف من ' + detail.length + ' — التصدير يشمل الكل.</p>' : '') +
    '</div>';

  actions.querySelector('#r-xlsx').addEventListener('click', () => doExcel(app, res));
  actions.querySelector('#r-csv').addEventListener('click', () => doCsv(app, res));
  actions.querySelector('#r-sheets').addEventListener('click', () => doSheets(app, res));
}

function doExcel(app, res) {
  try {
    const payload = {
      summary: res.statusRep.stats,
      statusRows: res.statusRep.rows,
      detailRows: res.detail,
      planningRows: res.recs.filter((r) => r.type === CFG.typePlanning),
      actualRows: res.recs.filter((r) => r.type === CFG.typeActual),
    };
    const name = 'EshrafProgramManager-' + (res.week ? res.week.label.replace(/\//g, '-') : 'all') + '.xlsx';
    exportExcel(name, payload);
    logAdd('تصدير Excel', name + ' · ' + res.statusRep.rows.length + ' مشرف · ' + res.detail.length + ' صف');
    toast('تم تصدير ملف Excel', 'ok');
  } catch (e) {
    toast('تعذّر التصدير: ' + (e.code === 'XLSX_MISSING' ? 'مكتبة Excel غير محمّلة' : e.message), 'error');
  }
}

function doCsv(app, res) {
  const rows = [['المشرف', 'الأسبوع', 'النوع', 'اليوم', 'المدرسة', 'الفعالية', 'الملاحظات', 'الكود', 'المصدر', 'الوقت']];
  for (const d of res.detail) {
    rows.push([d.supervisor, d.week ? d.week.label : '', d.type || '', d.dayLabel, d.school, d.activity, d.notes, d.code, d.source, d.timestamp]);
  }
  const name = 'EshrafProgramManager-' + (res.week ? res.week.label.replace(/\//g, '-') : 'all') + '.csv';
  downloadCsv(name, rows);
  logAdd('تصدير CSV', name + ' · ' + (rows.length - 1) + ' صف');
  toast('تم تنزيل CSV', 'ok');
}

async function doSheets(app, res) {
  if (App.role !== 'admin') {
    toast('التصدير إلى Google Sheets يتطلب صلاحية مدير', 'warn');
    return;
  }
  const week = res.week;
  if (!week) {
    toast('اختر أسبوعاً محدداً للتصدير إلى الأرشيف', 'error');
    return;
  }
  const adminRecords = (app.data.admin && app.data.admin.records) || [];
  const weekNew = (app.data.records || []).filter((r) => r.weekStart === week.start && r.source !== 'admin');
  const plan = buildExportPlan(adminRecords, weekNew, week);

  if (!plan.rows.length) {
    showModal({
      title: 'لا جديد للتصدير',
      body: '<p>كل سجلات أسبوع ' + escapeHtml(week.label) + ' موجودة بالفعل في الجدول (' + plan.skipped + ' مكرر تم تخطيه).</p>',
      actions: [{ label: 'حسنًا', cls: 'btn-primary' }],
    });
    return;
  }

  const marker = plan.keep.length ? plan.keep[0].supervisor : '';
  showModal({
    title: 'تأكيد التصدير إلى Google Sheets',
    body: '<ul class="export-summary">' +
      '<li>الأسبوع: <b>' + escapeHtml(week.label) + '</b></li>' +
      '<li>صفوف جديدة ستُضاف: <b class="t-green">' + plan.keep.length + '</b></li>' +
      '<li>صفوف مكررة ستُتخطى: <b>' + plan.skipped + '</b></li>' +
      '<li>سيُضاف رأس أسبوع جديد: <b>' + (plan.needsHeader ? 'نعم' : 'لا — الأسبوع موجود') + '</b></li>' +
      '<li>الوجهة: جدول الأرشيف <code>' + escapeHtml(CFG.sheetIds.admin.slice(0, 12)) + '…</code></li>' +
      '</ul><p class="muted">الكتابة تتم عبر Google Apps Script (رابط CSV للقراءة فقط). لن ندّعي النجاح قبل التحقق بإعادة قراءة الجدول.</p>',
    actions: [
      { label: 'إلغاء', cls: 'btn-ghost' },
      {
        label: 'تأكيد الإضافة',
        cls: 'btn-primary',
        onClick: async () => {
          const url = app.settings.appsScriptUrl;
          const res2 = await appendData({ rows: plan.rows, markerRow: marker, weekLabel: week.label, appsScriptUrl: url });
          if (!res2.ok) {
            logAdd('تصدير البيانات', 'فشل: ' + (res2.code || '') + ' ' + (res2.error || ''));
            if (res2.code === 'NOT_CONFIGURED') {
              showModal({
                title: 'ربط الكتابة غير مهيأ',
                body: '<p>للكتابة إلى Google Sheets يلزم نشر سكربت Apps Script من الملف <code>apps-script/AppendRows.gs</code> ثم لصق رابط الويب أب في الإعدادات.</p>',
                actions: [
                  { label: 'لاحقًا', cls: 'btn-ghost' },
                  { label: 'فتح الإعدادات', cls: 'btn-primary', onClick: () => go('settings') },
                ],
              });
            } else {
              toast('فشل التصدير: ' + res2.error, 'error');
            }
            return false;
          }
          const verify = await verifyAppendInCsv(marker, week.start);
          logAdd('تصدير البيانات', week.label + ' · أُضيف=' + res2.appended + ' · تخطي=' + res2.skipped + ' · تحقق=' + (verify.ok ? 'نجاح' : 'لم يتأكد'));
          if (verify.ok) {
            toast('تمت الإضافة والتحقق: ' + res2.appended + ' صفوف', 'ok');
          } else {
            toast('أفاد السكربت بإضافة ' + res2.appended + ' صفوف لكن لم يظهر التحقق بعد — أعد التحديث بعد قليل', 'warn');
          }
          await (async () => { const btn = document.querySelector('#btn-refresh'); if (btn) btn.click(); })();
          return true;
        },
      },
    ],
  });
}
