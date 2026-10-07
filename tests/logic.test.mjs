/* اختبارات المنطق — 22 سيناريو من مواصفات المشروع (بيانات حقيقية + حالات حدية) */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/* localStorage mock (يجب قبل أي استخدام) */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { CFG } = await import('../js/config.js');
const { ARCHIVE_SHEET_URL, RESPONSES_SHEET_URL, MASTER_DATA_SHEET_URL } = await import('../js/config.js');
const U = await import('../js/utils.js');
const M = await import('../js/models.js');
const SS = await import('../js/services/sheetsService.js');
const ST = await import('../js/services/statusService.js');
const SMS = await import('../js/services/smsService.js');
const EX = await import('../js/services/exportService.js');
const RP = await import('../js/services/reportService.js');
const LOG = await import('../js/services/logService.js');
const MS = await import('../js/services/migrationService.js');
const MT = await import('../js/services/matchingService.js');
const HS = await import('../js/services/headerService.js');
const WK = await import('../js/services/weekService.js');
const DS = await import('../js/services/duplicateService.js');
const RS = await import('../js/services/responsesService.js');
const GW = await import('../server/smsGateway.mjs');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
};

const NC = '&nc=' + Date.now();
const [listsTxt, adminTxt, programsTxt] = await Promise.all([
  fetch(CFG.sheets.lists + NC).then((r) => r.text()),
  fetch(CFG.sheets.admin + NC).then((r) => r.text()),
  fetch(CFG.sheets.programs + NC).then((r) => r.text()),
]);

const lists = M.parseListsCsv(listsTxt);
const admin = M.parseAdminCsv(adminTxt);
const programs = M.parseProgramsCsv(programsTxt);
const master = M.masterFromLists(lists);
const unionMaster = M.buildMasterSupervisors(lists, admin.records, programs.records);
const weeks = M.allWeeks(admin.weeks, programs.headerWeek, programs.records);
const records = admin.records.concat(programs.records);

/* 1) تحميل المشرفين (من الملف المرجعي فقط) */
ok('1. تحميل المشرفين', master.length === lists.supervisors.length && master.length >= 30 && master.every((s) => s.name),
  master.length + ' مشرف (مرجعي) / دمج سابق=' + unionMaster.length);

/* 2) تحميل المدارس */
ok('2. تحميل المدارس', lists.schools.length >= 100, lists.schools.length + ' مدرسة');

/* 3) تحميل البرامج */
ok('3. تحميل البرامج', admin.records.length > 900 && programs.records.length > 0,
  'أرشيف=' + admin.records.length + ' حي=' + programs.records.length);

/* 4) اختيار الأسبوع */
{
  const w = U.parseWeekLabel('4/10-10/10 [الاحد]');
  const isSun = new Date(w.start).getDay() === 0;
  const def = M.defaultWeek(weeks, new Date('2026-10-06T12:00:00'));
  const bad = U.parseWeekLabel('ليس أسبوعاً');
  ok('4. اختيار الأسبوع', w && isSun && w.end > w.start && def && def.label === '4/10-10/10' && bad === null,
    'default=' + (def && def.label));
}

/* 5-7) حالات الإرسال لكل أسبوع */
{
  const wk = weeks.find((x) => x.label === '27/9-3/10') || weeks[0];
  const st = ST.computeStatus(master, records, wk, {});
  const planningOk = st.rows.some((r) => r.sentPlanning);
  const actualOk = st.rows.some((r) => r.sentActual);
  const noneOk = st.rows.some((r) => !r.sentPlanning && !r.sentActual);
  ok('5. حد من أرسل التخطيط', planningOk && st.stats.planning === st.rows.filter((r) => r.sentPlanning).length,
    'planning=' + st.stats.planning);
  ok('6. حد من أرسل الفعلي', actualOk && st.stats.actual === st.rows.filter((r) => r.sentActual).length,
    'actual=' + st.stats.actual);
  ok('7. حد من لم يرسل', noneOk && st.stats.notPlanning + st.stats.planning === st.stats.total,
    'none=' + (st.stats.total - st.stats.planning - st.stats.actual + st.rows.filter((r) => r.sentPlanning && r.sentActual).length));
  ok('5-7. اتساق الإحصائيات', st.stats.planning + st.stats.notPlanning === st.stats.total &&
    st.stats.actual + st.stats.notActual === st.stats.total &&
    st.stats.completion >= 0 && st.stats.completion <= 100, 'completion=' + st.stats.completion);
}

/* 8) البحث عن مشرف (بالاسم فقط — الهاتف/الهوية لا يُستخدمان في المطابقة) */
{
  const st = ST.computeStatus(master, records, weeks[0], {});
  const byFull = ST.filterRows(st.rows, { filter: 'all', query: 'هناء' });
  const byPart = ST.filterRows(st.rows, { filter: 'all', query: 'محمد' });
  const byPhone = ST.filterRows(st.rows, { filter: 'all', query: '568621477' });
  ok('8. البحث عن مشرف بالاسم فقط',
    byFull.length >= 1 && byPart.length >= 2 && byPhone.length === 0,
    'هناء=' + byFull.length + ' محمد=' + byPart.length + ' هاتف=' + byPhone.length);
}

/* 9) عرض تفاصيل الأسبوع */
{
  const target = admin.records.find((r) => r.type === CFG.typePlanning && r.weekStart);
  const recs = M.recordsForSupervisor(records, target.supervisorNorm, target.week);
  const plan = M.lastRecordOfType(recs, CFG.typePlanning);
  ok('9. تفاصيل الأسبوع', recs.length >= 1 && plan && plan.days.length === 6,
    target.supervisor.slice(0, 20) + ' recs=' + recs.length);
}

/* 10-13) SMS: مفرد/متعدد/الجميع/نص معدّل */
{
  const rows = master.slice(0, 1).map((s, i) => ({
    name: s.name, nameNorm: s.nameNorm, id: s.phone || '', phone: i === 0 ? '771234567' : '',
  }));
  const rec1 = SMS.resolveRecipients(rows, {});
  const msg1 = SMS.buildMessage(SMS.templateFor(CFG.typePlanning), { week: weeks[0], type: CFG.typePlanning, supervisor: rows[0].name });
  const msgNamed = SMS.buildMessage('أهلاً {المشرف} — {الاسبوع}', { week: weeks[0], type: CFG.typePlanning, supervisor: rows[0].name });
  ok('10. رسالة لمشرف واحد',
    rec1.entries.length === 1 && rec1.withPhone.length === 1 &&
    msg1.includes(weeks[0].label) && msg1.includes('السلام عليكم') && msgNamed.includes(rows[0].name),
    'phone=' + rec1.withPhone[0].phone);

  const multi = master.slice(0, 5).map((s) => ({ name: s.name, nameNorm: s.nameNorm, id: s.phone || '', phone: '' }));
  const rec5 = SMS.resolveRecipients(multi, { [master[0].nameNorm]: '733333333' });
  ok('11. اختيار عدة مشرفين', rec5.entries.length === 5 && rec5.withPhone.length === 1 && rec5.withphone === undefined,
    'withPhone=' + rec5.withPhone.length);

  const all = SMS.resolveRecipients(master.map((s) => ({ name: s.name, nameNorm: s.nameNorm, id: s.phone || '', phone: '' })), {});
  ok('12. إرسال للجميع', all.entries.length === master.length, all.entries.length + '');

  const custom = 'نص معدّل: {المشرف} / {النوع}';
  const msgC = SMS.buildMessage(custom, { week: weeks[0], type: CFG.typeActual, supervisor: 'أحمد' });
  ok('13. تعديل نص الرسالة', msgC === 'نص معدّل: أحمد / الفعلي', JSON.stringify(msgC));

  ok('13b. تأكيد قبل الإرسال', SMS.confirmText(15).includes('15 مشرفًا'), SMS.confirmText(15));
}

