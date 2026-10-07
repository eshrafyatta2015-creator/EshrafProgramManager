/* ترحيل بيانات الأسبوع — المسار الآمن §38:
   معاينة ← تأكيد الترحيل والحذف ← إضافة للأرشيف ← تحقق ← حذف من الردود ← تحقق ← الأسبوع التالي.
   لا يُحذف أي صف من الردود قبل إثبات وصوله للأرشيف. */

import { CFG } from '../config.js';
import { escapeHtml, ltr } from '../utils.js';
import { tableHtml, toast, showModal, emptyState, statCard, htmlCell } from './components.js';
import {
  buildMigratePreview, executeMigration, migrationHistoryRows, migrationList,
  pendingDeleteEntry, retryDelete,
} from '../services/migrationService.js';
import { flattenDetail } from '../services/reportService.js';
import { exportExcel } from '../services/exportService.js';
import { nextWeek as nextWeekOf } from '../services/weekService.js';
import { logAdd } from '../services/logService.js';
import { App, go, requireAdmin } from './app.js';

let preview = null;
let includeOrphans = false;
let busy = false;

function selectedWeek(app) {
  const weeks = (app.data && app.data.weeks) || [];
  const start = App.migrateWeekStart || (app.week && app.week.start);
  return weeks.find((w) => w.start === start) || weeks[0] || app.week || null;
}

function previewHtml(p) {
  if (!p) return emptyState('اختر أسبوعاً ثم اضغط «معاينة الترحيل»');
  const t = p.types;
  const nk = p.nextWeek;
  const orphanNames = (p.orphanSupervisors || []).map((o) => o.name).join('، ');
  return '<div class="stats-grid">' +
    statCard({ icon: '📅', label: 'الأسبوع الحالي', value: p.week.label, cls: 'card-total', sub: p.week.start + ' → ' + p.week.end }) +
    (nk ? statCard({ icon: '⏭', label: 'الأسبوع التالي (+7)', value: nk.label, cls: 'card-planning', sub: nk.start + ' → ' + nk.end }) : '') +
    statCard({ icon: '👥', label: 'المشرفون (البيانات الأساسية)', value: p.masterCount, cls: 'card-total' }) +
    statCard({ icon: '📥', label: 'سجلات الردود للأسبوع', value: p.responses, cls: 'card-planning' }) +
    statCard({ icon: '➕', label: 'سجلات جديدة ستُرحَّل', value: p.kept, cls: 'card-actual' }) +
    statCard({ icon: '⏭', label: 'مكررة ستُتخطى', value: p.skipped, cls: 'card-missing' }) +
    statCard({ icon: '⚠', label: 'سجلات يتيمة', value: p.orphans.length, cls: 'card-missing' }) +
    statCard({ icon: '📤', label: 'أرسلوا التخطيط', value: p.planningSenders, cls: 'card-planning' }) +
    statCard({ icon: '📤', label: 'أرسلوا الفعلي', value: p.actualSenders, cls: 'card-actual' }) +
    '</div>' +
    (p.alreadyMigrated
      ? '<div class="banner orphan-banner">' + CFG.texts.alreadyMigrated +
        ' — كل سجلات هذا الأسبوع موجودة في الأرشيف' +
        ' <button class="btn btn-sm" id="m-history-open">عرض تفاصيل الترحيل</button></div>'
      : '') +
    '<div class="card"><ul class="export-summary">' +
      '<li>الأسبوع الحالي: <b>' + escapeHtml(p.week.label) + '</b> (' + ltr(p.week.start + ' → ' + p.week.end) + ')</li>' +
      (nk ? '<li>الأسبوع التالي: <b>' + escapeHtml(nk.label) + '</b> (' + ltr(nk.start + ' → ' + nk.end) + ') — '+ CFG.texts.nextWeekReady + '</li>' : '') +
      '<li>الوجهة: إضافة إلى جدول الأرشيف النهائي <code>' + ltr('1rthlma…') + '</code> ثم <b>الحذف من الردود بعد التحقق فقط</b></li>' +
      '<li>ترويسة رأس الملف (Header): ' +
        (p.headerNeeded ? '<b>تُكتب الآن</b> (الملف فارغ — ترويسة واحدة أعلى الملف، لا ترويسة لكل أسبوع)'
          : 'موجودة — تُضاف الصفوف تحتها مباشرةً') +
        ' · المصدر: ' + (p.headerOrigin === 'live' ? 'ملف الردود' : p.headerOrigin === 'snapshot' ? 'نسخة Header محفوظة' : 'افتراضي') +
        (p.headerOk ? ' ✅' : ' ⚠') + '</li>' +
      '<li>المحتوى الجديد: تخطيط <b>' + ltr(String(t['تخطيط'] || 0)) + '</b> · فعلي <b>' + ltr(String(t['فعلي'] || 0)) +
        '</b> · بدون نوع <b>' + ltr(String(t.none || 0)) + '</b></li>' +
      '<li>أرسلوا التخطيط: <b>' + ltr(String(p.planningSenders)) + '</b> · أرسلوا الفعلي: <b>' + ltr(String(p.actualSenders)) + '</b></li>' +
      '<li>سجلات هذا الأسبوع في الأرشيف: <b>' + ltr(String(p.archiveWeekCount)) + '</b></li>' +
      (p.orphans.length
        ? '<li class="t-red">' + CFG.texts.orphanWarning + ': <b>' + ltr(String(p.orphans.length)) +
          '</b> صف — ' + escapeHtml(orphanNames) + '<br>' +
          '<label class="orph-opt"><input type="checkbox" id="m-orphans"' + (p.includeOrphans ? ' checked' : '') +
          '> ترحيل السجلات غير المطابقة أيضاً (يتطلب هذا التأكيد — لن تُرحَّل تلقائياً)</label></li>'
        : '<li class="t-green">✓ كل سجلات الردود تطابق أسماء البيانات الأساسية</li>') +
      '<li>مصدر البيانات: ردود الاستمارة (تُقرأ الآن — لا يُحذف منها إلا بعد التحقق)</li>' +
    '</ul></div>';
}

