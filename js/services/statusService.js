/* StatusService — من أرسل التخطيط/الفعلي لكل أسبوع */

import { CFG } from '../config.js';
import { normName, formatDate, parseTimestamp } from '../utils.js';

export function statusOf(sentPlanning, sentActual) {
  if (sentPlanning && sentActual) return CFG.statuses.both;
  if (sentPlanning) return CFG.statuses.planning;
  if (sentActual) return CFG.statuses.actual;
  return CFG.statuses.none;
}

function lastSentLabel(recs, week) {
  let best = null;
  let bestT = -1;
  for (const r of recs) {
    if (r.tsTime != null && r.tsTime > bestT) { bestT = r.tsTime; best = r; }
  }
  if (best) {
    const d = parseTimestamp(best.timestamp);
    if (d) return formatDate(d);
  }
  if (recs.length && week && week.label) return week.label;
  return '—';
}

export function computeStatus(master, records, week, phones) {
  const phoneMap = phones || {};
  const start = typeof week === 'string' ? week : week && week.start;
  const weekObj = typeof week === 'string' ? null : week;

  const rows = master.map((sup) => {
    const recs = records.filter((r) => r.supervisorNorm === sup.nameNorm && r.weekStart === start);
    const sentPlanning = recs.some((r) => r.type === CFG.typePlanning);
    const sentActual = recs.some((r) => r.type === CFG.typeActual);
    const st = statusOf(sentPlanning, sentActual);
    return {
      name: sup.name,
      nameNorm: sup.nameNorm,
      id: sup.id || '',
      phone: phoneMap[sup.nameNorm] || phoneMap[sup.id] || '',
      sentPlanning,
      sentActual,
      status: st,
      lastSent: lastSentLabel(recs, weekObj),
      recordCount: recs.length,
      records: recs,
    };
  });

  const total = rows.length;
  const planning = rows.filter((r) => r.sentPlanning).length;
  const actual = rows.filter((r) => r.sentActual).length;
  const completion = total ? Math.round(((planning + actual) / (total * 2)) * 1000) / 10 : 0;

  return {
    rows,
    stats: {
      total,
      planning,
      notPlanning: total - planning,
      actual,
      notActual: total - actual,
      completion,
    },
  };
}

export function filterRows(rows, { filter = 'all', query = '' } = {}) {
  let out = rows;
  if (filter === 'planning') out = out.filter((r) => r.sentPlanning);
  else if (filter === 'notPlanning') out = out.filter((r) => !r.sentPlanning);
  else if (filter === 'actual') out = out.filter((r) => r.sentActual);
  else if (filter === 'notActual') out = out.filter((r) => !r.sentActual);
  else if (filter === 'complete') out = out.filter((r) => r.sentPlanning && r.sentActual);
  else if (filter === 'incomplete') out = out.filter((r) => !(r.sentPlanning && r.sentActual));
  else if (filter === 'none') out = out.filter((r) => !r.sentPlanning && !r.sentActual);
  else if (filter === 'sentAny') out = out.filter((r) => r.sentPlanning || r.sentActual);

  const q = normName(query);
  if (q) out = out.filter((r) => r.nameNorm.includes(q) || (r.id && r.id.includes(query.trim())));
  return out;
}