/* 14-15) خطة الترحيل: صفوف بتنسيق الردود (17 عموداً) + منع التكرار — بلا ترويسة لكل أسبوع */
{
  const wk = admin.weeks[0];
  const some = admin.records.filter((r) => r.weekStart === wk.start).slice(0, 3);
  const planDup = MS.planMigration({ archive: admin.records, records: some, week: wk, data: null });
  ok('14. خطة الترحيل — لا يُعاد ترحيل الموجود في الأرشيف',
    planDup.keep.length === 0 && planDup.skipped === 3 && planDup.headerNeeded === false &&
    planDup.rows.length === 0 && planDup.headerRow === null,
    'keep=' + planDup.keep.length + ' skip=' + planDup.skipped);

  const fakeWeek = { start: '2099-10-04', end: '2099-10-10', label: '4/10-10/10' };
  const mkRec = (notes, weekStart) => ({
    supervisor: 'اختبار تكرار', supervisorNorm: U.normName('اختبار تكرار'),
    weekStart: weekStart || fakeWeek.start, type: 'تخطيط', timestamp: '01/10/2099 09:00:00',
    days: [{ school: 'م1', activity: 'ف1' }, { school: '', activity: '' }, { school: '', activity: '' },
      { school: '', activity: '' }, { school: '', activity: '' }, { school: '', activity: '' }],
    notes: notes || '', code: '', source: 'programs',
  });
  const newRecs = [mkRec(''), mkRec('نسخة مكررة')];
  const planNew = MS.planMigration({ archive: [], records: newRecs, week: fakeWeek, data: null });
  ok('15. منع التكرار (نفس المفتاح يُتخطى) + ترويسة واحدة فقط للملف الفارغ',
    planNew.keep.length === 1 && planNew.skipped === 1 && planNew.headerNeeded === true &&
    planNew.rows.length === 1 && planNew.rows[0].length === 17 &&
    planNew.headerRow && planNew.headerRow[0] === 'Timestamp' &&
    planNew.rows[0][1] === 'اختبار تكرار' && planNew.rows[0][16] === 'تخطيط',
    'keep=' + planNew.keep.length + ' skip=' + planNew.skipped + ' cells=' + planNew.rows[0].length);

  /* أرشيف غير فارغ: لا تُكتب ترويسة أسبوع جديدة — الصفوف تُضاف تحت الترويسة العليا */
  const planExisting = MS.planMigration({ archive: admin.records, records: newRecs, week: fakeWeek, data: null });
  ok('15b. لا ترويسة أسبوع عند وجود أرشيف + الأسبوع المختلف ليس تكراراً',
    planExisting.headerNeeded === false && planExisting.headerRow === null &&
    planExisting.keep.length === 1 && planExisting.skipped === 1 &&
    planExisting.rows.every((r) => r[0] !== CFG.magicHeader),
    'keep=' + planExisting.keep.length);

  const otherWeek = { ...fakeWeek, start: '2099-10-11', end: '2099-10-17' };
  const recOther = { ...mkRec(''), weekStart: otherWeek.start };
  const planOther = MS.planMigration({ archive: [mkRec('')], records: [recOther], week: otherWeek, data: null });
  ok('15c. الأسبوع المختلف بنفس المحتوى ليس تكراراً', planOther.keep.length === 1, 'keep=' + planOther.keep.length);

  ok('15d. مفتاح السجل يشمل الأسبوع والاسم والنوع والأيام',
    DS.recordKey(newRecs[0]).split('|')[0] === fakeWeek.start &&
    DS.recordKey(newRecs[0]).includes(U.normName('اختبار تكرار')),
    DS.recordKey(newRecs[0]).slice(0, 60));
}

/* 16) استيراد/تحديث البيانات من الكاش */
{
  const cached = SS.getDataFromCache();
  ok('16. استيراد البيانات من الكاش',
    !cached || (cached.master.length > 0 && cached.weeks.length > 0),
    cached ? 'master=' + cached.master.length : 'لا كاش بعد');
}

/* 17) تصدير Excel حقيقي */
{
  /* تحميل xlsx كما في المتصفح (سكربت عام) — require يعيد {} لهذا الملف الخام */
  const fsMod = await import('node:fs');
  const vmMod = await import('node:vm');
  vmMod.runInThisContext(
    fsMod.readFileSync(new URL('../vendor/xlsx.full.min.js', import.meta.url), 'utf8'),
    { filename: 'xlsx.full.min.js' },
  );
  if (!globalThis.XLSX || !globalThis.XLSX.utils) {
    globalThis.XLSX = require('../vendor/xlsx.full.min.js');
  }
  const wk = weeks[0];
  const st = ST.computeStatus(master, records, wk, {});
  const payload = {
    summary: st.stats,
    statusRows: st.rows,
    detailRows: RP.flattenDetail(records.filter((r) => r.weekStart === wk.start)).slice(0, 50),
    migratedRows: RP.flattenDetail(records.filter((r) => r.weekStart === wk.start).slice(0, 3)),
    planningRows: records.filter((r) => r.weekStart === wk.start && r.type === CFG.typePlanning),
    actualRows: records.filter((r) => r.weekStart === wk.start && r.type === CFG.typeActual),
  };
  try {
    const wb = EX.buildExcelWorkbook(payload);
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const bytes = new Uint8Array(buf);
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4B;
    ok('17. تصدير Excel (ملف xlsx حقيقي)',
      wb.SheetNames.length === 6 && wb.SheetNames.includes('المرحّل') && isZip && bytes.length > 3000,
      'sheets=' + wb.SheetNames.join(',') + ' size=' + bytes.length);
  } catch (e) {
    ok('17. تصدير Excel (ملف xlsx حقيقي)', false, String(e));
  }
}

/* 18) التقارير */
{
  const wk = weeks[0];
  const rep = RP.buildStatusReport(master, records, wk, {}, 'none');
  const filtered = RP.filterRecords(records, { weekStart: wk.start, type: CFG.typePlanning });
  const table = RP.reportTable(rep.rows);
  ok('18. التقارير',
    table.head.length === 6 && rep.rows.every((r) => !r.sentPlanning && !r.sentActual) &&
    filtered.every((r) => r.type === CFG.typePlanning),
    'rows=' + rep.rows.length + ' filtered=' + filtered.length);

  const fromTo = RP.filterRecords(records, { from: '2026-09-27', to: '2026-10-10' });
  ok('18b. فلترة التاريخ من-إلى', fromTo.length > 0 && fromTo.every((r) => r.week.end >= '2026-09-27' && r.week.start <= '2026-10-10'),
    fromTo.length + ' سجل');
}

/* 19) تحديث البيانات (شبكة حقيقية) */
{
  const data = await SS.getData({ force: true });
  ok('19. تحديث البيانات',
    data && data.master.length >= 30 && data.weeks.length >= 30 && !data.offline,
    'master=' + data.master.length + ' weeks=' + data.weeks.length);
}

/* 20) انقطاع الإنترنت */
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const offline = await SS.getData({ force: true });
    ok('20. انقطعت الشبكة → كاش محلي',
      offline && offline.offline === true && offline.master.length > 0,
      'offline=' + offline.offline + ' master=' + (offline && offline.master.length));
  } catch (e) {
    ok('20. انقطعت الشبكة → كاش محلي', false, 'throw: ' + e.message);
  } finally {
    globalThis.fetch = origFetch;
  }
}

/* 21) ملف Google Sheets فارغ */
{
  const emptyAdmin = M.parseAdminCsv('');
  const emptyLists = M.parseListsCsv('');
  const emptyProg = M.parseProgramsCsv('');
  const stEmpty = ST.computeStatus([{ name: 'أ', nameNorm: 'أ', phone: '' }], [], null, {});
  ok('21. ملف فارغ',
    emptyAdmin.records.length === 0 && emptyLists.schools.length === 0 && emptyProg.records.length === 0 &&
    stEmpty.stats.total === 1 && stEmpty.stats.planning === 0 && stEmpty.rows[0].status.key === 'none',
    'بدون انهيار');
}

/* 22) بيانات ناقصة/معطوبة */
{
  const junk = 'Timestamp,اسم\n' +
    'not-a-date,\n' +
    ',\n' +
    '03/10/2026 10:00:00,فقط عمودان\n';
  const p = M.parseProgramsCsv(junk);
  const shortAdmin = 'name,day1\n' + 'ز,مدرسة\n' + '\n';
  const a = M.parseAdminCsv(shortAdmin);
  const st = ST.computeStatus(master, records, null, {});
  ok('22. بيانات ناقصة/معطوبة',
    p.records.length <= 2 && a.records.length <= 1 && st.rows.length === master.length,
    'programs=' + p.records.length + ' admin=' + a.records.length);
}

/* 23) فصل المصادر الثلاثة في الإعدادات المركزي */
{
  ok('23. فصل مصادر البيانات الثلاثة',
    CFG.sheets.admin === ARCHIVE_SHEET_URL &&
    CFG.sheets.programs === RESPONSES_SHEET_URL &&
    CFG.sheets.lists === MASTER_DATA_SHEET_URL &&
    CFG.sheets.admin.includes('1rthlma') &&
    CFG.sheets.programs.includes('16Sw_4Tj') &&
    CFG.sheets.lists.includes('1P2X7VK') &&
    new Set([CFG.sheets.admin, CFG.sheets.programs, CFG.sheets.lists]).size === 3,
    'أرشيف/ردود/مرجعي منفصلة');
}

/* 24) قائمة المتابعة من الملف المرجعي فقط + كشف اليتيمة دون حذف */
{
  const tracking = M.masterFromLists(lists);
  const orphans = M.findOrphanSupervisors(tracking, records);
  ok('24. قائمة المشرفيين من الملف المرجعي فقط',
    tracking.length === lists.supervisors.length &&
    tracking.every((s) => lists.supervisors.some((l) => l.name === s.name)),
    tracking.length + ' مشرف');
  ok('24b. كشف السجلات اليتيمة (دون حذف)',
    Array.isArray(orphans) &&
    orphans.length === unionMaster.length - tracking.length &&
    orphans.every((o) => !tracking.some((t) => t.nameNorm === o.nameNorm) && o.count > 0),
    'يتيمة=' + orphans.length + ' أسماء · سجلات=' + orphans.reduce((a, o) => a + o.count, 0));
  ok('24c. السجلات اليتيمة باقية ولا تُحذف',
    records.length === admin.records.length + programs.records.length &&
    orphans.every((o) => records.some((r) => (r.supervisorNorm || U.normName(r.supervisor)) === o.nameNorm)),
    records.length + ' سجل كامل');
}

