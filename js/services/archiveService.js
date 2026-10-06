/* ArchiveService — الأرشيف النهائي (Link1): قراءة للاستعلام + إضافة أثناء الترحيل فقط.
   هذا هو مسار الكتابة الوحيد في التطبيق: معاينة ← تأكيد ← إضافة ← تحقق ← نتيجة.
   ممنوع: الحذف أو التعديل؛ ومنع التكرار بمفتاح السجل قبل أي كتابة. */

import { CFG } from '../config.js';
import { fetchText, normName } from '../utils.js';
import { parseAdminCsv as parseArchiveCsv } from '../models.js';
import { appendData, verifyAppendInCsv } from './sheetsService.js';
import { buildExportPlan } from './exportService.js';
import { responsesOfWeek, splitByMaster, typeCounts } from './responsesService.js';
import { logList } from './logService.js';

export function archiveRecords(data) {
  return ((data && data.records) || []).filter((r) => r.source === 'admin');
}

export function archiveWeeks(data) {
  return (data && data.admin && data.admin.weeks) || [];
}

export function weekExistsInArchive(data, weekStart) {
  return archiveRecords(data).some((r) => r.weekStart === weekStart);
}

export function buildMigratePreview(data, week) {
  const master = (data && data.master) || [];
  const weekRecords = responsesOfWeek(data, week ? week.start : '');
  const { kept, orphans } = splitByMaster(master, weekRecords);
  const existing = archiveRecords(data);
  const plan = buildExportPlan(existing, kept, week);
  const orphanSup = Array.from(new Map(orphans.map((r) => [r.supervisorNorm || normName(r.supervisor), r.supervisor])).entries())
    .map(([nameNorm, name]) => ({ nameNorm, name }));
  return {
    week,
    masterCount: master.length,
    responses: weekRecords.length,
    kept: plan.keep.length,
    skipped: plan.skipped,
    needsHeader: plan.needsHeader,
    headerExists: weekExistsInArchive(data, week ? week.start : ''),
    orphans,
    orphanSupervisors: orphanSup,
    types: typeCounts(plan.keep),
    plan,
    marker: plan.keep.length ? plan.keep[0].supervisor : '',
  };
}

export async function executeMigration({ preview, week, appsScriptUrl }) {
  const started = Date.now();
  if (!preview || !preview.plan.rows.length) {
    return { ok: false, code: 'EMPTY', error: 'لا توجد سجلات جديدة للترحيل.', ms: Date.now() - started, week };
  }
  const written = await appendData({
    rows: preview.plan.rows,
    markerRow: preview.marker,
    weekLabel: week.label,
    appsScriptUrl,
  });
  if (!written.ok) {
    return { ...written, ms: Date.now() - started, week };
  }
  const verify = await verifyAppendInCsv(preview.marker, week.start);
  return {
    ok: true,
    appended: written.appended,
    skipped: written.skipped,
    verifyOk: verify.ok,
    ms: Date.now() - started,
    week,
  };
}

export async function fetchArchiveFresh() {
  const txt = await fetchText(CFG.sheets.admin + '&nc=' + Date.now(), CFG.requestTimeoutMs);
  return parseArchiveCsv(txt);
}

export function migrationHistory(limit) {
  const out = logList().filter((l) => l.type === 'ترحيل الأسبوع');
  return limit ? out.slice(0, limit) : out;
}

export function migrationHistoryRows(limit) {
  return migrationHistory(limit).map((l) => [l.time, l.detail]);
}
