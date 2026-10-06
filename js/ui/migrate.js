/* ترحيل بيانات الأسبوع — مسار الكتابة الوحيد إلى الأرشيف النهائي (Link1)
   معاينة ← تأكيد ← إضافة ← تحقق ← نتيجة. لا حذف ولا تعديل في أي مصدر. */

import { escapeHtml, ltr } from '../utils.js';
import { tableHtml, toast, showModal, emptyState, statCard } from './components.js';
import { buildMigratePreview, executeMigration, migrationHistoryRows } from '../services/archiveService.js';
import { flattenDetail } from '../services/reportService.js';
import { exportExcel } from '../services/exportService.js';
import { logAdd } from '../services/logService.js';
import { App, go, requireAdmin } from './app.js';

let preview = null;
let busy = false;

function selectedWeek(app) {
  const weeks = (app.data && app.data.weeks) || [];
  const start = App.migrateWeekStart || (app.week && app.week.start);
  return weeks.find((w) => w.start === start) || weeks[0] || app.week || null;
}

function previewHtml(p) {
  if (!p) return emptyState('اختر أسبوعاً ثم اضغط «معاينة الترحيل»');
  const t = p.types;
  const orphanList = p.orphanSupervisors || [];
  return '<div class="stats-grid">' +
    statCard({ icon: '📅', label: 'الأسبوع', value: p.week.label, cls: 'card-total', sub: p.week.start + ' → ' + p.week.end }) +
    statCard({ icon: '👥', label: 'المشرفون (القائمة المرجعية)', value: p.masterCount, cls: 'card-total' }) +
    statCard({ icon: '📥', label: 'سجلات الردود للأسبوع', value: p.responses, cls: 'card-planning' }) +
    statCard({ icon: '➕', label: 'سجلات جديدة ستُرحَّل', value: p.kept, cls: 'card-actual' }) +
    statCard({ icon: '⏭', label: 'مكررة ستُتخطى', value: p.skipped, cls: 'card-missing' }) +
    statCard({ icon: '⚠', label: 'سجلات يتيمة', value: p.orphans.length, cls: 'card-missing' }) +
    '</div>' +
    '<div class="card"><ul class="export-summary">' +
      '<li>الأسبوع: <b>' + escapeHtml(p.week.label) + '</b> (' + ltr(p.week.start + ' → ' + p.week.end) + ')</li>' +
      '<li>الوجهة: جدول الأرشيف النهائي <code>' + ltr('1rthlma…') + '</code> (إضافة فقط)</li>' +
      '<li>رأس أسبوع جديد في الأرشيف: <b>' + (p.needsHeader ? 'نعم' : 'لا — الأسبوع موجود') + '</b></li>' +
      '<li>المحتوى الجديد: تخطيط <b>' + ltr(String(t['تخطيط'] || 0)) + '</b> · فعلي <b>' + ltr(String(t['فعلي'] || 0)) +
        '</b> · بدون نوع <b>' + ltr(String(t.none || 0)) + '</b></li>' +
      (p.orphans.length
        ? '<li class="t-red">⚠ خارج القائمة المرجعية (تُرحَّل مع التحذير ولا يُحذف منها شيء): <b>' +
          ltr(String(p.orphans.length)) + '</b> صف — ' +
          escapeHtml(orphanList.map((o) => o.name).join('، ')) + '</li>'
        : '<li class="t-green">✓ كل السجلات تطابق قائمة المشرفين المرجعية</li>') +
      '<li>مصدر البيانات: ردود الاستمارة (لا يُحذف منه شيء)</li>' +
    '</ul></div>';
}

function historyHtml() {
  const rows = migrationHistoryRows(50);
  if (!rows.length) return emptyState('لا توجد عمليات ترحيل بعد');
  return tableHtml(['الوقت', 'النتيجة'], rows.map((r) => [ltr(r[0]), r[1]]));
}