/* 25) الفلاتر السبعة */
{
  ok('25. الفلاتر السبعة',
    CFG.statusFilters.length === 7 &&
    CFG.statusFilters.map((x) => x.key).join(',') === 'all,planning,notPlanning,actual,notActual,complete,incomplete',
    CFG.statusFilters.length + ' فلاتر');
  const st = ST.computeStatus(master, records, weeks[0], {});
  const c = {};
  for (const f of CFG.statusFilters.map((x) => x.key)) c[f] = ST.filterRows(st.rows, { filter: f }).length;
  const both = st.rows.filter((r) => r.sentPlanning && r.sentActual).length;
  ok('25b. منطق الفلاتر',
    c.all === st.rows.length &&
    c.planning === st.rows.filter((r) => r.sentPlanning).length &&
    c.notPlanning === c.all - c.planning &&
    c.actual === st.rows.filter((r) => r.sentActual).length &&
    c.notActual === c.all - c.actual &&
    c.complete === both && c.incomplete === c.all - both &&
    c.planning + c.notPlanning === c.all && c.actual + c.notActual === c.all,
    JSON.stringify(c));
}

/* 26) رسائل SMS حسب الحالة */
{
  const mk = (p, a) => ({ sentPlanning: p, sentActual: a, status: ST.statusOf(p, a) });
  ok('26. قوالب رسائل الحالة',
    CFG.messages.none.includes('{الاسبوع}') && CFG.messages.complete.includes('{الاسبوع}') &&
    CFG.messages.none !== CFG.messages.both && CFG.messages.complete !== CFG.messages.both &&
    SMS.stateTemplateKey('none', null) === 'none' && SMS.stateTemplateKey('complete', null) === 'complete',
    'none/complete متاحة');
  ok('26b. الاختيار التلقائي حسب حالة المحددين',
    SMS.stateTemplateKey('auto', []) === 'both' &&
    SMS.stateTemplateKey('auto', [mk(0, 0), mk(0, 0)]) === 'none' &&
    SMS.stateTemplateKey('auto', [mk(1, 1), mk(1, 1)]) === 'complete' &&
    SMS.stateTemplateKey('auto', [mk(1, 0), mk(1, 0)]) === 'actual' &&
    SMS.stateTemplateKey('auto', [mk(0, 1), mk(0, 1)]) === 'planning' &&
    SMS.stateTemplateKey('auto', [mk(1, 0), mk(0, 1)]) === 'both',
    'auto→none/complete/actual/planning/both');
}

/* 27) الترحيل: معاينة + خطة + غياب الرابط + سجل مهيكل */
{
  const fakeData = { master, records, admin, weeks, programs };
  const wk = weeks[0];
  const pv = MS.buildMigratePreview(fakeData, wk);
  ok('27. معاينة الترحيل',
    pv && pv.week.start === wk.start &&
    pv.masterCount === master.length &&
    pv.responses === pv.kept + pv.skipped + pv.orphans.length &&
    pv.orphanSupervisors.length === new Set(pv.orphans.map((o) => o.supervisorNorm || U.normName(o.supervisor))).size &&
    pv.orphanSupervisors.every((o) => o.name && o.nameNorm) &&
    pv.plan.rows.length === pv.kept &&
    pv.headerNeeded === (pv.kept > 0 && admin.records.length === 0) &&
    pv.types !== undefined && pv.planningSenders >= 0 && pv.actualSenders >= 0,
    'جديد=' + pv.kept + ' مكرر=' + pv.skipped + ' يتيمة=' + pv.orphans.length + ' رأس=' + pv.headerNeeded);

  /* اليتيمة لا تُرحَّل تلقائياً — فقط بخيار صريح */
  const pvWithOrph = MS.buildMigratePreview(fakeData, wk, { includeOrphans: true });
  ok('27b. اليتيمة لا تُرحَّل تلقائياً (خيار صريح فقط)',
    pvWithOrph.orphans.length === pv.orphans.length &&
    pvWithOrph.kept >= pv.kept &&
    pvWithOrph.kept + pvWithOrph.skipped === pv.responses &&
    pv.kept + pv.orphans.length <= pv.responses,
    'افتراضي=' + pv.kept + ' مع اليتيمة=' + pvWithOrph.kept);

  const fakePreview = { plan: { rows: [['x']], headerRow: null }, marker: 'اختبار', kept: 1, week: wk };
  const run = await MS.executeMigration({ preview: fakePreview, week: wk, data: fakeData, appsScriptUrl: '' });
  ok('27c. تنفيذ بدون رابط Apps Script = رفض صريح بلا حذف',
    run.ok === false && run.code === 'NOT_CONFIGURED' && run.week === wk &&
    run.deleteAttempted === false && run.logged === false,
    run.code);

  const hist = MS.migrationHistoryRows(10);
  ok('27d. سجل الترحيل المهيكل (§29: 6 أعمدة)',
    Array.isArray(hist) && hist.every((r) => r.length === 6),
    hist.length + ' سجل');
}

/* 28) مفتاح المطابقة = الاسم فقط (SupervisorMatchingService) */
{
  ok('28. مفتاح المطابقة اسم فقط',
    MT.MATCH_KEY === 'name' &&
    MT.normalizeSupervisorName('  أَحْمَد  عَلِي  ') === 'احمد علي' &&
    MT.normalizeSupervisorName(MT.normalizeSupervisorName('مُصْعَب')) === MT.normalizeSupervisorName('مصعب'),
    'MATCH_KEY=' + MT.MATCH_KEY);

  const fakeMaster = [
    { name: 'أحمد علي', nameNorm: U.normName('أحمد علي'), phone: '0599111111' },
    { name: 'سعاد نمر', nameNorm: U.normName('سعاد نمر'), phone: '0599222222' },
  ];
  const recs = [
    { supervisor: 'أحمد علي', supervisorNorm: U.normName('أحمد علي') },
    { supervisor: 'أحمد علي ', supervisorNorm: U.normName('أحمد علي ') },
    { supervisor: 'اسم غريب', supervisorNorm: U.normName('اسم غريب') },
  ];
  const m = MT.matchByName(fakeMaster, recs);
  ok('28b. المطابقة بالاسم تتجاهل الهاتف: نفس الاسم = مطابقة',
    m.matched.length === 2 && m.unmatched.length === 1 &&
    m.unmatched[0].supervisor === 'اسم غريب',
    'مطابق=' + m.matched.length + ' غير مطابق=' + m.unmatched.length);

  const samePhoneDiffName = MT.matchByName(fakeMaster, [{ supervisor: 'آخر اسم', supervisorNorm: U.normName('آخر اسم') }]);
  ok('28c. تشابه الهاتف لا يُطابق اسماً مختلفاً',
    samePhoneDiffName.matched.length === 0 && samePhoneDiffName.unmatched.length === 1,
    'مطابق=' + samePhoneDiffName.matched.length);
}

/* 29) خريطة الترويسة HeaderMap + نسخة احتياطية */
{
  const hdr = (programs.header && programs.header.length) ? programs.header : HS.defaultHeaderRow('4/10-10/10');
  const map = HS.buildHeaderMap(hdr);
  ok('29. HeaderMap من الترويسة الحية',
    map.ok === true && map.timestamp === 0 && map.supervisor === 1 &&
    map.notes === 14 && map.code === 15 && map.type === 16 && map.days.length === 6,
    'ts=' + map.timestamp + ' sup=' + map.supervisor + ' days=' + map.days.length);

  /* ترتيب الأعمدة لا يُفترض — نقل Timestamp والنوع إلى مواضع جديدة ثم إعادة البناء */
  const shuffled = hdr.slice();
  const tsCell = shuffled.splice(0, 1)[0];
  const typeCell = shuffled.splice(shuffled.length - 1, 1)[0];
  shuffled.splice(1, 0, typeCell);
  shuffled.push(tsCell);
  const map2 = HS.buildHeaderMap(shuffled);
  ok('29b. الترويسة تُتعرف بأي ترتيب (بلا افتراض مواضع)',
    map2.ok === true && map2.timestamp === shuffled.length - 1 && map2.type === 1 &&
    map2.supervisor === 0 && map2.days.length === 6,
    'ts=' + map2.timestamp + ' type=' + map2.type + ' sup=' + map2.supervisor + ' days=' + map2.days.length);

  const saved = HS.saveHeaderSnapshot(hdr);
  const back = HS.getHeaderSnapshot();
  ok('29c. نسخة Header تُحفظ وتُسترجع داخل الإعدادات',
    saved === true && Array.isArray(back) && back.length === hdr.length && back[0] === hdr[0],
    'cells=' + (back ? back.length : 0));
  HS.clearHeaderSnapshot();
  ok('29d. مسح نسخة Header', HS.getHeaderSnapshot() === null);
}