function historyHtml() {
  const rows = migrationHistoryRows(50);
  if (!rows.length) return emptyState('لا توجد عمليات ترحيل بعد');
  const entries = migrationList().slice(0, 50);
  return tableHtml(['الوقت', 'الأسبوع', 'السجلات', 'المحذوف من الردود', 'الحالة', 'المستخدم'],
    rows.map((r, i) => {
      const e = entries[i];
      const status = e && e.pendingDelete && e.pendingDelete.length
        ? htmlCell('<b>' + escapeHtml(r[4]) + '</b> <button class="btn btn-sm" data-retry="' + escapeHtml(e.id) + '">🔁 إعادة محاولة الحذف</button>')
        : escapeHtml(r[4]);
      return [ltr(r[0]), ltr(r[1]), r[2], ltr(r[3]), status, r[5]];
    }));
}

export function render(root, app) {
  const week = selectedWeek(app);
  const weeks = (app.data && app.data.weeks) || [];
  const canRun = !!(preview && week && preview.week.start === week.start && preview.kept > 0 && !preview.alreadyMigrated);

  root.innerHTML =
    '<div class="card">' +
      '<h3>📦 ترحيل بيانات الأسبوع إلى الأرشيف النهائي</h3>' +
      '<p class="muted">مسار آمن: إضافة إلى الأرشيف ← تحقق بإعادة القراءة ← حذف الصفوف المرحّلة من الردود ← تحقق من الحذف ← تجهيز الأسبوع التالي (+7 أيام). لا يُحذف شيء قبل إثبات الوصول.</p>' +
      '<div class="field-row">' +
        '<label class="field"><span>الأسبوع المراد ترحيله</span><select id="m-week">' +
          weeks.map((w) => '<option value="' + w.start + '"' + (week && w.start === week.start ? ' selected' : '') + '>أسبوع ' +
            ltr(w.label + ' (' + w.start + ' → ' + w.end + ')') + '</option>').join('') +
        '</select></label>' +
        '<div class="btn-row">' +
          '<button class="btn btn-primary btn-lg" id="m-preview">🔎 معاينة الترحيل</button>' +
          '<button class="btn btn-accent btn-lg" id="m-run"' + (canRun ? '' : ' disabled') + '>✅ ' + CFG.texts.confirmMigrate + '</button>' +
          '<button class="btn" id="m-xlsx"' + (preview && preview.kept ? '' : ' disabled') + '>📊 تصدير Excel للمرحّل</button>' +
        '</div>' +
      '</div>' +
      (week ? '<p class="muted">الأسبوع الحالي: <b>' + escapeHtml(week.label) + '</b> · الأسبوع التالي (+7 أيام): <b>' +
        escapeHtml((nextWeekOf(week) || {}).label || '—') + '</b></p>' : '') +
    '</div>' +
    '<div id="m-preview-out">' + previewHtml(preview && week && preview.week.start === week.start ? preview : null) + '</div>' +
    '<div class="card"><h3>🧾 سجل عمليات الترحيل</h3>' +
      '<p class="muted">الأسبوع · الوقت · عدد السجلات · المحذوف من الردود · الحالة · المستخدم (§29)</p>' +
      '<div id="m-history">' + historyHtml() + '</div></div>';

  root.querySelector('#m-week').addEventListener('change', (e) => {
    App.migrateWeekStart = e.target.value;
    if (preview && preview.week.start !== App.migrateWeekStart) preview = null;
    render(root, app);
  });

  root.querySelector('#m-preview').addEventListener('click', () => doPreview(app));
  root.querySelector('#m-run').addEventListener('click', () => doRun(app));
  root.querySelector('#m-xlsx').addEventListener('click', () => doExcel(app));
  bindHistory(root, app);
}

