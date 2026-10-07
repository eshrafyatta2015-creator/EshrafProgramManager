/* 🩺 فحص سلامة البيانات — تشخيص مسار القراءة: المصدر ← الموقع
   يعرض آخر تحديث وحالة المصادر وإحصاءات الردود والفرق بين الملف والشاشة
   (قراءة طازجة بلا كاش) وسبب غياب كل صف لا يظهر في شاشة الأسبوع. */

import { CFG } from '../config.js';
import { escapeHtml, formatDateTime, ltr } from '../utils.js';
import { tableHtml, statCard, toast, emptyState } from './components.js';
import {
  getResponseRecords,
  getAllResponseRecords,
  responseStats,
  findMissingResponseRecords,
  compareSourceWithSite,
} from '../services/responsesService.js';
import { App, refresh } from './app.js';

let compareState = null; /* { ts, pending, result, error } — يعاد عند تغيّر البيانات */
let ctx = null; /* { root, app } لأي إعادة رسم لاحقة */
let missingOpen = false;
let missingRows = null;

function runCompare(force) {
  if (!ctx || !ctx.app.data) return;
  if (compareState && compareState.pending && !force) return;
  const app = ctx.app;
  const ts = app.data.ts || 0;
  compareState = { ts, pending: true, result: null, error: '' };
  render(ctx.root, app);
  compareSourceWithSite(app.data, app.week ? app.week.start : '')
    .then((res) => {
      compareState = { ts, pending: false, result: res, error: '' };
      render(ctx.root, app);
    })
    .catch((e) => {
      compareState = { ts, pending: false, result: null, error: String((e && e.message) || e) };
      toast('تعذّرت المقارنة مع المصدر: ' + compareState.error, 'error');
      render(ctx.root, app);
    });
}

function sourceBanner(data) {
  const sources = (data && data.sources) || {};
  const keys = Object.keys(sources);
  if (!keys.length) return '<p class="muted">لا توجد حالة مصادر بعد.</p>';
  const names = { lists: 'البيانات الأساسية', admin: 'الأرشيف', programs: 'ردود الاستمارة' };
  return keys.map((k) => {
    const s = sources[k];
    return '<span class="pill ' + (s.ok ? 'pill-ok' : 'pill-bad') + '">' +
      (s.ok ? '✓' : '✕') + ' ' + escapeHtml(names[k] || k) +
      (s.ok ? '' : ' — ' + escapeHtml(s.error || 'فشل')) + '</span>';
  }).join(' ');
}

function weekBreakdownRows(data) {
  const weeks = (data && data.weeks) || [];
  const prog = new Map();
  for (const r of getResponseRecords(data)) {
    const cur = prog.get(r.weekStart) || { total: 0, planning: 0, actual: 0 };
    cur.total++;
    if (r.type === CFG.typePlanning) cur.planning++;
    else if (r.type === CFG.typeActual) cur.actual++;
    prog.set(r.weekStart, cur);
  }
  const arch = new Map();
  for (const r of ((data && data.records) || [])) {
    if (r.source !== 'admin') continue;
    arch.set(r.weekStart, (arch.get(r.weekStart) || 0) + 1);
  }
  return weeks.map((w) => {
    const p = prog.get(w.start) || { total: 0, planning: 0, actual: 0 };
    return [ltr(w.label), ltr(w.start), String(p.total), String(p.planning), String(p.actual), String(arch.get(w.start) || 0)];
  });
}