/* 30) الأسبوع التالي = الحالي + 7 أيام */
{
  const wk = weeks[0];
  const nk = WK.nextWeek(wk);
  const expStart = U.isoDate(U.addDays(U.parseIso(wk.start), 7));
  ok('30. الأسبوع التالي (+7 أيام)',
    nk && nk.start === expStart && nk.end === U.isoDate(U.addDays(U.parseIso(nk.start), 6)) &&
    nk.label && nk.label !== wk.label,
    wk.label + ' → ' + (nk && nk.label));
}

/* 31) الأرشيف يقرأ الصفوف المنقولة بتنسيق الردود (timestamp يحدد الأسبوع) */
{
  const hdr = HS.defaultHeaderRow('4/10-10/10');
  const dayCells = [];
  for (let d = 0; d < 6; d++) dayCells.push(d === 0 ? 'مدرسة الاختبار' : '', d === 0 ? 'نشاط الاختبار' : '');
  const row = ['06/10/2026 10:30:00', 'مشرف اختبار الترحيل', ...dayCells, 'ملاحظة تجريبية', '99887', 'تخطيط'];
  const txt = U.csvSerialize([hdr, row]);
  const p = M.parseAdminCsv(txt);
  ok('31. صف timestamp داخل الأرشيف يُقرأ ويُنسب لأسبوعه',
    p.records.length === 1 &&
    p.records[0].weekStart === '2026-10-04' &&
    p.records[0].supervisor === 'مشرف اختبار الترحيل' &&
    p.records[0].type === 'تخطيط' &&
    p.records[0].timestamp === '06/10/2026 10:30:00' &&
    p.records[0].days.length === 6 && p.records[0].notes === 'ملاحظة تجريبية' &&
    p.weeks.some((w) => w.start === '2026-10-04'),
    'records=' + p.records.length + ' week=' + (p.records[0] && p.records[0].weekStart) + ' weeks=' + p.weeks.length);

  /* الأسبوع المكيف للصف لا يعتمد على رأس قسم — يبقى ظاهراً في قائمة الأسابيع */
  const p2 = M.parseAdminCsv(U.csvSerialize([hdr]));
  ok('31b. ترويسة الردود في الأرشيف تُعامَل كترويسة لا كبيان',
    p2.records.length === 0 && p2.skipped.headers + p2.skipped.noise >= 1,
    'records=' + p2.records.length);
}

/* 32) تسميات الحالات النهائية (§7) */
{
  const s = CFG.statuses;
  ok('32. تسميات الحالات',
    s.none.label === 'لم يرسل البرنامج' && s.none.icon === '🔴' &&
    s.planning.label === 'أرسل التخطيط ولم يرسل الفعلي' && s.planning.icon === '🟠' &&
    s.actual.label === 'أرسل الفعلي' && s.actual.icon === '🟢' &&
    s.both.label === 'مكتمل' && s.both.icon === '🟢',
    [s.none.label, s.planning.label, s.actual.label, s.both.label].join(' | '));
}

/* 33) النصوص الموحدة (§6/§17/§29/§38) */
{
  const t = CFG.texts;
  ok('33. النصوص الموحدة',
    t.matchRule === 'Supervisor matching key = Supervisor Name' &&
    t.orphanWarning === '⚠ يوجد مشرف في ملف الردود غير موجود في البيانات الأساسية' &&
    t.failKeepResponses === '❌ فشل الترحيل، تم الاحتفاظ ببيانات الردود ولم يتم حذفها.' &&
    t.incompleteKeepResponses === '⚠ لم تكتمل عملية الترحيل. تم الاحتفاظ ببيانات الردود لحمايتها.' &&
    t.alreadyMigrated === '⚠ تم ترحيل هذا الأسبوع مسابقاً' &&
    t.confirmMigrate === 'تأكيد الترحيل والحذف' &&
    t.nextWeekReady === 'تم إعداد الأسبوع التالي' &&
    t.orphanReview === 'يتطلب مراجعة إدارية',
    'نصوص مطابقة للمواصفة');
}

/* 34) id → phone: الهاتف من الملف المرجعي ولا يدخل المطابقة */
{
  ok('34. المشرفون يحملون phone ولا يحملون id',
    master.every((s) => 'phone' in s) && master.every((s) => !('id' in s)) &&
    lists.supervisors.some((s) => s.phone) && lists.supervisors.every((s) => !('id' in s)),
    'بهم هاتف=' + master.filter((s) => s.phone).length + '/' + master.length);

  const wk = weeks[0];
  const st = ST.computeStatus(master, records, wk, { [master[0].nameNorm]: '0599123456' });
  ok('34b. صف الحالة: هاتف من الخريطة/الملف بلا id',
    !('id' in st.rows[0]) &&
    (st.rows[0].phone === '0599123456' || master[0].phone),
    'phone=' + st.rows[0].phone);

  const byPhone = ST.filterRows(st.rows, { filter: 'all', query: master[0].phone || '0000' });
  ok('34c. البحث لا يعمل برقم الهاتف',
    byPhone.length === 0 || !master[0].phone,
    'results=' + byPhone.length);
}

/* 35) ترويسة الردود متاحة للقراءة والتصدير */
{
  ok('35. parseProgramsCsv يعيد الترويسة',
    Array.isArray(programs.header) && programs.header.length === 17 &&
    String(programs.header[0]).toLowerCase().includes('timestamp') &&
    String(programs.header[1]).includes('اسم المشرف'),
    'cells=' + (programs.header ? programs.header.length : 0));
}

/* 36) قاعدة إسناد أسبوع الرد (§7): ترويسة الاستمارة + نافذة إرسال مبكر يومين (الجمعة/السبت) */
{
  const header = U.parseWeekLabel('4/10-10/10');
  const ts = (s) => U.parseTimestamp(s);
  const rFri = M.weekForResponse(ts('02/10/2026 09:00:00'), header);
  const rSat = M.weekForResponse(ts('03/10/2026 23:30:00'), header);
  const rSun = M.weekForResponse(ts('04/10/2026 00:16:00'), header);
  const rMon = M.weekForResponse(ts('05/10/2026 10:00:00'), header);
  const rThu = M.weekForResponse(ts('01/10/2026 12:00:00'), header);
  const rOld = M.weekForResponse(ts('20/09/2026 10:00:00'), header);
  const rNone = M.weekForResponse(null, header);
  const rNoHdr = M.weekForResponse(ts('03/10/2026 12:00:00'), null);
  ok('36. قاعدة إسناد الأسبوع: ترويسة + إرسال مبكر يومين (§7)',
    rFri.start === '2026-10-04' && rSat.start === '2026-10-04' &&
    rSun.start === '2026-10-04' && rMon.start === '2026-10-04' &&
    rThu.start === '2026-09-27' && rOld.start === '2026-09-20' &&
    rNone && rNone.start === header.start &&
    rNoHdr && rNoHdr.start === '2026-09-27',
    'جمعة/سبت→الترويسة · خميس→أسبوعه · بلاطابع→الترويسة');
}

/* 37) كل ردود الملف الحيّة منسوبة بالقاعدة الجديدة (سبب الجذر: 27/27 في الأسبوع المعلن) */
{
  const inHeader = programs.headerWeek && programs.records.every((r) => r.weekStart === programs.headerWeek.start);
  const ruleHolds = programs.records.every((r) => {
    const w = M.weekForResponse(U.parseTimestamp(r.timestamp), programs.headerWeek);
    return w && w.start === r.weekStart;
  });
  const accounting = programs.rawRows === programs.records.length + programs.excluded.length;
  ok('37. ردود الملف كلها في أسبوع الترويسة (لا ردود ضائعة في أسبوع سابق)',
    inHeader && ruleHolds && accounting,
    'سجلات=' + programs.records.length + ' · ترويسة=' + (programs.headerWeek && programs.headerWeek.label) +
    ' · مبكر=' + programs.records.filter((r) => r.early).length + ' · مستبعد=' + programs.excluded.length);
}

/* 38) إحصاءات الردود المنهجية: إجمالي/مخطط/فعلي/مميز/غائب — بالأرقام الفعلية */
{
  const data = { records, master, programs, admin, weeks };
  const wk = weeks.find((x) => x.label === '4/10-10/10') || weeks[0];
  const st = RS.responseStats(data, wk.start);
  const senders = new Set(programs.records.map((r) => r.supervisorNorm));
  const matched = Array.from(senders).filter((k) => master.some((s) => s.nameNorm === k)).length;
  ok('38. إحصاءات الردود المفصلة تطابق المصدر (27/26/1/27/4)',
    st.totalResponses === 27 &&
    st.planningResponses === 26 && st.actualResponses === 1 &&
    st.uniqueSupervisors === 27 && st.missingSupervisors === master.length - matched &&
    st.totalResponses === programs.records.length,
    `total=${st.totalResponses} plan=${st.planningResponses} act=${st.actualResponses} uniq=${st.uniqueSupervisors} missing=${st.missingSupervisors}`);
}

