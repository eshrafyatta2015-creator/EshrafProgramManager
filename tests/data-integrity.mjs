import { parseListsCsv, parseAdminCsv, parseProgramsCsv, buildMasterSupervisors, allWeeks, defaultWeek } from '../js/models.js';
import { computeStatus } from '../js/services/statusService.js';
import { CFG } from '../js/config.js';

const NC = '&nc=' + Date.now();
const [listsTxt, adminTxt, programsTxt] = await Promise.all([
  fetch(CFG.sheets.lists + NC).then((r) => r.text()),
  fetch(CFG.sheets.admin + NC).then((r) => r.text()),
  fetch(CFG.sheets.programs + NC).then((r) => r.text()),
]);

const lists = parseListsCsv(listsTxt);
console.log('LISTS: schools=%d activities=%d supervisors=%d withID=%d',
  lists.schools.length, lists.activities.length, lists.supervisors.length,
  lists.supervisors.filter((s) => s.id).length);

const admin = parseAdminCsv(adminTxt);
console.log('ADMIN: weeks=%d records=%d skipped=%j', admin.weeks.length, admin.records.length, admin.skipped);
console.log('ADMIN newest week:', JSON.stringify(admin.weeks[0]), 'oldest:', JSON.stringify(admin.weeks[admin.weeks.length - 1]));

const programs = parseProgramsCsv(programsTxt);
console.log('PROGRAMS: headerWeek=%s records=%d types=%j',
  JSON.stringify(programs.headerWeek && programs.headerWeek.label),
  programs.records.length,
  programs.records.reduce((a, r) => { a[r.type || 'null'] = (a[r.type || 'null'] || 0) + 1; return a; }, {}));

const master = buildMasterSupervisors(lists, admin.records, programs.records);
console.log('MASTER supervisors:', master.length, '| with ID:', master.filter((s) => s.id).length);

const weeks = allWeeks(admin.weeks, programs.headerWeek, programs.records);
console.log('ALL WEEKS:', weeks.length, '| default:', JSON.stringify(defaultWeek(weeks)));

const records = admin.records.concat(programs.records);

const cur = weeks.find((w) => w.label === '4/10-10/10');
const stCur = computeStatus(master, records, cur, {});
console.log('STATUS current week 4/10-10/10:', JSON.stringify(stCur.stats));

const lastArch = admin.weeks[0];
const stArch = computeStatus(master, records, lastArch, {});
console.log('STATUS archive week', lastArch.label + ':', JSON.stringify(stArch.stats));
const sample = stArch.rows.filter((r) => r.recordCount > 0).slice(0, 4);
console.log('sample rows:', sample.map((r) => ({ n: r.name.slice(0, 18), p: r.sentPlanning, a: r.sentActual, ls: r.lastSent })));

const typeTotals = admin.records.reduce((a, r) => { a[r.type || 'null'] = (a[r.type || 'null'] || 0) + 1; return a; }, {});
console.log('ADMIN types:', JSON.stringify(typeTotals), '| null-type rows:', typeTotals.null || 0);

const noType = admin.records.filter((r) => !r.type);
console.log('null-type examples:', noType.slice(0, 5).map((r) => ({ w: r.weekStart, s: r.supervisor.slice(0, 20), c14: r.code.slice(0, 12) })));
