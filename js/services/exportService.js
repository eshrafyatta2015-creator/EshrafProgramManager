/* ExportService — Excel حقيقي (SheetJS) + CSV + صفوف بتنسيق ردود الاستمارة للترحيل */

import { CFG } from '../config.js';
import { csvSerialize, downloadBlob, formatDate } from '../utils.js';

/* صف بتنسيق ردود الاستمارة (17 عموداً): Timestamp، اسم المشرف، 6 أيام، ملاحظات، كود، نوع
   — يُضاف أسفل الأرشيف مباشرةً (ترويسة واحدة أعلى الملف فقط، لا ترويسة لكل أسبوع) */
export function recordToResponsesRow(r) {
  const out = [r.timestamp || '', r.supervisor];
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

export function recordsToResponsesRows(records) {
  return records.map(recordToResponsesRow);
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

  if (payload.migratedRows) {
    const aoa = [['المشرف', 'الأسبوع', 'النوع', 'اليوم', 'المدرسة', 'الفعلية', 'الملاحظات', 'الكود', 'المصدر', 'الوقت']];
    for (const r of payload.migratedRows) {
      aoa.push([r.supervisor, r.week ? r.week.label : '', r.type || '', r.dayLabel || '', r.school || '', r.activity || '', r.notes || '', r.code || '', r.source || '', r.timestamp || '']);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'المرحّل');
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