/* 39) لا ردود مفقودة عن شاشة الأسبوع بعد الإصلاح (مفتاح الفرق = صفر) */
{
  const data = { records, master, programs, admin, weeks };
  const wk = weeks.find((x) => x.label === '4/10-10/10') || weeks[0];
  const missing = RS.findMissingResponseRecords(data, wk.start);
  ok('39. الردود المفقودة عن شاشة الأسبوع = صفر',
    missing.length === 0,
    'missing=' + missing.length + (missing.length ? ' · ' + missing[0].reason : ''));
}

/* 40) وسم القسم في الأرشيف: صفوف الترحيل تُنسب لأسبوع الوسم حتى لو طابعها أقدم */
{
  const hdr = HS.defaultHeaderRow('4/10-10/10');
  const dayCells = [];
  for (let d = 0; d < 6; d++) dayCells.push(d === 0 ? 'مدرسة الوسم' : '', d === 0 ? 'نشاط الوسم' : '');
  const marker = [CFG.magicHeader, '4/10-10/10'];
  const early = ['03/10/2026 23:00:00', 'مشرف إرسال مبكر', ...dayCells, 'ملاحظة', '11223', 'تخطيط'];
  const withMarker = M.parseAdminCsv(U.csvSerialize([hdr, marker, early]));
  const without = M.parseAdminCsv(U.csvSerialize([hdr, early]));
  ok('40. وسم القسم يربط صفوف الترحيل بأسبوعها (إرسال مبكر)',
    withMarker.records.length === 1 && withMarker.records[0].weekStart === '2026-10-04' &&
    withMarker.weeks.some((w) => w.start === '2026-10-04') &&
    without.records.length === 1 && without.records[0].weekStart === '2026-09-27',
    'مع وسم=' + (withMarker.records[0] && withMarker.records[0].weekStart) +
    ' · بلا وسم=' + (without.records[0] && without.records[0].weekStart));
}

/* 41) الفرق بين المصدر (قراءة طازجة) والموقع (الذاكرة) = صفر — بالأرقام الحقيقية */
{
  const data = { records, master, programs, admin, weeks };
  const wk = weeks.find((x) => x.label === '4/10-10/10') || weeks[0];
  const cmp = await RS.compareSourceWithSite(data, wk.start);
  ok('41. فرق المصدر والموقع = صفر (كل الأسابيع + أسبوع العرض)',
    cmp.totalDifference === 0 && cmp.weekDifference === 0 &&
    cmp.fileTotal === cmp.siteTotal && cmp.fileWeek === cmp.siteWeek,
    `ملف=${cmp.fileTotal} موقع=${cmp.siteTotal} · أسبوع ${cmp.fileWeek}/${cmp.siteWeek} · خام=${cmp.rawRows}`);
}

/* 42) إرسال SMS: رسالة مستقلة باسم كل مشرف + الهاتف من مصدره (لا بمعرّف) */
{
  const rows = [
    { name: 'أحمد علي', nameNorm: 'احمد علي', phone: '' },
    { name: 'سارة حسن', nameNorm: 'سارة حسن', phone: '0599999999' },
  ];
  const msgs = SMS.buildMessages(rows, 'أهلاً {المشرف} — أسبوع {الاسبوع}',
    { week: { label: '4/10-10/10' }, type: CFG.typePlanning },
    { 'احمد علي': '0501234567' });
  ok('42. رسالة لكل مشرف باسمه + هاتف من الملف/الاستيراد فقط',
    msgs.length === 2 &&
    msgs[0].body.includes('أحمد علي') && !msgs[0].body.includes('سارة') &&
    msgs[1].body.includes('سارة حسن') && !msgs[1].body.includes('أحمد') &&
    msgs[0].body.includes('4/10-10/10') &&
    msgs[0].phone === '0501234567' && msgs[1].phone === '0599999999',
    msgs.map((m) => m.name + '=' + m.phone).join(' · '));
}

/* 43) تحقق رقم الجوال + أسباب الفشل بالعربية */
{
  ok('43. رقم جوال صالح + أسباب الفشل',
    SMS.isValidPhone('0591234567') && SMS.isValidPhone('+970599999999') &&
    !SMS.isValidPhone('123') && !SMS.isValidPhone('') && !SMS.isValidPhone(null) &&
    SMS.failureReason({ code: 'INVALID_PHONE' }, { phone: 'abc' }) === 'رقم الهاتف غير صالح' &&
    SMS.failureReason({ code: 'NO_PHONES' }, {}) === 'لا يوجد رقم هاتف' &&
    SMS.failureReason({ error: 'HTTP 500' }, { phone: '0591234567' }) === 'HTTP 500',
    SMS.failureReason({ code: 'INVALID_PHONE' }, { phone: 'abc' }));
}

/* 44) إرسال مجموعة: رقم غير صالح يفشل بلا استدعاء الشبكة + عدّاد التقدّم */
{
  const orig = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called++; throw new Error('net down'); };
  try {
    const progress = [];
    const res = await SMS.sendBatch({
      provider: 'api',
      entries: [
        { name: 'مشرف 1', phone: '12', body: 'رسالة 1' },
        { name: 'مشرف 2', phone: '0591234567', body: 'رسالة 2' },
      ],
      settings: { smsApiUrl: 'https://provider.example/api' },
      delayMs: 0,
      idempotencyKey: 'op44',
      onProgress: (p) => progress.push(p),
    });
    ok('44. مجموعة SMS: فشل الرقم غير الصالح + خطأ الشبكة برسالة عربية + تقدّم',
      res.total === 2 && res.failed === 2 && res.sent === 0 &&
      res.results[0].ok === false && res.results[0].code === 'INVALID_PHONE' &&
      res.results[1].ok === false && res.results[1].code === 'NETWORK' &&
      res.results[1].error === CFG.texts.smsUpstreamDown &&
      res.results[1].status === 'FAILED' &&
      called === 1 && progress.length === 2 &&
      progress[1].index === 2 && progress[1].remaining === 0,
      'failed=' + res.failed + ' netCalls=' + called);
  } finally {
    globalThis.fetch = orig;
  }
}

/* 45) نصوص التأكيد/التقدم/النتيجة حرفية كما في مواصفة الإرسال المباشر */
{
  ok('45. نصوص إرسال SMS الدقيقة (§2/§6)',
    CFG.texts.smsConfirmTitle === 'تأكيد إرسال الرسائل' &&
    CFG.texts.smsConfirmLine(5) === 'سيتم إرسال الرسالة إلى 5 مشرفين.' &&
    CFG.texts.smsAsk === 'هل تريد إرسال الرسالة الآن؟' &&
    CFG.texts.smsConfirmAction === 'تأكيد وإرسال' &&
    CFG.texts.smsSending === 'جاري إرسال الرسائل...' &&
    CFG.texts.smsProgress(3, 10) === 'تم إرسال 3 من 10' &&
    CFG.texts.smsSelectOne === 'يرجى اختيار مشرف واحد على الأقل قبل الإرسال.' &&
    CFG.texts.smsResultTotal === 'إجمالي الرسائل' &&
    CFG.texts.smsResultSent === 'تم الإرسال بنجاح' &&
    CFG.texts.smsResultFailed === 'فشل الإرسال' &&
    CFG.texts.smsRetryFailed === 'إعادة إرسال الرسائل الفاشلة' &&
    CFG.texts.smsChosen(7) === 'تم اختيار 7 مشرفين' &&
    CFG.texts.smsChars(85) === 'عدد الأحرف: 85' &&
    CFG.texts.smsParts(2) === 'عدد الرسائل المتوقعة: 2' &&
    CFG.texts.smsFailSentence('محمد أحمد', 'رقم الهاتف غير صالح') === 'تعذر إرسال الرسالة إلى محمد أحمد بسبب رقم الهاتف غير صالح.' &&
    CFG.texts.smsNoPhoneLine('خالد سعيد') === 'خالد سعيد — لا يوجد رقم جوال صالح' &&
    CFG.texts.smsProviderNotice.includes('تم إرسال الطلب إلى مزود الرسائل') &&
    CFG.texts.smsStatus.SENT === 'تم الإرسال' && CFG.texts.smsStatus.PENDING === 'تم الطلب',
    CFG.texts.smsConfirmLine(5));
}

