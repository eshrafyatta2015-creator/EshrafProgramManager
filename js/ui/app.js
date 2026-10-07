/* app.js — الحالة العامة والتنقل والتحديث */

import { CFG } from '../config.js';
import { storeGet, storeSet, formatDateTime, pad2, addDays, isoDate, parseIso, sundayOf, weekLabelFromDates, escapeHtml, uid, ltr } from '../utils.js';
import { getData, getDataFromCache } from '../services/sheetsService.js';
import { computeStatus } from '../services/statusService.js';
import { logAdd } from '../services/logService.js';
import { $, $$, toast, setLoading, showModal, confirmModal } from './components.js';
import * as dashboard from './dashboard.js';
import * as supervisors from './supervisors.js';
import * as compare from './compare.js';
import * as details from './details.js';
import * as sms from './sms.js';
import * as migrate from './migrate.js';
import * as reports from './reports.js';
import * as diagnostics from './diagnostics.js';
import * as settings from './settings.js';

export const App = {
  data: null,
  week: null,
  status: { rows: [], stats: { total: 0, planning: 0, notPlanning: 0, actual: 0, notActual: 0, completion: 0 } },
  selected: new Set(),
  phones: {},
  settings: {
    appsScriptUrl: '',
    smsApiUrl: '',
    smsProvider: 'device',
    templates: {},
    pin: '',
  },
  role: 'admin',
  tab: 'dashboard',
  filters: { filter: 'all', query: '' },
  reportFilters: {},
  detailSel: { supNorm: '', from: '', to: '', mode: 'both', type: '', submitted: false },
  migrateWeekStart: '',
  lastError: null,
};

const TABS = {
  dashboard,
  supervisors,
  compare,
  details,
  sms,
  migrate,
  reports,
  diagnostics,
  settings,
};

function loadPersisted() {
  App.phones = storeGet(CFG.storage.phones, {});
  const s = storeGet(CFG.storage.settings, null);
  if (s) App.settings = { ...App.settings, ...s, templates: { ...App.settings.templates, ...(s.templates || {}) } };
  const role = storeGet(CFG.storage.role, 'admin');
  App.role = App.settings.pin ? (role === 'viewer' ? 'viewer' : 'admin') : 'admin';
}

export function saveSettings(patch) {
  App.settings = { ...App.settings, ...patch };
  storeSet(CFG.storage.settings, App.settings);
}

export function savePhones(map) {
  App.phones = map;
  storeSet(CFG.storage.phones, map);
}

export function isAdmin() {
  return App.role === 'admin';
}

export function requireAdmin(actionLabel) {
  if (isAdmin()) return true;
  toast('هذه العملية تتطلب صلاحية مدير: ' + actionLabel, 'warn');
  return false;
}

export function templateFor(type) {
  const key = type === CFG.typePlanning ? 'planning' : type === CFG.typeActual ? 'actual' : 'both';
  return templateForKey(key);
}

export function templateForKey(key) {
  return App.settings.templates[key] || CFG.messages[key] || CFG.messages.both;
}

export function saveTemplate(key, text) {
  App.settings.templates = { ...App.settings.templates, [key]: text };
  storeSet(CFG.storage.settings, App.settings);
  logAdd('تغيير الرسالة', 'تعديل قالب الرسالة: ' + key);
}

export function compute() {
  if (!App.data) return;
  App.status = computeStatus(App.data.master, App.data.records, App.week, App.phones);
}

export function renderHeaderMeta() {
  const d = App.data;
  const lu = $('#last-update');
  if (lu) lu.textContent = d && d.ts ? 'آخر تحديث: ' + formatDateTime(new Date(d.ts)) : '';
  const roleBtn = $('#btn-role');
  if (roleBtn) {
    roleBtn.textContent = isAdmin() ? '👤 مدير' : '🔒 عارض';
    roleBtn.classList.toggle('btn-ghost', isAdmin());
    roleBtn.classList.toggle('btn-warn', !isAdmin());
  }
  const banner = $('#offline-banner');
  if (banner) {
    if (d && (d.offline || (d.sources && Object.values(d.sources).some((s) => !s.ok)))) {
      const failed = d.sources ? Object.entries(d.sources).filter(([, s]) => !s.ok).map(([k]) => k) : [];
      banner.classList.remove('hidden');
      banner.innerHTML = '⚠ تعذّر جلب مصادر محددة — يُعرض آخر نسخة محفوظة'
        + (failed.length ? ' (' + failed.join('، ') + ')' : '') + ' · فُتحت في ' + formatDateTime(new Date());
    } else {
      banner.classList.add('hidden');
    }
  }
}

function renderWeekControls() {
  const sel = $('#week-select');
  const weeks = (App.data && App.data.weeks) || [];
  const cur = App.week;
  sel.innerHTML = weeks.map((w) =>
    '<option value="' + w.start + '"' + (cur && w.start === cur.start ? ' selected' : '') + '>أسبوع ' +
    ltr(w.label + ' (' + w.start + ' → ' + w.end + ')') + '</option>').join('');
  const exists = cur && weeks.some((w) => w.start === cur.start);
  if (cur && !exists) {
    sel.insertAdjacentHTML('afterbegin',
      '<option value="' + cur.start + '" selected>أسبوع ' + ltr(cur.label) + ' (مخصص)</option>');
  }
  $('#week-start').value = cur ? cur.start : '';
  $('#week-end').value = cur ? cur.end : '';
  const chip = $('#week-chip');
  if (chip && cur) {
    const st = App.status.stats;
    chip.innerHTML = 'الأسبوع ' + ltr(cur.label) + ' · إرسال ' + ltr(st.planning + '/' + st.total) + ' تخطيط · ' +
      ltr(st.actual + '/' + st.total) + ' فعلي';
  }
}