export function render(root, app) {
  ctx = { root, app };
  if (!app.data) {
    root.innerHTML = '<div class="card">' + emptyState('لا توجد بيانات — استخدم تحديث البيانات') + '</div>';
    return;
  }

  const week = app.week;
  const all = getAllResponseRecords(app.data);
  const st = responseStats(app.data, week ? week.start : '');
  const cmp = compareState;

  if (!compareState || compareState.ts !== app.data.ts) {
    root.innerHTML = '<div class="card">' + emptyState('جارٍ مقارنة المصدر مع الموقع…') + '</div>';
    runCompare(false);
    return;
  }

  const result = cmp ? cmp.result : null;
  const diff = result ? result.weekDifference : null;
  const diffCls = diff === null ? 'card-total' : (diff === 0 ? 'card-planning' : 'card-missing');
  const diffIcon = diff === null ? '⏳' : (diff === 0 ? '✅' : '⚠');

  const compareCard =
    '<div class="card">' +
      '<h3>🔎 مقارنة المصدر مع الموقع</h3>' +
      '<p class="muted">قراءة طازجة من Google Sheets (بلا كاش) وتُقارن بما يعرضه التطبيق — الأسبوع المحدد: ' +
        (week ? '<b>' + escapeHtml(week.label) + '</b>' : '—') + '</p>' +
      (cmp && cmp.pending
        ? '<p class="muted">جارٍ المقارنة…</p>'
        : cmp && cmp.error
          ? '<div class="banner">⚠ تعذّرت المقارنة: ' + escapeHtml(cmp.error) + '</div>'
          : result
            ? '<div class="stats-grid">' +
                statCard({ icon: diffIcon, label: 'الفرق (المصدر − الموقع) لأسبوع العرض', value: diff === null ? '—' : diff, cls: diffCls }) +
                statCard({ icon: '📥', label: 'ردود الأسبوع في الملف', value: result.fileWeek, cls: 'card-total' }) +
                statCard({ icon: '🖥', label: 'ردود الأسبوع في الموقع', value: result.siteWeek, cls: 'card-planning' }) +
                statCard({ icon: '📊', label: 'الفرق الكلي (كل الأسابيع)', value: result.totalDifference, cls: result.totalDifference === 0 ? 'card-planning' : 'card-missing' }) +
              '</div>' +
              '<p class="muted">ترويسة الملف: ' +
                escapeHtml(result.headerWeek ? (result.headerWeek.label || result.headerWeek.start) : '—') +
                ' · صفوف خام: ' + result.rawRows + ' · ردود: ' + result.fileTotal +
                ' · مستبعد: ' + result.excluded.length + ' · إرسال مبكر (قبل بداية الأسبوع): ' + result.early + '</p>' +
              (result.excluded.length
                ? tableHtml(['صف', 'المشرف', 'الطابع الزمني', 'السبب'],
                    result.excluded.map((e) => [String(e.row), e.supervisor || '—', e.timestamp || '', e.reason]))
                : '')
            : '') +
    '</div>';

  const missingCard =
    '<div class="card">' +
      '<h3>🕵 الردود المفقودة عن شاشة الأسبوع</h3>' +
      '<div class="btn-row"><button class="btn btn-primary" id="dx-missing">' +
        (missingOpen ? 'إخفاء القائمة' : 'عرض الردود المفقودة') +
      '</button></div>' +
      (missingOpen
        ? missingRows && missingRows.length
          ? '<p class="muted">كل صف مع سببه — لا شيء يُخفى عن المدير.</p>' +
            tableHtml(['صف', 'المشرف', 'الطابع الزمني', 'الأسبوع', 'السبب'],
              missingRows.map((m) => [String(m.row), m.supervisor, m.timestamp || '', m.weekLabel || '—', m.reason]))
          : '<div class="banner">✓ لا ردود مفقودة: كل صفوف المصدر ظاهرة في شاشة الأسبوع</div>'
        : '') +
    '</div>';

  root.innerHTML =
    '<div class="card">' +
      '<h3>🩺 فحص سلامة البيانات</h3>' +
      '<p class="muted">آخر تحديث: ' + (all.lastUpdate ? escapeHtml(formatDateTime(new Date(all.lastUpdate))) : '—') +
        (all.offline ? ' · <b class="t-red">وضع عدم الاتصال (نسخة محفوظة)</b>' : '') + '</p>' +
      '<p>' + sourceBanner(app.data) + '</p>' +
      '<div class="btn-row">' +
        '<button class="btn btn-primary" id="dx-reload">⟳ إعادة قراءة البيانات</button>' +
        '<button class="btn" id="dx-compare">🔎 مقارنة المصدر مع الموقع</button>' +
      '</div>' +
    '</div>' +
    '<div class="card">' +
      '<h3>📊 إحصاءات الردود' + (week ? ' — أسبوع ' + escapeHtml(week.label) : '') + '</h3>' +
      '<div class="stats-grid">' +
        statCard({ icon: '📥', label: 'إجمالي ردود الأسبوع', value: st.totalResponses, cls: 'card-total' }) +
        statCard({ icon: '👥', label: 'مشرفون فريدون أرسلوا', value: st.uniqueSupervisors, cls: 'card-planning' }) +
        statCard({ icon: '🗓', label: 'ردود تخطيط', value: st.planningResponses, cls: 'card-planning' }) +
        statCard({ icon: '✅', label: 'ردود فعلي', value: st.actualResponses, cls: 'card-actual' }) +
        statCard({ icon: '⏳', label: 'مشرفون لم يرسلوا', value: st.missingSupervisors, cls: st.missingSupervisors ? 'card-missing' : 'card-planning' }) +
        statCard({ icon: '⚠', label: 'صفوف مستبعدة عند القراءة', value: st.excluded, cls: st.excluded ? 'card-missing' : 'card-planning' }) +
        statCard({ icon: '🔗', label: 'سجلات غير مطابقة', value: st.orphanRecords, cls: st.orphanRecords ? 'card-missing' : 'card-planning' }) +
        statCard({ icon: '🌅', label: 'ردود قبل بداية الأسبوع', value: st.early, cls: 'card-total' }) +
      '</div>' +
      '<p class="muted">صفوف المصدر الخام: ' + all.rawRows + ' · مستبعد: ' + all.excluded.length +
        ' · سجلات مقيّمة: ' + all.records.length + ' · ترويسة الملف: ' +
        escapeHtml(all.headerWeek ? all.headerWeek.label : '—') + '</p>' +
    '</div>' +
    compareCard +
    missingCard +
    '<div class="card">' +
      '<h3>🗓 التفصيل الأسبوعي (كل الأسابيع — بلا تقسيم)</h3>' +
      tableHtml(['الأسبوع', 'البداية', 'ردود الملف', 'تخطيط', 'فعلي', 'الأرشيف'], weekBreakdownRows(app.data)) +
    '</div>';

  const reloadBtn = root.querySelector('#dx-reload');
  if (reloadBtn) reloadBtn.addEventListener('click', () => { refresh(true, true); });
  const cmpBtn = root.querySelector('#dx-compare');
  if (cmpBtn) cmpBtn.addEventListener('click', () => runCompare(true));
  const missBtn = root.querySelector('#dx-missing');
  if (missBtn) missBtn.addEventListener('click', () => {
    missingOpen = !missingOpen;
    missingRows = missingOpen ? findMissingResponseRecords(App.data, App.week ? App.week.start : '') : missingRows;
    render(root, app);
  });
}