/* 46) وسم القسم في ملف الردود: يُنسب للأسبوع الصحيح ولا يُعد سجلاً */
{
  const hdr = ['Timestamp', 'اسم المشرف', '4/10-10/10', '', '', '', '', '', '', '', '', '', '', '', 'ملاحظات', 'كود', 'نوع البرنامج'];
  const marker = [CFG.magicHeader, '27/9-3/10'];
  const row = ['03/10/2026 23:00:00', 'مشرف تجريبي', 'مدرسة', 'نشاط', '', '', '', '', '', '', '', '', '', '', 'م', '112', 'تخطيط'];
  const p = M.parseProgramsCsv(U.csvSerialize([hdr, marker, row]));
  const pNoMarker = M.parseProgramsCsv(U.csvSerialize([hdr, row]));
  ok('46. وسم القسم في الردود: إسناد للأسبوع + بلا سجلات وهمية',
    p.records.length === 1 && p.records[0].weekStart === '2026-09-27' &&
    p.rawRows === 1 && p.excluded.length === 0 &&
    pNoMarker.records.length === 1 && pNoMarker.records[0].weekStart === '2026-10-04',
    'مع وسم=' + (p.records[0] || {}).weekStart + ' · بلا=' + (pNoMarker.records[0] || {}).weekStart +
    ' · raw=' + p.rawRows + ' · مستبعد=' + p.excluded.length);
}

/* 47) مانع التراجع: لا تراجع إلا عن مكتملة أحدث ببيانات كاملة */
{
  const mk = (over) => Object.assign({
    id: 'e1', opNo: 1, ts: 1000, status: 'مكتمل',
    weekStart: '2026-10-04', weekEnd: '2026-10-10', weekLabel: '4/10-10/10',
    records: 2, migratedKeys: ['k1', 'k2'], migratedRows: [[], []],
    deleteTargets: [{ t: '1', s: 'a' }, { t: '2', s: 'b' }],
    pendingDelete: null,
  }, over || {});
  const e = mk();
  const list = [e];
  ok('47. مانع التراجع يغطي الحالات المحظورة كلها (§10)',
    MS.undoBlockReason(e, list) === null &&
    MS.undoBlockReason(null, list) === CFG.texts.undoNoEntry &&
    MS.undoBlockReason(mk({ status: 'REVERSED' }), list) === CFG.texts.undoUndone &&
    MS.undoBlockReason(mk({ status: 'جزئي' }), list) === CFG.texts.undoIncomplete &&
    MS.undoBlockReason(mk({ pendingDelete: [{ t: '1', s: 'a' }] }), list) === CFG.texts.undoIncomplete &&
    MS.undoBlockReason(mk({ migratedKeys: [] }), list) === CFG.texts.undoNoKeys &&
    MS.undoBlockReason(mk({ migratedRows: [] }), list) === CFG.texts.undoNoKeys &&
    MS.undoBlockReason(mk({ deleteTargets: [] }), list) === CFG.texts.undoNoKeys &&
    MS.undoBlockReason(mk({ id: 'e0', ts: 500 }), [mk({ id: 'e2', ts: 2000 })]) === CFG.texts.undoNewer,
    MS.undoBlockReason(e, list) === null ? 'entry=صالح' : 'entry=محظور');
}

/* 48) تحقق مفاتيح التراجع في الأرشيف + إرجاع الأسبوع السابق */
{
  const archiveRecs = [
    { weekStart: '2026-10-04', supervisorNorm: 'احمد علي', type: 'تخطيط', days: [{ school: 'م1', activity: 'ن1' }] },
    { weekStart: '2026-10-04', supervisorNorm: 'سارة حسن', type: 'فعلي', days: [{ school: 'م2', activity: 'ن2' }] },
  ];
  const keys = archiveRecs.map(DS.recordKey);
  const v1 = MS.verifyKeysInArchive({ migratedKeys: keys }, archiveRecs);
  const v2 = MS.verifyKeysInArchive({ migratedKeys: keys.concat('k-x') }, archiveRecs);
  const v3 = MS.verifyKeysInArchive({ migratedKeys: [] }, archiveRecs);
  const weekList = [{ start: '2026-10-04' }, { start: '2026-09-27' }, { start: '2026-09-20' }];
  const prev = MS.weekBeforeEntry({ weekStart: '2026-10-04' }, weekList);
  ok('48. تحقق 100% للمفاتيح + الأسبوع السابق',
    v1.ok && v1.found === 2 && !v2.ok && v2.found === 2 && !v3.ok &&
    prev && prev.start === '2026-09-27',
    'found=' + v1.found + '/' + v1.expected + ' · prev=' + (prev && prev.start));
}

/* 49) سجل العمليات المهيكل: العملية/الأسبوع/العدد/التاريخ/المستخدم/الحالة */
{
  LOG.logClear();
  LOG.logAdd('ترحيل الأسبوع', 'تفاصيل الترحيل', { op: 'ترحيل', week: '4/10-10/10', count: 25, user: 'مدير', status: 'مكتمل' });
  LOG.logAdd('تراجع عن ترحيل', 'تفاصيل التراجع', { op: 'تراجع', week: '4/10-10/10', count: 25, user: 'مدير', status: 'تم التراجع' });
  LOG.logAdd('إرسال SMS', '10 رسائل', { op: 'إرسال SMS', count: 10, status: 'ناجح' });
  LOG.logAdd('عملية قديمة', 'بلا حقول منظمة');
  const rows = LOG.logRows(10);
  ok('49. جدول سجل العمليات بأعمدته الستة + تفاصيل',
    rows.length === 4 &&
    rows[0].op === 'عملية قديمة' && rows[0].week === '—' && rows[0].user === '—' && rows[0].status === 'ناجح' &&
    rows[1].op === 'إرسال SMS' && rows[1].count === '10' && rows[1].status === 'ناجح' &&
    rows[2].op === 'تراجع' && rows[2].status === 'تم التراجع' && rows[2].week === '4/10-10/10' && rows[2].count === '25' &&
    rows[3].op === 'ترحيل' && rows[3].user === 'مدير' && rows[3].status === 'مكتمل' && rows[3].week === '4/10-10/10' &&
    rows.every((r) => r.time && r.time !== '—'),
    rows.map((r) => r.op + ':' + r.status).join(' | '));
  LOG.logClear();
}

/* 50) سجل إرسال الرسائل: اسم/هاتف/وقت/نص/حالة/سبب الخطأ */
{
  LOG.smsLogClear();
  LOG.smsLogAdd({ name: 'مشرف أ', phone: '0591111111', body: 'نص الرسالة', ok: true, provider: 'api' });
  LOG.smsLogAdd({ name: 'مشرف ب', phone: '12', body: 'نص الرسالة', ok: false, provider: 'api', error: 'رقم الهاتف غير صالح' });
  const l = LOG.smsLogList();
  ok('50. سجل الرسائل بالحقول الستة',
    l.length === 2 && l[0].name === 'مشرف ب' && l[0].status === 'فشل' &&
    l[0].error === 'رقم الهاتف غير صالح' && l[0].phone === '12' &&
    l[1].ok === true && l[1].status === 'تم الإرسال' && l[1].body === 'نص الرسالة' && !!l[1].time,
    l.length + ' سجل · ' + l[0].status + ' / ' + l[1].status);
  LOG.smsLogClear();
}

/* 51) نصوص التراجع الدقيقة (§6/§7/§10) */
{
  ok('51. نصوص التراجع الدقيقة',
    CFG.texts.undoButton === '↩ التراجع عن آخر ترحيل' &&
    CFG.texts.undoConfirmTitle === 'التراجع عن عملية الترحيل' &&
    CFG.texts.undoAsk === 'هل أنت متأكد من التراجع عن هذه العملية؟' &&
    CFG.texts.undoConfirmAction === 'تأكيد التراجع' &&
    CFG.texts.undoAbort === 'تعذر التحقق من السجلات المرحّلة، لذلك تم إيقاف عملية التراجع حفاظًا على البيانات.' &&
    CFG.texts.undoSuccessTitle === 'تم التراجع عن عملية الترحيل' &&
    CFG.texts.undoNoEntry === 'لا توجد عملية ترحيل قابلة للتراجع.',
    CFG.texts.undoButton);
}

/* 52) التراجع بلا عملية سابقة = رفض صريح قبل أي استدعاء شبكة */
{
  const res = await MS.executeUndo({ entry: null, appsScriptUrl: 'https://x/exec' });
  const resKeys = await MS.executeUndo({
    entry: { id: 'z', ts: 1, status: 'مكتمل', migratedKeys: [], migratedRows: [], deleteTargets: [] },
    appsScriptUrl: 'https://x/exec',
  });
  ok('52. تنفيذ التراجع بلا عملية/بمفاتيح ناقصة = إيقاف فوري',
    res.ok === false && res.code === 'BLOCKED' && res.error === CFG.texts.undoNoEntry &&
    resKeys.ok === false && resKeys.code === 'BLOCKED' && resKeys.error === CFG.texts.undoNoKeys,
    res.code + ' / ' + resKeys.code);
}