function bindHistory(root, app) {
  root.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', () => doRetry(b.dataset.retry, app)));
  const open = root.querySelector('#m-history-open');
  if (open) open.addEventListener('click', () => showHistoryModal());
}

function doPreview(app) {
  const w = selectedWeek(app);
  if (!w) { toast('لا توجد أسابيع في البيانات', 'error'); return; }
  App.migrateWeekStart = w.start;
  preview = buildMigratePreview(app.data, w, { includeOrphans });
  logAdd('معاينة الترحيل', w.label + ' · جديد=' + preview.kept + ' · مكرر=' + preview.skipped +
    ' · يتيمة=' + preview.orphans.length + (preview.alreadyMigrated ? ' · مرحّل سابقاً' : ''));
  const root = document.querySelector('#tab-migrate');
  root.querySelector('#m-preview-out').innerHTML = previewHtml(preview);
  root.querySelector('#m-run').disabled = !(preview.kept > 0 && !preview.alreadyMigrated);
  root.querySelector('#m-xlsx').disabled = preview.kept === 0;
  root.querySelector('#m-history').innerHTML = historyHtml();
  bindHistory(root, app);

  const orph = root.querySelector('#m-orphans');
  if (orph) orph.addEventListener('change', () => {
    includeOrphans = orph.checked;
    doPreview(app);
    toast(includeOrphans ? 'سيُرحَّل السجلات غير المطابقة أيضاً (بعد التأكيد)' : 'لن تُرحَّل السجلات غير المطابقة', 'warn');
  });

  if (preview.alreadyMigrated) toast(CFG.texts.alreadyMigrated, 'warn');
  else toast(preview.kept
    ? 'المعاينة جاهزة: ' + preview.kept + ' سجل جديد' + (preview.skipped ? ' (تخطي ' + preview.skipped + ')' : '')
    : 'لا جديد — كل السجلات مرحّلة أو لا ردود لهذا الأسبوع', preview.kept ? 'ok' : 'warn');
}

