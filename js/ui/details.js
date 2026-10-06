/* تفاصيل برنامج المشرف + مقارنة التخطيط/الفعلي */

import { CFG } from '../config.js';
import { escapeHtml, parseIso, formatDate, addDays, ltr } from '../utils.js';
import { emptyState, statusPill } from './components.js';
import { lastRecordOfType } from '../models.js';
import { App } from './app.js';

function dayBlock(day, dayDef) {
  return '<div class="day-card">' +
    '<div class="day-head">' + escapeHtml(dayDef.label) + '</div>' +
    '<div class="day-row"><span class="k">المدرسة:</span><span class="v">' + escapeHtml(day.school || '—') + '</span></div>' +
    '<div class="day-row"><span class="k">الفعالية:</span><span class="v">' + escapeHtml(day.activity || '—') + '</span></div>' +
  '</div>';
}

function recBlock(rec, title, cls) {
  if (!rec) {
    return '<div class="rec-block ' + cls + '"><h4>' + escapeHtml(title) + ' — <span class="t-red">لم يرسل</span></h4></div>';
  }
  return '<div class="rec-block ' + cls + '">' +
    '<h4>' + escapeHtml(title) +
      (rec.timestamp ? ' <span class="rec-ts">⏱ ' + escapeHtml(rec.timestamp) + '</span>' : ' <span class="rec-ts">من الأرشيف</span>') +
      (rec.source === 'admin' ? '' : '') +
    '</h4>' +
    '<div class="days-row">' + rec.days.map((d, i) => dayBlock(d, CFG.days[i])).join('') + '</div>' +
    (rec.notes ? '<div class="rec-notes">📝 ' + escapeHtml(rec.notes) + '</div>' : '') +
  '</div>';
}

function compareTable(planRec, actRec) {
  const rows = CFG.days.map((d, i) => {
    const p = (planRec && planRec.days[i]) || { school: '', activity: '' };
    const a = (actRec && actRec.days[i]) || { school: '', activity: '' };
    const hasP = !!(p.school || p.activity);
    const hasA = !!(a.school || a.activity);
    const same = hasP && hasA && p.school === a.school && p.activity === a.activity;
    const diff = hasP && hasA && !same;
    const pTxt = hasP ? escapeHtml(p.school) + '<br><small>' + escapeHtml(p.activity) + '</small>' : '<span class="t-red">— لم يرسل</span>';
    const aTxt = hasA ? escapeHtml(a.school) + '<br><small>' + escapeHtml(a.activity) + '</small>' : '<span class="t-red">— لم يرسل</span>';
    let mark = '';
    if (diff) mark = '<span class="diff-badge" title=" مختلف عن التخطيط">⚠ مختلف</span>';
    else if (same) mark = '<span class="same-badge">✓ مطابق</span>';
    else if (hasP && !hasA) mark = '<span class="diff-badge">✕ فعلي ناقص</span>';
    else if (!hasP && hasA) mark = '<span class="diff-badge">؟ بدون تخطيط</span>';
    return '<tr class="' + (diff ? 'row-diff' : '') + '"><td>' + escapeHtml(d.label) + '</td><td>' + pTxt + '</td><td>' + aTxt + '</td><td>' + mark + '</td></tr>';
  }).join('');
  return '<div class="table-wrap"><table class="table"><thead><tr><th>اليوم</th><th>التخطيط</th><th>الفعلي</th><th>الحالة</th></tr></thead><tbody>' +
    rows + '</tbody></table></div>';
}