/* 53) sheetId اختياري: إضافة للأرشيف والردود + حذف من أحدهما */
{
  const orig = globalThis.fetch;
  let payload = null;
  globalThis.fetch = async (url, opts) => {
    payload = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ ok: true, appended: 1, skipped: 0, headerWritten: false, deleted: 1, expected: 1 }) };
  };
  try {
    await SS.appendData({ rows: [['a']], weekLabel: '4/10-10/10', appsScriptUrl: 'https://x/exec', sheetId: CFG.sheetIds.programs });
    const p1 = payload;
    await SS.deleteResponseRows({ rows: [{ t: '1', s: 'a' }], appsScriptUrl: 'https://x/exec', sheetId: CFG.sheetIds.admin });
    const p2 = payload;
    await SS.appendData({ rows: [['b']], appsScriptUrl: 'https://x/exec' });
    const p3 = payload;
    await SS.deleteResponseRows({ rows: [{ t: '2', s: 'b' }], appsScriptUrl: 'https://x/exec' });
    const p4 = payload;
    ok('53. sheetId اختياري (ردود/أرشيف) مع الافتراضي السابق',
      p1.action === 'append' && p1.sheetId === CFG.sheetIds.programs &&
      p2.action === 'deleteRows' && p2.sheetId === CFG.sheetIds.admin &&
      p3.action === 'append' && p3.sheetId === CFG.sheetIds.admin &&
      p4.action === 'deleteRows' && p4.sheetId === CFG.sheetIds.programs,
      [p1.sheetId === CFG.sheetIds.programs, p2.sheetId === CFG.sheetIds.admin, p3.sheetId === CFG.sheetIds.admin, p4.sheetId === CFG.sheetIds.programs].join(','));
  } finally {
    globalThis.fetch = orig;
  }
}

/* 54) أيقونة التطبيق داخل المشروع + manifest + روابط HTML */
{
  const fs = require('fs');
  const path = require('path');
  const { fileURLToPath } = require('url');
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const iconOk = manifest.icons.every((i) => fs.existsSync(path.join(root, i.src)));
  const sizesOk = [16, 32, 48, 72, 96, 128, 144, 152, 180, 192, 256, 384, 512]
    .every((n) => fs.existsSync(path.join(root, 'assets', 'icons', 'icon-' + n + '.png')));
  ok('54. أيقونات الهاتف داخل المشروع (بلا مسارات خارجية)',
    iconOk && sizesOk &&
    fs.existsSync(path.join(root, 'assets', 'icons', 'favicon.ico')) &&
    fs.existsSync(path.join(root, 'assets', 'icons', 'maskable-512.png')) &&
    fs.existsSync(path.join(root, 'assets', 'icons', 'icon.svg')) &&
    manifest.name.includes('برامج المشرفين') && manifest.dir === 'rtl' && manifest.display === 'standalone' &&
    html.includes('rel="manifest"') && html.includes('apple-touch-icon') && html.includes('theme-color'),
    'icons=' + manifest.icons.length + ' · sizes=' + sizesOk);
}

/* 55) تنظيف وتحقق رقم الجوال قبل الإرسال (§8) */
{
  ok('55. تنظيف الهاتف: مسافات/شرطات/+ دولي/أرقام مشوّهة',
    SMS.normalizePhone(' 059 123-4567 ') === '0591234567' &&
    SMS.normalizePhone('+970 59 123 4567') === '+970591234567' &&
    SMS.validatePhone('059 123 4567').ok === true &&
    SMS.validatePhone('059 123 4567').phone === '0591234567' &&
    SMS.validatePhone('+970591234567').ok === true &&
    SMS.validatePhone('123').ok === false && SMS.validatePhone('123').code === 'INVALID_PHONE' &&
    SMS.validatePhone('').code === 'NO_PHONES' && SMS.validatePhone(null).reason === 'لا يوجد رقم جوال صالح',
    SMS.validatePhone('059 123 4567').phone);
}

/* 56) عدد الرسائل المتوقعة: GSM-7 مقابل يونيكود (§10) */
{
  const a160 = SMS.smsSegments('x'.repeat(160));
  const a161 = SMS.smsSegments('x'.repeat(161));
  const u70 = SMS.smsSegments('م'.repeat(70));
  const u71 = SMS.smsSegments('م'.repeat(71));
  ok('56. مقاطع الرسالة: لاتيني 160/153 · عربي 70/67',
    SMS.smsSegments('') === 1 && SMS.smsSegments('Hello') === 1 &&
    a160 === 1 && a161 === 2 && u70 === 1 && u71 === 2 &&
    SMS.smsSegments('x'.repeat(306)) === 2 && SMS.smsSegments('x'.repeat(307)) === 3,
    'ascii=' + a160 + '/' + a161 + ' · arabic=' + u70 + '/' + u71);
}

/* 57) sendSms: طلب مباشر للبوابة + رقم منظّف + Idempotency + الحالة */
{
  let captured = null;
  const fetchMock = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, results: [{ ok: true, status: 'PENDING', messageId: 'MSG-9' }] }) };
  };
  const res = await SMS.sendSms('059 123 4567', 'أهلاً', { settings: {}, idempotencyKey: 'op:0', fetchImpl: fetchMock });
  ok('57. sendSms: POST للبوابة + هاتف منظّف + Idempotency-Key + Message ID',
    res.ok === true && res.status === 'PENDING' && res.messageId === 'MSG-9' &&
    captured.url === '/api/sms/send' &&
    captured.body.to === '0591234567' && captured.body.message === 'أهلاً' &&
    captured.body.idempotencyKey === 'op:0',
    'status=' + res.status + ' id=' + res.messageId);
}

/* 58) أخطاء البوابة برسائل عربية مفهومة بلا Stack Trace (§15) */
{
  const html404 = async () => ({ ok: false, status: 404, text: async () => '<html>404 page</html>' });
  const notCfg = async () => ({ ok: false, status: 501, text: async () => JSON.stringify({ ok: false, code: 'NOT_CONFIGURED', error: 'لم يتم تهيئة مزود SMS على الخادم (SMS_UPSTREAM_URL).' }) });
  const r1 = await SMS.sendSms('0591234567', 'x', { settings: {}, fetchImpl: html404 });
  const r2 = await SMS.sendSms('0591234567', 'x', { settings: {}, fetchImpl: notCfg });
  const r3 = await SMS.sendSms('', 'x', { settings: {}, fetchImpl: html404 });
  const r4 = await SMS.sendSms('0591234567', '   ', { settings: {}, fetchImpl: html404 });
  ok('58. أخطاء مفهومة: بوابة غير موجودة/غير مهيأة/رقم ناقص/نص فارغ',
    r1.ok === false && r1.code === 'GATEWAY_UNAVAILABLE' && r1.error === CFG.texts.smsGatewayDown &&
    r2.ok === false && r2.code === 'NOT_CONFIGURED' && r2.error.includes('SMS_UPSTREAM_URL') &&
    r3.code === 'NO_PHONES' && r3.error === 'لا يوجد رقم جوال صالح' &&
    r4.code === 'EMPTY_MESSAGE' &&
    !String(r1.error).includes('at ') && !String(r2.error).includes('Error:'),
    r1.code + ' / ' + r2.code + ' / ' + r3.code + ' / ' + r4.code);
}

/* 59) إرسال مجموعة: ناجح + رقم غير صالح + انقطاع — بلا إيقاف الكلي (§5) */
{
  const calls = [];
  const fetchMock = async (url, opts) => {
    const b = JSON.parse(opts.body);
    calls.push(b);
    if (b.to === '0599999999') throw new Error('conn reset');
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, results: [{ ok: true, status: 'SENT', messageId: 'ID-' + b.to }] }) };
  };
  const recipients = [
    { name: 'أحمد', phone: '0591111111', body: 'رسالة أحمد' },
    { name: 'محمد', phone: '12', body: 'رسالة محمد' },
    { name: 'خالد', phone: '0599999999', body: 'رسالة خالد' },
    { name: 'سعيد', phone: '0592222222', body: 'رسالة سعيد' },
  ];
  const progress = [];
  const res = await SMS.sendBulkSms(recipients, 'نص عام', { settings: {}, idempotencyKey: 'bulk1', delayMs: 0, fetchImpl: fetchMock, onProgress: (p) => progress.push(p) });
  ok('59. bulk: 4 مشرفين ← 2 ناجح + غير صالح + منقطع، والاستمرار بعد كل فشل',
    res.total === 4 && res.sent === 2 && res.failed === 2 &&
    res.results[0].ok === true && res.results[0].messageId === 'ID-0591111111' &&
    res.results[1].code === 'INVALID_PHONE' &&
    res.results[2].code === 'NETWORK' &&
    res.results[3].ok === true &&
    calls.length === 3 &&
    calls[0].idempotencyKey === 'bulk1:0' && calls[1].idempotencyKey === 'bulk1:2' &&
    progress.length === 4 && progress[3].index === 4,
    'sent=' + res.sent + ' failed=' + res.failed + ' calls=' + calls.length);
}

