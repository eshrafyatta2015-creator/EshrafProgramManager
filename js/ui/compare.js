/* 🔗 المقارنة — مطابقة البيانات الأساسية مع ردود الاستمارة (§31/§32)
   مفتاح المطابقة = اسم المشرف فقط. غير المطابق لا يُحذف ويُرفع للمراجعة الإدارية. */

import { CFG } from '../config.js';
import { escapeHtml, ltr, normName } from '../utils.js';
import { tableHtml, statCard, statusPill, htmlCell } from './components.js';
import { responsesOfWeek } from '../services/responsesService.js';
import { matchByName } from '../services/matchingService.js';

export function render(root, app) {
  const week = app.week;
  const master = (app.data && app.data.master) || [];
  const rows = app.status.rows;
  const weekRecs = week ? responsesOfWeek(app.data, week.start) : [];
  const { matched, unmatched } = matchByName(master, weekRecs);

  const senderNorms = new Set(matched.map((r) => r.supervisorNorm));
  for (const r of unmatched) senderNorms.add(r.supervisorNorm || normName(r.supervisor));

  /* أسماء غير المطابقة في أسبوع العرض (مع عدد سجلاتها) */
  const weekUnmatched = new Map();
  for (const r of unmatched) {
    const k = r.supervisorNorm || normName(r.supervisor);
    const cur = weekUnmatched.get(k) || { name: r.supervisor, count: 0 };
    cur.count++;
    weekUnmatched.set(k, cur);
  }
  const weekUnmatchedList = Array.from(weekUnmatched.values()).sort((a, b) => b.count - a.count);

  /* غير المطابقين عبر كل الأسابيع (كشف دائم) */
  const orphansAll = (app.data && app.data.orphans) || [];

  const tableRows = rows.map((r) => [
    r.name,
    htmlCell('<span class="t-green">✓</span>'),
    htmlCell((r.sentPlanning ? '<span class="t-green">✓</span>' : '<span class="t-red">✕</span>')),
    htmlCell((r.sentActual ? '<span class="t-green">✓</span>' : '<span class="t-red">✕</span>')),
    statusPill(r.status),
    ltr(String(r.recordCount)),
  ]);

  root.innerHTML =
    '<div class="card">' +
      '<h3>🔗 المقارنة — ' + (week ? 'أسبوع ' + escapeHtml(week.label) : 'الأسبوع الحالي') + '</h3>' +
      '<p class="muted">' + CFG.texts.matchRule + ' — لا تُستخدم أرقام الهواتف/الهوية في المطابقة إطلاقاً.</p>' +
      '<div class="stats-grid">' +
        statCard({ icon: '👥', label: 'البيانات الأساسية', value: master.length, cls: 'card-total' }) +
        statCard({ icon: '📥', label: 'سجلات ردود الأسبوع', value: weekRecs.length, cls: 'card-planning' }) +
        statCard({ icon: '📤', label: 'مشرفو أرسلوا (مطابقون)', value: senderNorms.size, cls: 'card-actual' }) +
        statCard({ icon: '⚠', label: 'مشرفون غير مطابقين', value: weekUnmatchedList.length, cls: 'card-missing' }) +
      '</div>' +
      tableHtml(['المشرف', 'مطابق بالاسم', 'التخطيط', 'الفعلي', 'الحالة', 'سجلات الأسبوع'], tableRows) +
    '</div>' +
    '<div class="card">' +
      '<h3>⚠ مشرفون غير مطابقين في هذا الأسبوع</h3>' +
      (weekUnmatchedList.length
        ? '<div class="banner orphan-banner">' + CFG.texts.orphanWarning + ' — <b>' +
            CFG.texts.orphanReview + '</b></div>' +
          tableHtml(['اسم المشرف كما ورد في الردود', 'عدد السجلات'],
            weekUnmatchedList.map((o) => [o.name, ltr(String(o.count))]))
        : '<div class="banner">✓ لا يوجد مشرفون غير مطابقين في ردود هذا الأسبوع</div>') +
    '</div>' +
    '<div class="card">' +
      '<h3>🔎 غير المطابقين عبر كل الأسابيع (كشف دائم)</h3>' +
      (orphansAll.length
        ? '<div class="banner orphan-banner">' + CFG.texts.orphanWarning + ' — <b>' + CFG.texts.orphanReview +
            '</b> (لم يُحذف أي سجل)</div>' +
          tableHtml(['الاسم', 'عدد السجلات', 'عدد الأسابيع'],
            orphansAll.map((o) => [o.name, ltr(String(o.count)), ltr(String(o.weeks))]))
        : '<div class="banner">✓ كل الأسماء في الردود والأرشيف موجودة في البيانات الأساسية</div>') +
    '</div>';
}
