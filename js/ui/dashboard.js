/* Dashboard — البطاقات الإحصائية */

import { CFG } from '../config.js';
import { escapeHtml, ltr } from '../utils.js';
import { statCard, statusPill, emptyState } from './components.js';
import { App, go, renderHeaderMeta } from './app.js';

export function render(root, app) {
  const st = app.status;
  const s = st.stats;
  const missing = st.rows.filter((r) => !r.sentPlanning && !r.sentActual);
  const missingPlanning = st.rows.filter((r) => !r.sentPlanning);
  const missingActual = st.rows.filter((r) => !r.sentActual);
  const complete = st.rows.filter((r) => r.sentPlanning && r.sentActual).length;
  const incomplete = s.total - complete;

  root.innerHTML =
    '<div class="dash-title">' +
      '<h2>' + escapeHtml(CFG.displayName) + '</h2>' +
      '<p class="dash-sub">' + escapeHtml(CFG.headerLine1) + '<br>' + escapeHtml(CFG.headerLine2) + '</p>' +
      (app.week ? '<p class="dash-week">الأسبوع المحدد: <b>' + ltr(app.week.label) + '</b> (' + ltr(app.week.start + ' → ' + app.week.end) + ')</p>' : '') +
    '</div>' +
    '<div class="stats-grid">' +
      statCard({ icon: '👥', label: 'إجمالي المشرفين', value: s.total, cls: 'card-total' }) +
      statCard({ icon: '🟠', label: 'أرسلوا التخطيط', value: s.planning, cls: 'card-planning' }) +
      statCard({ icon: '⛔', label: 'لم يرسلوا التخطيط', value: s.notPlanning, cls: 'card-missing' }) +
      statCard({ icon: '🔵', label: 'أرسلوا الفعلي', value: s.actual, cls: 'card-actual' }) +
      statCard({ icon: '⛔', label: 'لم يرسلوا الفعلي', value: s.notActual, cls: 'card-missing' }) +
      statCard({ icon: '🟢', label: 'مكتمل (التخطيط والفعلي)', value: complete, cls: 'card-rate' }) +
      statCard({ icon: '🔴', label: 'غير مكتمل', value: incomplete, cls: 'card-missing' }) +
      statCard({ icon: '📈', label: 'نسبة الإنجاز', value: s.completion + '%', cls: 'card-rate', sub: '(تخطيط+فعلي ÷ المطلوب)' }) +
    '</div>' +
    '<div class="progress-wrap"><div class="progress"><div class="progress-bar" style="width:' +
      Math.max(0, Math.min(100, s.completion)) + '%"></div></div>' +
      '<span class="progress-label">' + s.completion + '%</span></div>' +
    '<div class="dash-grid">' +
      '<div class="card">' +
        '<div class="card-head"><h3>🔴 لم يرسلوا أي برنامج (' + missing.length + ')</h3>' +
        '<button class="btn btn-sm" data-action="open-none">عرض الكل</button></div>' +
        '<div class="mini-list">' + (missing.length
          ? missing.slice(0, 8).map((r) =>
              '<div class="mini-row"><span>' + escapeHtml(r.name) + '</span>' + statusPill(r.status) + '</div>').join('')
          : emptyState('أرسل الجميع برامجهم لهذا الأسبوع 🎉')) +
        '</div>' +
        (missing.length > 8 ? '<div class="mini-more">و' + (missing.length - 8) + ' آخرين…</div>' : '') +
      '</div>' +
      '<div class="card">' +
        '<div class="card-head"><h3>🟠 ناقص تخطيط (' + missingPlanning.length + ') · 🔵 ناقص فعلي (' + missingActual.length + ')</h3></div>' +
        '<div class="mini-list">' +
          '<div class="mini-row"><span>لم يرسلوا التخطيط</span><b class="t-red">' + s.notPlanning + '</b></div>' +
          '<div class="mini-row"><span>لم يرسلوا الفعلي</span><b class="t-red">' + s.notActual + '</b></div>' +
          '<div class="mini-row"><span>أكملوا الاثنين</span><b class="t-green">' + st.rows.filter((r) => r.status.key === 'both').length + '</b></div>' +
          '<div class="mini-row"><span>أرسلوا الفعلي فقط</span><b class="t-blue">' + st.rows.filter((r) => r.status.key === 'actual').length + '</b></div>' +
        '</div>' +
        '<div class="card-actions"><button class="btn btn-primary" data-action="open-sms">📱 إرسال تنبيه لمن لم يرسلوا</button></div>' +
      '</div>' +
    '</div>';

  root.querySelector('[data-action="open-none"]').addEventListener('click', () => {
    App.filters = { filter: 'none', query: '' };
    go('supervisors');
  });
  root.querySelector('[data-action="open-sms"]').addEventListener('click', () => {
    App.selected = new Set(missing.map((r) => r.nameNorm));
    App.smsPrefill = { mode: 'selected' };
    go('sms');
  });
}
