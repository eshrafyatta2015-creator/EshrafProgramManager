/* UI components — مودال، تنبيهات، جداول */

import { escapeHtml } from '../utils.js';

export const $ = (sel, root) => (root || document).querySelector(sel);
export const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

export function toast(msg, type) {
  const root = $('#toast-root');
  const div = document.createElement('div');
  div.className = 'toast toast-' + (type || 'info');
  div.innerHTML = escapeHtml(msg);
  root.appendChild(div);
  setTimeout(() => { div.classList.add('show'); }, 20);
  setTimeout(() => {
    div.classList.remove('show');
    setTimeout(() => div.remove(), 350);
  }, 4200);
}

export function showModal({ title, body, actions, wide }) {
  const root = $('#modal-root');
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML =
    '<div class="modal' + (wide ? ' modal-wide' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><h3>' + escapeHtml(title || '') + '</h3>' +
      '<button class="icon-btn modal-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="modal-body"></div>' +
      '<div class="modal-actions"></div>' +
    '</div>';
  const bodyEl = wrap.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  const actionsEl = wrap.querySelector('.modal-actions');
  const close = () => { root.innerHTML = ''; };
  (actions || []).forEach((a) => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.cls || 'btn-primary');
    b.textContent = a.label;
    b.addEventListener('click', async () => {
      if (a.onClick) {
        const res = await a.onClick();
        if (res === false) return;
      }
      if (a.keepOpen !== true) close();
    });
    actionsEl.appendChild(b);
  });

  wrap.querySelector('.modal-close').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  root.appendChild(wrap);
  return { close, body: bodyEl };
}

export function confirmModal(message, onYes, opts) {
  const o = opts || {};
  return showModal({
    title: o.title || 'تأكيد',
    body: '<p class="confirm-text">' + escapeHtml(message) + '</p>' + (o.extra || ''),
    actions: [
      { label: 'إلغاء', cls: 'btn-ghost' },
      { label: o.yesLabel || 'نعم، متابعة', cls: 'btn-danger', onClick: onYes },
    ],
  });
}

export function tableHtml(head, rows, opts) {
  const o = opts || {};
  const cls = o.cls || '';
  let html = '<div class="table-wrap"><table class="table ' + cls + '"><thead><tr>';
  for (const h of head) html += '<th>' + escapeHtml(h) + '</th>';
  html += '</tr></thead><tbody>';
  if (!rows.length) {
    html += '<tr><td colspan="' + head.length + '" class="empty">لا توجد بيانات مطابقة</td></tr>';
  }
  for (const r of rows) {
    html += '<tr>';
    for (const c of r) {
      if (c && typeof c === 'object' && c.__html) html += '<td>' + c.__html + '</td>';
      else html += '<td>' + escapeHtml(c == null ? '' : c) + '</td>';
    }
    html += '</tr>';
  }
  return html + '</tbody></table></div>';
}

export function htmlCell(inner) {
  return { __html: inner };
}

export function statCard({ icon, label, value, cls, sub }) {
  return '<div class="stat-card ' + (cls || '') + '">' +
    '<div class="stat-icon">' + icon + '</div>' +
    '<div class="stat-body"><div class="stat-value">' + escapeHtml(String(value)) + '</div>' +
    '<div class="stat-label">' + escapeHtml(label) + '</div>' +
    (sub ? '<div class="stat-sub">' + escapeHtml(sub) + '</div>' : '') +
    '</div></div>';
}

export function statusPill(status) {
  return '<span class="pill ' + status.cls + '">' + status.icon + ' ' + escapeHtml(status.label) + '</span>';
}

export function emptyState(msg) {
  return '<div class="empty-state">' + escapeHtml(msg || 'لا توجد بيانات') + '</div>';
}

export function setLoading(on, msg) {
  const el = $('#loading');
  if (!el) return;
  el.classList.toggle('hidden', !on);
  if (msg) el.querySelector('.loading-msg').textContent = msg;
}