export function render(root, app) {
  const week = selectedWeek(app);
  const weeks = (app.data && app.data.weeks) || [];
  const canRun = !!(preview && week && preview.week.start === week.start && preview.kept > 0);

  root.innerHTML =
    '<div class="card">' +
      '<h3>📦 ترحيل بيانات الأسبوع إلى الأرشيف النهائي</h3>' +
      '<p class="muted">يُنقل ما ورد في ردود الاستمارة إلى جدول الأرشيف النهائي (إضافة فقط — بلا حذف أو تعديل)، مع منع التكرار والتحقق بعد الكتابة.</p>' +
      '<div class="field-row">' +
        '<label class="field"><span>الأسبوع المراد ترحيله</span><select id="m-week">' +
          weeks.map((w) => '<option value="' + w.start + '"' + (week && w.start === week.start ? ' selected' : '') + '>أسبوع ' +
            ltr(w.label + ' (' + w.start + ' → ' + w.end + ')') + '</option>').join('') +
        '</select></label>' +
        '<div class="btn-row">' +
          '<button class="btn btn-primary" id="m-preview">🔎 معاينة الترحيل</button>' +
          '<button class="btn btn-accent" id="m-run"' + (canRun ? '' : ' disabled') + '>📦 تنفيذ الترحيل</button>' +
          '<button class="btn" id="m-xlsx"' + (preview && preview.kept ? '' : ' disabled') + '>📊 تصدير Excel للمرحّل</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div id="m-preview-out">' + previewHtml(preview && week && preview.week.start === week.start ? preview : null) + '</div>' +
    '<div class="card"><h3>🧾 سجل عمليات الترحيل</h3><div id="m-history">' + historyHtml() + '</div></div>';

  root.querySelector('#m-week').addEventListener('change', (e) => {
    App.migrateWeekStart = e.target.value;
    if (preview && preview.week.start !== App.migrateWeekStart) preview = null;
    render(root, app);
  });

  root.querySelector('#m-preview').addEventListener('click', () => doPreview(app));
  root.querySelector('#m-run').addEventListener('click', () => doRun(app));
  root.querySelector('#m-xlsx').addEventListener('click', () => doExcel(app));
}

function doPreview(app) {
  const w = selectedWeek(app);
  if (!w) { toast('لا توجد أسابيع في البيانات', 'error'); return; }
  App.migrateWeekStart = w.start;
  preview = buildMigratePreview(app.data, w);
  logAdd('معاينة الترحيل', w.label + ' · جديد=' + preview.kept + ' · مكرر=' + preview.skipped + ' · يتيمة=' + preview.orphans.length);
  const root = document.querySelector('#tab-migrate');
  root.querySelector('#m-preview-out').innerHTML = previewHtml(preview);
  root.querySelector('#m-run').disabled = !(preview.kept > 0);
  root.querySelector('#m-xlsx').disabled = preview.kept === 0;
  root.querySelector('#m-history').innerHTML = historyHtml();
  toast(preview.kept
    ? 'المعاينة جاهزة: ' + preview.kept + ' سجل جديد' + (preview.skipped ? ' (تخطي ' + preview.skipped + ')' : '')
    : 'لا جديد — كل السجلات مرحّلة أو لا ردود لهذا الأسبوع', preview.kept ? 'ok' : 'warn');
}

async function doRun(app) {
  if (!requireAdmin('ترحيل البيانات')) return;
  const w = selectedWeek(app);
  if (!preview || preview.week.start !== (w && w.start)) {
    toast('اضغط «معاينة الترحيل» أولاً للأسبوع المحدد', 'warn');
    return;
  }
  if (!preview.kept) { toast('لا توجد سجلات جديدة للترحيل', 'warn'); return; }
  if (busy) return;

  showModal({
    title: 'تأكيد ترحيل بيانات الأسبوع',
    body: '<ul class="export-summary">' +
      '<li>الأسبوع: <b>' + escapeHtml(preview.week.label) + '</b> — من <b>' + ltr(preview.week.start) + '</b> إلى <b>' + ltr(preview.week.end) + '</b></li>' +
      '<li>عدد المشرفين في القائمة المرجعية: <b>' + ltr(String(preview.masterCount)) + '</b></li>' +
      '<li>عدد السجلات الجديدة التي ستُضاف: <b class="t-green">' + ltr(String(preview.kept)) + '</b></li>' +
      '<li>سجلات مكررة ستُتخطى: <b>' + ltr(String(preview.skipped)) + '</b></li>' +
      '<li>الوجهة: الأرشيف النهائي — إضافة فقط (لا حذف/لا تعديل، ولا يُحذف من الردود)</li>' +
      (preview.orphans.length ? '<li class="t-red">تحذير: ' + ltr(String(preview.orphans.length)) + ' صف لمشرف خارج القائمة سيُرحَّل كذلك</li>' : '') +
      '</ul><p class="muted">لن ندّعي النجاح قبل التحقق بإعادة قراءة الأرشيف.</p>',
    actions: [
      { label: 'إلغاء', cls: 'btn-ghost' },
      {
        label: 'ترحيل الآن',
        cls: 'btn-primary',
        onClick: async () => {
          const closeConfirm = await runMigration(app);
          return closeConfirm;
        },
      },
    ],
  });
}

