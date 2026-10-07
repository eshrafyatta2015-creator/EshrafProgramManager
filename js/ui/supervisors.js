/* المشرفون — بطاقات + فلاتر + بحث فوري */

import { CFG } from '../config.js';
import { escapeHtml, ltr } from '../utils.js';
import { statusPill, emptyState, htmlCell } from './components.js';
import { filterRows } from '../services/statusService.js';
import { App, go } from './app.js';

function schoolsOfWeek(row) {
  const set = new Set();
  for (const r of row.records) {
    for (const d of r.days || []) if (d.school) set.add(d.school);
  }
  return Array.from(set);
}

function card(r) {
  const schools = schoolsOfWeek(r);
  const checked = App.selected.has(r.nameNorm) ? ' checked' : '';
  return '<div class="sup-card ' + r.status.cls + '">' +
    '<div class="sup-top">' +
      '<label class="sup-check" title="اختيار للتنبيه"><input type="checkbox" data-norm="' + escapeHtml(r.nameNorm) + '"' + checked + '> <span>تنبيه</span></label>' +
      '<div class="sup-name">' + escapeHtml(r.name) +
        (r.phone ? '<span class="sup-phone">📱 ' + escapeHtml(r.phone) + '</span>' : '<span class="sup-phone muted">📱 غير متوفر</span>') +
      '</div>' +
      statusPill(r.status) +
    '</div>' +
    (schools.length ? '<div class="sup-schools">🏫 ' + escapeHtml(schools.slice(0, 4).join(' · ')) +
      (schools.length > 4 ? ' +' + (schools.length - 4) : '') + '</div>' : '') +
    '<div class="sup-flags">' +
      '<span class="flag ' + (r.sentPlanning ? 'ok' : 'no') + '">' + (r.sentPlanning ? '✓' : '✕') + ' التخطيط</span>' +
      '<span class="flag ' + (r.sentActual ? 'ok' : 'no') + '">' + (r.sentActual ? '✓' : '✕') + ' الفعلي</span>' +
      '<span class="flag last">آخر إرسال: ' + ltr(r.lastSent) + '</span>' +
      (r.recordCount > 1 ? '<span class="flag dup" title="عدد الصفوف في هذا الأسبوع">' + r.recordCount + '×</span>' : '') +
    '</div>' +
    '<div class="sup-actions">' +
      '<button class="btn btn-sm" data-detail="' + escapeHtml(r.nameNorm) + '">👁 التفاصيل</button>' +
      '<button class="btn btn-sm" data-sms="' + escapeHtml(r.nameNorm) + '">📱 تنبيه</button>' +
    '</div>' +
  '</div>';
}

export function render(root, app) {
  const all = app.status.rows;
  const rows = filterRows(all, app.filters);
  const f = app.filters;
  const selCount = App.selected.size;
  const orphans = (app.data && app.data.orphans) || [];

  root.innerHTML =
    '<div class="toolbar">' +
      '<div class="search-box"><span>🔍</span><input id="sup-search" type="search" placeholder="البحث عن مشرف (بالاسم فقط)" value="' + escapeHtml(f.query) + '"></div>' +
      '<div class="chips">' + CFG.statusFilters.map((x) =>
        '<button class="chip ' + (f.filter === x.key ? 'active' : '') + '" data-filter="' + x.key + '">' + x.label + '</button>').join('') +
      '</div>' +
      '<div class="toolbar-meta">' +
        '<span class="count-pill">' + rows.length + ' / ' + all.length + '</span>' +
        (selCount ? '<span class="count-pill sel">☑ ' + selCount + ' محدد للتنبيه</span>' : '') +
        (selCount ? '<button class="btn btn-sm btn-primary" data-action="go-sms">📱 إرسال تنبيه للمحدد</button>' : '') +
        (selCount ? '<button class="btn btn-sm btn-ghost" data-action="clear-sel">مسح التحديد</button>' : '') +
      '</div>' +
    '</div>' +
    (orphans.length
      ? '<div class="banner orphan-banner">⚠ ' + ltr(String(orphans.length)) +
        ' مشرفاً في السجلات خارج القائمة المرجعية (لم يُحذف شيء): ' +
        escapeHtml(orphans.slice(0, 5).map((o) => o.name).join('، ')) +
        (orphans.length > 5 ? ' +' + (orphans.length - 5) : '') + '</div>'
      : '') +
    (rows.length
      ? '<div class="sup-grid">' + rows.map(card).join('') + '</div>'
      : emptyState('لا يوجد مشرفون مطابقون لهذا الفلتر/البحث'));

  const search = root.querySelector('#sup-search');
  search.addEventListener('input', () => {
    app.filters.query = search.value;
    const pos = search.selectionStart;
    render(root, app);
    const s2 = root.querySelector('#sup-search');
    s2.focus();
    s2.setSelectionRange(pos, pos);
  });

  root.querySelectorAll('.chip[data-filter]').forEach((c) => c.addEventListener('click', () => {
    app.filters.filter = c.dataset.filter;
    render(root, app);
  }));

  root.querySelectorAll('input[data-norm]').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) App.selected.add(cb.dataset.norm);
    else App.selected.delete(cb.dataset.norm);
    render(root, app);
  }));

  root.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', () => {
    App.detailSel = { supNorm: b.dataset.detail, from: app.week ? app.week.start : '', to: app.week ? app.week.end : '', mode: 'both', submitted: true };
    go('details');
  }));

  root.querySelectorAll('[data-sms]').forEach((b) => b.addEventListener('click', () => {
    App.selected.add(b.dataset.sms);
    App.smsPrefill = { mode: 'selected' };
    go('sms');
  }));

  const goSms = root.querySelector('[data-action="go-sms"]');
  if (goSms) goSms.addEventListener('click', () => { App.smsPrefill = { mode: 'selected' }; go('sms'); });
  const clr = root.querySelector('[data-action="clear-sel"]');
  if (clr) clr.addEventListener('click', () => { App.selected.clear(); render(root, app); });
}