function doRun(app) {
  if (!requireAdmin('ترحيل البيانات')) return;
  const w = selectedWeek(app);
  if (!preview || preview.week.start !== (w && w.start)) {
    toast('اضغط «معاينة الترحيل» أولاً للأسبوع المحدد', 'warn');
    return;
  }
  if (!preview.kept) { toast('لا توجد سجلات جديدة للترحيل', 'warn'); return; }
  if (preview.alreadyMigrated) { toast(CFG.texts.alreadyMigrated, 'warn'); return; }
  if (busy) return;

  const p = preview;
  const nk = p.nextWeek;
  showModal({
    title: 'تأكيد ترحيل بيانات الأسبوع',
    body: '<ul class="export-summary">' +
      '<li>الأسبوع: <b>' + escapeHtml(p.week.label) + '</b> — من <b>' + ltr(p.week.start) + '</b> إلى <b>' + ltr(p.week.end) + '</b></li>' +
      (nk ? '<li>الأسبوع التالي بعد الترحيل: <b>' + escapeHtml(nk.label) + '</b> (' + ltr(nk.start + ' → ' + nk.end) + ') — '+ CFG.texts.nextWeekReady + '</li>' : '') +
      '<li>عدد المشرفين في البيانات الأساسية: <b>' + ltr(String(p.masterCount)) + '</b></li>' +
      '<li>عدد السجلات الجديدة التي ستُضاف: <b class="t-green">' + ltr(String(p.kept)) + '</b></li>' +
      '<li>سجلات مكررة ستُتخطى: <b>' + ltr(String(p.skipped)) + '</b></li>' +
      '<li>التسلسل: <b>إضافة إلى الأرشيف ← تحقق بعدّاد ومفاتيح ← الحذف من الردود ← تحقق من الحذف ← الأسبوع التالي</b></li>' +
      '<li class="t-red">تنبيه: لن يُحذف أي صف من الردود إلا بعد إثبات وصوله للأرشيف.</li>' +
      (p.orphans.length
        ? '<li class="t-red">' + CFG.texts.orphanWarning + ': <b>' + ltr(String(p.orphans.length)) + '</b> صف — ' +
          (p.includeOrphans ? 'ستُرحَّل (مؤكَّد) ضمن هذه العملية' : '<b>لن تُرحَّل</b>') + '</li>'
        : '') +
      '</ul>',
    actions: [
      { label: CFG.texts.cancel, cls: 'btn-ghost' },
      {
        label: '✅ ' + CFG.texts.confirmMigrate,
        cls: 'btn-primary',
        onClick: async () => runMigration(app),
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
    const res = await executeMigration({
      preview,
      week: preview.week,
      data: app.data,
      appsScriptUrl: app.settings.appsScriptUrl,
      includeOrphans: preview.includeOrphans,
      user: app.role === 'admin' ? 'مدير' : 'عارض',
    });

    if (!res.ok) {
      if (!res.logged) logAdd('ترحيل الأسبوع', 'فشل ' + preview.week.label + ': ' + (res.code || '') + ' ' + (res.error || ''));
      if (res.code === 'NOT_CONFIGURED') {
        showModal({
          title: 'ربط الكتابة غير مهيأ',
          body: '<p>للكتابة إلى الأرشيف يلزم نشر سكربت <code>apps-script/AppendRows.gs</code> كتطبيق ويب ثم لصق الرابط في الإعدادات.</p>' +
            '<p class="muted">لم يُحذف أي شيء من الردود.</p>',
          actions: [
            { label: 'لاحقًا', cls: 'btn-ghost' },
            { label: 'فتح الإعدادات', cls: 'btn-primary', onClick: () => go('settings') },
          ],
        });
        return false;
      }
      if (res.code === 'ALREADY_MIGRATED') {
        showModal({
          title: CFG.texts.alreadyMigrated,
          body: '<p>كل سجلات هذا الأسبوع موجودة في الأرشيف النهائي، ولم يُحذف أي شيء.</p>',
          actions: [
            { label: 'حسنًا', cls: 'btn-ghost' },
            { label: 'عرض تفاصيل الترحيل', cls: 'btn-primary', onClick: showHistoryModal },
          ],
        });
        return false;
      }
      if (res.code === 'VERIFY_FAILED') {
        const text = res.verify && res.verify.found >= 0 && res.verify.found < res.verify.expected
          ? CFG.texts.failKeepResponses
          : CFG.texts.incompleteKeepResponses;
        showModal({
          title: 'لم يكتمل الترحيل',
          body: '<p class="t-red">' + text + '</p>' +
            '<ul class="export-summary">' +
            '<li>المرجح في الأرشيف: <b>' + ltr(String(res.verify ? res.verify.found : 0)) + '</b> من <b>' +
              ltr(String(res.verify ? res.verify.expected : 0)) + '</b></li>' +
            (res.verify && res.verify.countDelta !== undefined
              ? '<li>فارق العدد قبل/بعد: <b>' + ltr(String(res.verify.countDelta)) + '</b> (المضاف=' +
                ltr(String(res.appended || 0)) + ')</li>' : '') +
            '</ul>',
          actions: [{ label: 'حسنًا', cls: 'btn-primary' }],
        });
        return true;
      }
      const text = res.code === 'EMPTY' ? (res.error || 'لا توجد سجلات جديدة للترحيل.') : CFG.texts.failKeepResponses;
      toast(res.code === 'EMPTY' ? text : 'فشل الترحيل: ' + (res.error || res.code), res.code === 'EMPTY' ? 'warn' : 'error');
      if (res.code !== 'EMPTY') {
        showModal({
          title: 'فشل الترحيل',
          body: '<p class="t-red">' + text + '</p><p class="muted">' + escapeHtml(res.error || res.code || '') + '</p>',
          actions: [{ label: 'حسنًا', cls: 'btn-primary' }],
        });
      }
      return true;
    }

    /* نجاح (كلي أو جزئي في الحذف) */
    const orphNote = preview.orphans.length && !preview.includeOrphans
      ? '<p class="t-red">' + CFG.texts.orphanWarning + ': ' + ltr(String(preview.orphans.length)) + ' صف بقي في الردود (لم يُرحَّل).</p>'
      : '';
    const partial = res.partialDelete || !res.deleteOk;
    showModal({
      title: partial ? '⚠ الترحيل والأرشيف مكتملان — الحذف لم يكتمل' : '✅ تم الترحيل بنجاح',
      body: '<ul class="export-summary">' +
        '<li>الأسبوع: <b>' + escapeHtml(preview.week.label) + '</b></li>' +
        '<li>تم ترحيل <b class="t-green">' + ltr(String(res.verify.expected)) + '</b> سجل إلى الأرشيف (تحقق ' +
          ltr(String(res.verify.found) + '/' + res.verify.expected) + ' ✅)</li>' +
        '<li>أُضيف حديثاً: <b>' + ltr(String(res.appended)) + '</b> · مكرر مُتخطى: <b>' + ltr(String(res.skipped)) + '</b>' +
          (res.headerWritten ? ' · كُتب رأس الملف (Header)' : '') + '</li>' +
        '<li>تم حذف <b class="' + (partial ? 't-red' : 't-green') + '">' +
          ltr(String(res.deleted) + ' من ' + res.deleteExpected) + '</b> صف من الردود' +
          (res.headerPresent ? ' · الترويسة سليمة ✅' : ' · ⚠ الترويسة ناقصة') + '</li>' +
        (res.nextWeek ? '<li>' + CFG.texts.nextWeekReady + ': <b>' + escapeHtml(res.nextWeek.label) + '</b> (' +
          ltr(res.nextWeek.start + ' → ' + res.nextWeek.end) + ')</li>' : '') +
        '<li>الحالة في السجل: <b>' + escapeHtml(res.entry ? res.entry.status : '—') + '</b> · المستخدم: <b>' +
          escapeHtml(res.entry ? res.entry.user : '—') + '</b></li>' +
        '<li>زمن التنفيذ: <b>' + ltr(String(res.ms)) + ' ms</b></li>' +
        '</ul>' +
        (partial ? '<p class="t-red">⚠ الحذف من الردود لم يكتمل (متبقي ' +
          ltr(String(res.remaining != null ? res.remaining : res.deleteExpected - res.deleted)) +
          ') — بياناتك آمنة في الأرشيف، ويمكنك إعادة المحاولة من سجل الترحيل.</p>' : '') +
        orphNote,
      actions: [
        { label: 'عرض السجل', cls: 'btn-ghost', onClick: showHistoryModal },
        { label: 'حسنًا', cls: 'btn-primary' },
      ],
    });

    if (res.nextWeek) App.migrateWeekStart = res.nextWeek.start;
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

function showHistoryModal() {
  const rows = migrationHistoryRows(30);
  showModal({
    title: 'سجل عمليات الترحيل',
    wide: true,
    body: rows.length
      ? tableHtml(['الوقت', 'الأسبوع', 'السجلات', 'المحذوف', 'الحالة', 'المستخدم'],
          rows.map((r) => [ltr(r[0]), ltr(r[1]), r[2], ltr(r[3]), r[4], r[5]]))
      : emptyState('لا توجد عمليات ترحيل بعد'),
    actions: [{ label: 'إغلاق', cls: 'btn-primary' }],
  });
  return true;
}

async function doRetry(id, app) {
  if (!requireAdmin('إعادة محاولة الحذف')) return;
  const entry = migrationList().find((e) => e.id === id);
  if (!entry) return;
  if (!app.settings.appsScriptUrl) { toast('اربط Apps Script أولاً (الإعدادات)', 'warn'); go('settings'); return; }
  const res = await retryDelete(entry, app.settings.appsScriptUrl);
  if (res.nothing) toast('لا يوجد حذف متبقي', 'ok');
  else if (res.ok) toast('✅ اكتمل الحذف المتبقي من الردود', 'ok');
  else toast('لم يكتمل الحذف: ' + (res.error || ('متبقي=' + res.remaining)), 'warn');
  const root = document.querySelector('#tab-migrate');
  if (root) {
    root.querySelector('#m-history').innerHTML = historyHtml();
    bindHistory(root, app);
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