async function runMigration(app) {
  busy = true;
  const root = document.querySelector('#tab-migrate');
  const runBtn = root && root.querySelector('#m-run');
  if (runBtn) runBtn.disabled = true;
  try {
    const res = await executeMigration({ preview, week: preview.week, appsScriptUrl: app.settings.appsScriptUrl });
    if (!res.ok) {
      logAdd('ترحيل الأسبوع', 'فشل ' + preview.week.label + ': ' + (res.code || '') + ' ' + (res.error || ''));
      if (res.code === 'NOT_CONFIGURED') {
        showModal({
          title: 'ربط الكتابة غير مهيأ',
          body: '<p>للكتابة إلى الأرشيف يلزم نشر سكربت <code>apps-script/AppendRows.gs</code> كتطبيق ويب ثم لصق الرابط في الإعدادات.</p>',
          actions: [
            { label: 'لاحقًا', cls: 'btn-ghost' },
            { label: 'فتح الإعدادات', cls: 'btn-primary', onClick: () => go('settings') },
          ],
        });
        return false;
      }
      toast(res.code === 'EMPTY' ? res.error : 'فشل الترحيل: ' + (res.error || res.code), res.code === 'EMPTY' ? 'warn' : 'error');
      return true;
    }
    const detail = 'الأسبوع ' + preview.week.label +
      ' · أُضيف=' + res.appended + ' · تخطي=' + res.skipped +
      ' · تحقق=' + (res.verifyOk ? 'نجاح' : 'لم يتأكد') +
      ' · زمن=' + res.ms + 'ms';
    logAdd('ترحيل الأسبوع', detail);
    const orphNote = preview.orphans.length
      ? '<p class="t-red">⚠ ضمنها ' + ltr(String(preview.orphans.length)) + ' صف لمشرف خارج القائمة المرجعية (لم يُحذف شيء).</p>' : '';
    showModal({
      title: res.verifyOk ? '✅ تم الترحيل بنجاح' : '⚠ أُضيف ولم يتأكد التحقق بعد',
      body: '<ul class="export-summary">' +
        '<li>الأسبوع: <b>' + escapeHtml(preview.week.label) + '</b></li>' +
        '<li>السجلات المُضاف: <b class="t-green">' + ltr(String(res.appended)) + '</b></li>' +
        '<li>المكررة المُتخطاة: <b>' + ltr(String(res.skipped)) + '</b></li>' +
        '<li>زمن التنفيذ: <b>' + ltr(String(res.ms)) + ' ms</b></li>' +
        '<li>التحقق من الأرشيف: <b class="' + (res.verifyOk ? 't-green' : 't-red') + '">' +
          (res.verifyOk ? 'تم العثور على السجلات ✅' : 'لم يظهر بعد — أعد التحديث بعد قليل') + '</b></li>' +
        '</ul>' + orphNote,
      actions: [{ label: 'حسنًا', cls: 'btn-primary' }],
    });
    preview = null;
    const btn = document.querySelector('#btn-refresh');
    if (btn) btn.click();
    return false;
  } catch (e) {
    const msg = String((e && e.message) || e);
    logAdd('ترحيل الأسبوع', 'خطأ غير متوقع: ' + msg);
    toast('خطأ غير متوقع أثناء الترحيل: ' + msg, 'error');
    return true;
  } finally {
    busy = false;
  }
}

function doExcel(app) {
  if (!preview || !preview.kept) { toast('اعمل معاينة أولاً', 'warn'); return; }
  try {
    const payload = {
      summary: app.status.stats,
      migratedRows: flattenDetail(preview.plan.keep),
      statusRows: app.status.rows,
    };
    const name = 'Eshraf-ترحيل-' + preview.week.label.replace(/\//g, '-') + '.xlsx';
    exportExcel(name, payload);
    logAdd('تصدير Excel للمرحّل', name + ' · ' + preview.kept + ' سجل');
    toast('تم تصدير ملف الترحيل', 'ok');
  } catch (e) {
    toast('تعذّر التصدير: ' + (e.code === 'XLSX_MISSING' ? 'مكتبة Excel غير محمّلة' : e.message), 'error');
  }
}
