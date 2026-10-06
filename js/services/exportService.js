/* ExportService — Excel حقيقي (SheetJS) + CSV + صفوف تصدير إلى الأرشيف */

import { CFG } from '../config.js';
import { csvSerialize, downloadBlob, normName, formatDate } from '../utils.js';
import { recordKey } from './sheetsService.js';

const ADMIN_NOTES_HEADER = 'الملاحظات لبرنامج التخطيط او الفعلي ( يتم رصد ملاحظات لبرنامج التخطيط او ما تم تنفيذه في البرنامج الفعلي بالمقارنه مع البرنامج السابق مثلا تم تغيير المدرسه او المعلم بسبب.... الخ)';
const ADMIN_TYPE_HEADER = 'نوع البرنامج  (فعلي او تخطيط اختر من القائمه)';
const ADMIN_CODE_HEADER = 'Valid Code(خاص بالتطبيق)';

export function adminWeekHeaderRow(weekLabel) {
  const row = [CFG.magicHeader];
  for (const d of CFG.days) {
    row.push(weekLabel + ' ' + d.sheet);
    row.push('تفاصيل الايام ' + d.sheet);
  }
  row.push(ADMIN_NOTES_HEADER);
  row.push(ADMIN_CODE_HEADER);
  row.push(ADMIN_TYPE_HEADER);
  return row;
}

export function recordToAdminRow(r) {
  const out = [r.supervisor];
  for (let i = 0; i < 6; i++) {
    const day = (r.days && r.days[i]) || { school: '', activity: '' };
    out.push(day.school || '');
    out.push(day.activity || '');
  }
  out.push(r.notes || '');
  out.push(r.code || '');
  out.push(r.type || '');
  return out;
}

export function recordsToAdminRows(records) {
  return records.map(recordToAdminRow);
}

export function dedupeAgainstExisting(existingRecords, newRecords) {
  const seen = new Set(existingRecords.map(recordKey));
  const keep = [];
  let skipped = 0;
  for (const r of newRecords) {
    const k = recordKey(r);
    if (seen.has(k)) { skipped++; continue; }
    seen.add(k);
    keep.push(r);
  }
  return { keep, skipped };
}

export function buildExportPlan(existingRecords, newRecords, week) {
  const { keep, skipped } = dedupeAgainstExisting(existingRecords, newRecords);
  const rows = [];
  const needsHeader = keep.length > 0 && !existingRecords.some((r) => r.weekStart === week.start);
  if (needsHeader) rows.push(adminWeekHeaderRow(week.label));
  for (const r of keep) rows.push(recordToAdminRow(r));
  return { rows, keep, skipped, needsHeader };
}

export function downloadCsv(filename, rows) {
  const bom = '\uFEFF';
  downloadBlob(filename, new Blob([bom + csvSerialize(rows)], { type: 'text/csv;charset=utf-8' }));
}

/* ---------- Excel ---------- */

export function buildExcelWorkbook(payload) {
  if (typeof XLSX === 'undefined') {
    const err = new Error('XLSX_MISSING');
    err.code = 'XLSX_MISSING';
    throw err;
  }
  const wb = XLSX.utils.book_new();

  if (payload.summary) {
    const aoa = [[CFG.displayName], [CFG.headerLine1], [CFG.headerLine2], [],
      ['إجمالي المشرفين', payload.summary.total],
      ['أرسلوا التخطيط', payload.summary.planning],
      ['لم يرسلوا التخطيط', payload.summary.notPlanning],
      ['أرسلوا الفعلي', payload.summary.actual],
      ['لم يرسلوا الفعلي', payload.summary.notActual],
      ['نسبة الإنجاز %', payload.summary.completion],
      [], ['تاريخ التصدير', formatDate(new Date())]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'الملخص');
  }

  if (payload.statusRows) {
    const aoa = [['المشرف', 'الهاتف', 'التخطيط', 'الفعلي', 'آخر إرسال', 'الحالة']];
    for (const r of payload.statusRows) {
      aoa.push([r.name, r.phone || '', r.sentPlanning ? '✓' : '✕', r.sentActual ? '✓' : '✕', r.lastSent, r.status.label]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'حالة الإرسال');
  }

  if (payload.detailRows) {
    const aoa = [['المشرف', 'الأسبوع', 'النوع', 'اليوم', 'المدرسة', 'الفعلية', 'الملاحظات', 'الكود', 'المصدر', 'الوقت']];
    for (const r of payload.detailRows) {
      aoa.push([r.supervisor, r.week ? r.week.label : '', r.type || '', r.dayLabel || '', r.school || '', r.activity || '', r.notes || '', r.code || '', r.source || '', r.timestamp || '']);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'التفاصيل');
  }

  if (payload.planningRows || payload.actualRows) {
    const mk = (rows, name) => {
      const aoa = [['المشرف', 'الأسبوع', ...CFG.days.map((d) => d.label + ' - مدرسة'), ...CFG.days.map((d) => d.label + ' - فعالية'), 'الملاحظات']];
      for (const rec of rows) {
        aoa.push([rec.supervisor, rec.week ? rec.week.label : '',
          ...rec.days.map((d) => d.school), ...rec.days.map((d) => d.activity), rec.notes || '']);
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
    };
    if (payload.planningRows) mk(payload.planningRows, 'التخطيط');
    if (payload.actualRows) mk(payload.actualRows, 'الفعلي');
  }

  return wb;
}

export function exportExcel(filename, payload) {
  const wb = buildExcelWorkbook(payload);
  XLSX.writeFile(wb, filename);
}