export function setWeek(week, logIt) {
  if (!week) return;
  App.week = week;
  compute();
  renderWeekControls();
  render();
  if (logIt) logAdd('اختيار الأسبوع', week.label);
}

function weekFromStartInput(val) {
  if (!val) return null;
  const d = parseIso(val);
  const s = sundayOf(d);
  const e = addDays(s, 6);
  const label = weekLabelFromDates(isoDate(s), isoDate(e));
  const known = ((App.data && App.data.weeks) || []).find((w) => w.start === isoDate(s));
  return known || { start: isoDate(s), end: isoDate(e), label };
}

export function render() {
  renderHeaderMeta();
  const panel = $('#tab-' + App.tab);
  if (panel && TABS[App.tab]) TABS[App.tab].render(panel, App);
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === App.tab));
}

export function go(tab) {
  if (!TABS[tab]) return;
  App.tab = tab;
  $$('.panel').forEach((p) => p.classList.add('hidden'));
  const panel = $('#tab-' + tab);
  if (panel) panel.classList.remove('hidden');
  render();
}

export async function refresh(force, manual) {
  setLoading(true, manual ? 'جارٍ تحديث البيانات…' : 'جارٍ تحميل البيانات…');
  try {
    App.data = await getData({ force: force !== false });
    if (!App.week || !(App.data.weeks || []).some((w) => w.start === App.week.start)) {
      const weeks = App.data.weeks || [];
      const nowIso = isoDate(new Date());
      App.week = weeks.find((w) => nowIso >= w.start && nowIso <= w.end) || weeks[0] || null;
    }
    compute();
    App.lastError = null;
    if (manual) logAdd('تحديث البيانات', 'تحديث يدوي · مسجلات=' + (App.data.records || []).length + ' أسابيع=' + (App.data.weeks || []).length);
  } catch (e) {
    App.lastError = e.code || String(e && e.message) || e;
    if (!App.data) App.data = getDataFromCache();
  } finally {
    setLoading(false);
  }
  renderWeekControls();
  render();
  if (App.lastError === 'NO_DATA') {
    showModal({
      title: 'تعذّر تحميل البيانات',
      body: '<p>لا توجد بيانات محفوظة ولا يمكن الوصول إلى Google Sheets. تحقق من الاتصال بالإنترنت ثم أعد المحاولة.</p>',
      actions: [{ label: 'إعادة المحاولة', cls: 'btn-primary', onClick: () => refresh(true, false) }],
    });
  } else if (manual) {
    toast(App.data && App.data.offline ? 'الاتصال منقطع — عُرضت البيانات المحفوظة' : 'تم تحديث البيانات بنجاح', App.data && App.data.offline ? 'warn' : 'ok');
  }
}

function unlockFlow() {
  showModal({
    title: 'فتح صلاحيات المدير',
    body: '<label class="field-label">أدخل رمز المدير</label><input type="password" id="pin-input" class="input" inputmode="numeric">',
    actions: [
      { label: 'إلغاء', cls: 'btn-ghost' },
      {
        label: 'فتح',
        cls: 'btn-primary',
        keepOpen: true,
        onClick: () => {
          const v = $('#pin-input').value.trim();
          if (v === App.settings.pin) {
            App.role = 'admin';
            storeSet(CFG.storage.role, 'admin');
            $('#modal-root').innerHTML = '';
            toast('تم فتح صلاحيات المدير', 'ok');
            render();
            return true;
          }
          $('#pin-input').value = '';
          toast('رمز غير صحيح', 'error');
          return false;
        },
      },
    ],
  });
}

function bindGlobal() {
  $$('.tab').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));

  $('#btn-refresh').addEventListener('click', () => refresh(true, true));

  $('#btn-role').addEventListener('click', () => {
    if (!App.settings.pin) {
      showModal({
        title: 'صلاحية المدير',
        body: '<p>التطبيق حالياً يعمل بصلاحية مدير كاملة. لتفعيل فصل الصلاحيات (وضع عارض + رمز دخول)، اضبط رمز المدير من الإعدادات.</p>',
        actions: [{ label: 'حسنًا', cls: 'btn-primary' }],
      });
      return;
    }
    if (isAdmin()) {
      confirmModal('هل تريد الانتقال إلى وضع العارض (تُخفى العمليات الإدارية)؟', () => {
        App.role = 'viewer';
        storeSet(CFG.storage.role, 'viewer');
        render();
        return true;
      }, { yesLabel: 'وضع العارض' });
    } else {
      unlockFlow();
    }
  });

  $('#week-select').addEventListener('change', (e) => {
    const w = ((App.data && App.data.weeks) || []).find((x) => x.start === e.target.value);
    if (w) setWeek(w, true);
  });
  $('#week-start').addEventListener('change', (e) => {
    const w = weekFromStartInput(e.target.value);
    if (w) setWeek(w, true);
  });
  $('#btn-week-prev').addEventListener('click', () => shiftWeek(-7));
  $('#btn-week-next').addEventListener('click', () => shiftWeek(7));
}

function shiftWeek(delta) {
  if (!App.week) return;
  const s = addDays(parseIso(App.week.start), delta);
  const e = addDays(s, 6);
  const label = weekLabelFromDates(isoDate(s), isoDate(e));
  const known = ((App.data && App.data.weeks) || []).find((w) => w.start === isoDate(s));
  setWeek(known || { start: isoDate(s), end: isoDate(e), label }, true);
}

export async function init() {
  loadPersisted();
  bindGlobal();
  await refresh(false, false);
  go('dashboard');
}

document.addEventListener('DOMContentLoaded', init);
