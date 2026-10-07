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

/* سجل العمليات + أدوات */
LOG.logAdd('اختبار', 'سطر تجريبي');
ok('bonus. سجل العمليات', LOG.logList().length >= 1);
ok('bonus. ltr يعزل النص', U.ltr('4/10-10/10').charCodeAt(0) === 0x2066);

console.log('\n=========================');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