export function render(root, app) {
  const sel = app.detailSel;
  const sups = app.data ? app.data.master : [];

  root.innerHTML =
    '<div class="toolbar details-toolbar">' +
      '<label class="field"><span>المشرف</span><select id="d-sup">' +
        '<option value="">— اختر مشرفًا —</option>' +
        sups.map((s) => '<option value="' + escapeHtml(s.nameNorm) + '"' + (sel.supNorm === s.nameNorm ? ' selected' : '') + '>' + escapeHtml(s.name) + '</option>').join('') +
      '</select></label>' +
      '<label class="field"><span>من تاريخ</span><input type="date" id="d-from" value="' + escapeHtml(sel.from || '') + '"></label>' +
      '<label class="field"><span>إلى تاريخ</span><input type="date" id="d-to" value="' + escapeHtml(sel.to || '') + '"></label>' +
      '<div class="field mode-field"><span>عرض:</span>' +
        ['both:عرض الاثنين', 'planning:البرنامج التخطيطي', 'actual:البرنامج الفعلي'].map((x) => {
          const [k, lab] = x.split(':');
          return '<label class="radio"><input type="radio" name="d-mode" value="' + k + '"' + (sel.mode === k ? ' checked' : '') + '> ' + lab + '</label>';
        }).join('') +
      '</div>' +
      '<button class="btn btn-primary" id="d-show">عرض البرنامج</button>' +
    '</div>' +
    '<div id="d-result"></div>';

  const showBtn = root.querySelector('#d-show');
  const showResult = () => {
    sel.supNorm = root.querySelector('#d-sup').value;
    sel.from = root.querySelector('#d-from').value;
    sel.to = root.querySelector('#d-to').value;
    sel.mode = (root.querySelector('input[name="d-mode"]:checked') || {}).value || 'both';
    sel.submitted = true;
    renderResult(root.querySelector('#d-result'), app);
  };
  showBtn.addEventListener('click', showResult);

  if (sel.submitted && sel.supNorm) showResult();
  else if (sel.submitted && !sel.supNorm) root.querySelector('#d-result').innerHTML = emptyState('اختر مشرفًا ثم اضغط عرض البرنامج');
}

function renderResult(el, app) {
  const sel = app.detailSel;
  if (!sel.supNorm) { el.innerHTML = emptyState('اختر مشرفًا ثم اضغط عرض البرنامج'); return; }
  const sup = (app.data.master || []).find((s) => s.nameNorm === sel.supNorm);
  const from = sel.from || (app.week && app.week.start) || '0000-00-00';
  const to = sel.to || (app.week && app.week.end) || '9999-99-99';

  const recs = (app.data.records || []).filter((r) =>
    r.supervisorNorm === sel.supNorm && r.week && r.week.start <= to && r.week.end >= from);

  const byWeek = new Map();
  for (const r of recs) {
    if (!byWeek.has(r.weekStart)) byWeek.set(r.weekStart, []);
    byWeek.get(r.weekStart).push(r);
  }
  const weekKeys = Array.from(byWeek.keys()).sort().reverse();

  let html = '<div class="details-head">' +
    '<h3>📅 تفاصيل برنامج: ' + escapeHtml(sup ? sup.name : sel.supNorm) + '</h3>' +
    '<p class="muted">الفترة: ' + ltr(formatDate(parseIso(from)) + ' → ' + formatDate(parseIso(to))) +
    ' · عدد الأسابيع الموجودة: ' + weekKeys.length + '</p></div>';

  if (!weekKeys.length) {
    el.innerHTML = html + emptyState('لا توجد برامج مسجلة لهذا المشرف في الفترة المحددة');
    return;
  }

  for (const wk of weekKeys) {
    const list = byWeek.get(wk);
    const planRec = lastRecordOfType(list, CFG.typePlanning);
    const actRec = lastRecordOfType(list, CFG.typeActual);
    const week = list[0].week;
    html += '<div class="week-block"><div class="week-head">الأسبوع ' + ltr(week.label) +
      ' (' + ltr(week.start + ' → ' + week.end) + ')' +
      '<span class="week-count">' + list.length + ' سجل</span></div>';

    if (sel.mode === 'both') {
      html += compareTable(planRec, actRec);
      if (planRec && planRec.notes) html += '<div class="rec-notes">📝 ملاحظات التخطيط: ' + escapeHtml(planRec.notes) + '</div>';
      if (actRec && actRec.notes) html += '<div class="rec-notes">📝 ملاحظات الفعلي: ' + escapeHtml(actRec.notes) + '</div>';
    } else if (sel.mode === 'planning') {
      html += recBlock(planRec, 'البرنامج التخطيطي', 'plan');
    } else {
      html += recBlock(actRec, 'البرنامج الفعلي', 'act');
    }
    html += '</div>';
  }
  el.innerHTML = html;
}
