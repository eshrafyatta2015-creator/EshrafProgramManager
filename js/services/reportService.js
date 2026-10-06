/* ReportService — فلاتر التقارير + جداول التقرير */

import { CFG } from '../config.js';
import { normName, parseIso, parseTimestamp, isoDate } from '../utils.js';
import { computeStatus } from './statusService.js';

export function filterRecords(records, f) {
  let out = records.slice();
  if (f.supervisorNorm) out = out.filter((r) => r.supervisorNorm === f.supervisorNorm);
  if (f.type) out = out.filter((r) => r.type === f.type);
  if (f.weekStart) out = out.filter((r) => r.weekStart === f.weekStart);
  if (f.school) {
    const q = normName(f.school);
    out = out.filter((r) => (r.days || []).some((d) => normName(d.school).includes(q)));
  }
  if (f.query) {
    const q = normName(f.query);
    out = out.filter((r) => r.supervisorNorm.includes(q) || (r.notes || '').includes(f.query.trim()));
  }
  if (f.from || f.to) {
    const from = f.from ? isoDate(parseIso(f.from)) : null;
    const to = f.to ? isoDate(parseIso(f.to)) : null;
    out = out.filter((r) => {
      const start = r.weekStart;
      const end = r.week && r.week.end ? r.week.end : start;
      if (from && end < from) return false;
      if (to && start > to) return false;
      return true;
    });
  }
  return out;
}

export function buildStatusReport(master, records, week, phones, statusFilter) {
  const { rows, stats } = computeStatus(master, records, week, phones);
  let out = rows;
  if (statusFilter && statusFilter !== 'all') {
    if (statusFilter === 'planning') out = out.filter((r) => r.sentPlanning && !r.sentActual);
    else if (statusFilter === 'actual') out = out.filter((r) => r.sentActual);
    else if (statusFilter === 'none') out = out.filter((r) => !r.sentPlanning && !r.sentActual);
    else if (statusFilter === 'sentAny') out = out.filter((r) => r.sentPlanning || r.sentActual);
  }
  return { rows: out, stats };
}

export function flattenDetail(records) {
  const out = [];
  for (const r of records) {
    CFG.days.forEach((d, i) => {
      const day = (r.days || [])[i] || { school: '', activity: '' };
      out.push({
        supervisor: r.supervisor,
        week: r.week,
        weekStart: r.weekStart,
        type: r.type,
        dayLabel: d.label,
        school: day.school,
        activity: day.activity,
        notes: r.notes,
        code: r.code,
        source: r.source === 'admin' ? 'أرشيف' : 'استمارة',
        timestamp: r.timestamp || '',
        tsTime: r.tsTime,
      });
    });
  }
  return out;
}

export function reportTable(statusRows) {
  const head = ['المشرف', 'الهاتف', 'التخطيط', 'الفعلي', 'آخر إرسال', 'الحالة'];
  const body = statusRows.map((r) => [
    r.name,
    r.phone || '—',
    r.sentPlanning ? '✓' : '✕',
    r.sentActual ? '✓' : '✕',
    r.lastSent,
    r.status.label,
  ]);
  return { head, body };
}