/* 60) انقطاع بعد الثالثة: الناجحة محفوظة ولا تُعاد (§16) */
{
  let n = 0;
  const seq = [];
  const fetchMock = async (url, opts) => {
    n++;
    const b = JSON.parse(opts.body);
    seq.push(b.to);
    if (n > 3) throw new Error('offline');
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, results: [{ ok: true, status: 'SENT', messageId: 'M' + n }] }) };
  };
  const recipients = ['0591111111', '0592222222', '0593333333', '0594444444', '0595555555']
    .map((p, i) => ({ name: 'مشرف ' + i, phone: p, body: 'نص' }));
  const res = await SMS.sendBulkSms(recipients, 'نص', { settings: {}, idempotencyKey: 'cut', delayMs: 0, fetchImpl: fetchMock });
  ok('60. انقطاع بعد 3: 3 تم · 2 لم تُرسل · بلا إعادة للناجحة',
    res.total === 5 && res.sent === 3 && res.failed === 2 &&
    res.results.slice(0, 3).every((r) => r.ok) &&
    res.results.slice(3).every((r) => !r.ok && r.code === 'NETWORK') &&
    n === 5 && seq.length === 5,
    'sent=' + res.sent + ' calls=' + n);
}

/* 61) منع الإرسال المكرر في البوابة: نفس Idempotency-Key ← مزوّد واحد (§7) */
{
  GW.clearIdempotencyCache();
  let upstreamCalls = 0;
  const upstreamFetch = async () => { upstreamCalls++; return { ok: true, json: async () => ({ id: 'UP-1', status: 'accepted' }) }; };
  const env = { SMS_UPSTREAM_URL: 'https://up.example/send' };
  const body = { to: '0591234567', message: 'أهلاً', idempotencyKey: 'opX:0' };
  const r1 = await GW.routeSms({ method: 'POST', path: '/api/sms/send', body, env, fetchImpl: upstreamFetch });
  const r2 = await GW.routeSms({ method: 'POST', path: '/api/sms/send', body, env, fetchImpl: upstreamFetch });
  ok('61. Idempotency: نفس المفتاح مرتين ← استدعاء المزوّد مرة واحدة فقط',
    r1.status === 200 && r1.json.ok === true && r1.json.results[0].messageId === 'UP-1' &&
    r1.json.results[0].status === 'PENDING' &&
    r2.json.results[0].deduped === true && r2.json.results[0].messageId === 'UP-1' &&
    upstreamCalls === 1,
    'upstreamCalls=' + upstreamCalls);
}

/* 62) إعادة إرسال الفاشلة فقط — الناجحة لا تُعاد (§17) */
{
  const attempts = [];
  const fetchFailOne = async (url, opts) => {
    const b = JSON.parse(opts.body);
    attempts.push(b.to);
    if (b.to === '0595555555') throw new Error('down');
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, results: [{ ok: true, status: 'SENT', messageId: 'R' }] }) };
  };
  const recipients = [
    { name: 'أول', phone: '0591111111', body: 'ن' },
    { name: 'ثاني', phone: '0595555555', body: 'ن' },
  ];
  const r1 = await SMS.sendBulkSms(recipients, 'ن', { settings: {}, idempotencyKey: 'rt', delayMs: 0, fetchImpl: fetchFailOne });
  const failedEntries = SMS.onlyFailed(r1.results).map((fr) => recipients.find((x) => x.phone === fr.phone));
  attempts.length = 0;
  const fetchOk = async (url, opts) => {
    const b = JSON.parse(opts.body);
    attempts.push(b.to);
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, results: [{ ok: true, status: 'SENT', messageId: 'R2' }] }) };
  };
  const r2 = await SMS.sendBulkSms(failedEntries, 'ن', { settings: {}, idempotencyKey: 'rt-a2', delayMs: 0, fetchImpl: fetchOk });
  ok('62. إعادة الفاشلة فقط: استدعاء واحد للرقم الفاشل ولا إعادة للناجح',
    r1.sent === 1 && r1.failed === 1 &&
    SMS.onlyFailed(r1.results).length === 1 &&
    attempts.length === 1 && attempts[0] === '0595555555' &&
    r2.sent === 1 && r2.failed === 0,
    'retryCalls=' + attempts.join(','));
}

/* 63) البوابة: بلا إعداد501 عربي · خطأ المزوّد مفهوم · لا سر في الاستجابة */
{
  GW.clearIdempotencyCache();
  const h = await GW.routeSms({ method: 'GET', path: '/api/sms/health', env: {}, fetchImpl: null });
  const s = await GW.routeSms({ method: 'POST', path: '/api/sms/send', body: { to: '0591234567', message: 'x' }, env: {}, fetchImpl: null });
  let upCalls = 0;
  const up = async () => { upCalls++; return { ok: false, status: 500, json: async () => ({ error: 'boom' }) }; };
  const envSecret = { SMS_UPSTREAM_URL: 'https://up.example', SMS_API_TOKEN: 'SUPER-SECRET-TOKEN-123' };
  const s500 = await GW.routeSms({ method: 'POST', path: '/api/sms/send', body: { to: '0591234567', message: 'x' }, env: envSecret, fetchImpl: up });
  const raw = JSON.stringify(s500.json);
  const invalid = await GW.routeSms({ method: 'POST', path: '/api/sms/send', body: { to: '12', message: 'x' }, env: envSecret, fetchImpl: up });
  ok('63. البوابة: 501 عربي بلا إعداد · 500 مفهوم · بلا تسريب سر · رقم غير صالح بلا استدعاء',
    h.json.configured === false && h.status === 200 &&
    s.status === 501 && s.json.code === 'NOT_CONFIGURED' && s.json.error.includes('SMS_UPSTREAM_URL') &&
    s500.status === 502 && s500.json.results[0].error.includes('خطأ مؤقت') &&
    !raw.includes('SUPER-SECRET-TOKEN-123') &&
    invalid.status === 400 && invalid.json.results[0].code === 'INVALID_PHONE' &&
    upCalls === 1,
    's500=' + s500.status + ' invalid=' + invalid.status + ' up=' + upCalls);
}

/* 64) تكامل حقيقي عبر HTTP: الواجهة ← بوابة الخادم ← مزوّد وهمي ← Message ID */
{
  const http = await import('http');
  const upstreamSeen = [];
  let port = 0;
  const srv = http.createServer(async (req, res) => {
    let d = '';
    for await (const c of req) d += c;
    if (req.url === '/up') {
      upstreamSeen.push(JSON.parse(d || '{}'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'UP-77', status: 'accepted' }));
      return;
    }
    if (req.url === '/api/sms/send') {
      const out = await GW.routeSms({
        method: 'POST',
        path: '/api/sms/send',
        body: JSON.parse(d || '{}'),
        env: { SMS_UPSTREAM_URL: 'http://127.0.0.1:' + port + '/up' },
      });
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.json));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  try {
    const r = await SMS.sendSms('+970 59 123 4567', 'رسالة تكامل', {
      settings: { smsGatewayUrl: 'http://127.0.0.1:' + port + '/api/sms/send' },
      idempotencyKey: 'it:1',
    });
    ok('64. تكامل HTTP كامل: عميل ← بوابة ← مزوّد وهمي ← Message ID',
      r.ok === true && r.status === 'PENDING' && r.messageId === 'UP-77' &&
      upstreamSeen.length === 1 &&
      upstreamSeen[0].to === '+970591234567' &&
      upstreamSeen[0].message === 'رسالة تكامل' &&
      upstreamSeen[0].idempotencyKey === 'it:1:+970591234567',
      'status=' + r.status + ' id=' + r.messageId);
  } finally {
    srv.close();
  }
}

/* 65) سجل الرسائل: الحالات + Message ID + المستخدم + هاتف مموّه (§11) */
{
  LOG.smsLogClear();
  LOG.smsLogAdd({ name: 'مشرف تجريبي', phone: '0591234567', body: 'نص الرسالة', status: 'PENDING', messageId: 'MSG-5', user: 'مدير', provider: 'gateway' });
  LOG.smsLogAdd({ name: 'آخر', phone: '0599999999', body: 'نص الرسالة', status: 'FAILED', ok: false, user: 'مدير', error: 'رقم الهاتف غير صالح', provider: 'gateway' });
  const l = LOG.smsLogList();
  ok('65. سجل SMS: PENDING/FAILED + Message ID + مستخدم + هاتف مموّه آمن',
    l.length === 2 &&
    l[0].statusCode === 'FAILED' && l[0].status === 'فشل' && l[0].error === 'رقم الهاتف غير صالح' &&
    l[1].statusCode === 'PENDING' && l[1].status === 'تم الطلب' &&
    l[1].messageId === 'MSG-5' && l[1].user === 'مدير' &&
    l[1].phone === '0591****67' && l[1].phone.indexOf('0591234567') === -1,
    l[1].phone + ' / ' + l[1].status);
  LOG.smsLogClear();
}

/* سجل العمليات + أدوات */
LOG.logAdd('اختبار', 'سطر تجريبي');
ok('bonus. سجل العمليات', LOG.logList().length >= 1);
ok('bonus. ltr يعزل النص', U.ltr('4/10-10/10').charCodeAt(0) === 0x2066);

console.log('\n=========================');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
