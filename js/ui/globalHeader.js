/**
 * Shared Top Header, Global Country State & Pop-Up Modal Helpers across all 5 PaySense pages.
 * Eliminates repeated country selectors inside forms and keeps navigation crisp on one row.
 */

import { COUNTRIES, COUNTRY_LIST } from '../tax/countries.js';
import { loadTheme, saveTheme } from '../state.js';

const GLOBAL_COUNTRY_KEY = 'paysense_global_country_v1';

export function getGlobalCountry() {
  try {
    const saved = localStorage.getItem(GLOBAL_COUNTRY_KEY);
    if (saved && COUNTRIES[saved]) return saved;
  } catch {
    // ignore
  }
  return 'AU';
}

export function setGlobalCountry(code) {
  if (!COUNTRIES[code]) return;
  try {
    localStorage.setItem(GLOBAL_COUNTRY_KEY, code);
  } catch {
    // ignore
  }
  const sel = document.getElementById('global-country-select');
  if (sel && sel.value !== code) {
    sel.value = code;
  }
  const badge = document.getElementById('global-tax-year-badge');
  if (badge) {
    badge.textContent = `${COUNTRIES[code].flag} ${COUNTRIES[code].name} · ${COUNTRIES[code].taxYear}`;
  }
}

const NAV_ITEMS = [
  { id: 'pay', href: './index.html', label: 'Pay Calculator' },
  { id: 'property', href: './property.html', label: 'Rental Property' },
  { id: 'car', href: './decisions.html', label: 'Car & Lease' },
  { id: 'whatif', href: './whatif.html', label: 'Home & What-Ifs' },
  { id: 'roles', href: './roles.html', label: 'Job Market' },
];

export function initGlobalHeader({ activePage, onCountryChange, extraActionHtml = '' }) {
  const headerEl = document.querySelector('.top-bar');
  if (!headerEl) return;

  const currentCountry = getGlobalCountry();
  const theme = loadTheme();
  document.documentElement.setAttribute('data-theme', theme);

  headerEl.innerHTML = `
    <div class="container top-bar-inner">
      <a href="./index.html" class="brand brand-link">
        <div class="brand-mark" aria-hidden="true">$</div>
        <span class="brand-name">PaySense</span>
      </a>

      <nav class="main-nav" aria-label="Primary navigation">
        ${NAV_ITEMS.map(
          (item) => `
          <a href="${item.href}" class="nav-tab ${item.id === activePage ? 'active' : ''}" ${item.id === activePage ? 'aria-current="page"' : ''}>
            ${item.label}
          </a>
        `
        ).join('')}
      </nav>

      <div class="header-actions">
        <div class="global-country-wrap" title="Global country & tax system (applies across all pages)">
          <label class="sr-only" for="global-country-select">Country</label>
          <select id="global-country-select" class="global-country-select">
            ${COUNTRY_LIST.map(
              (c) => `
              <option value="${c.code}" ${c.code === currentCountry ? 'selected' : ''}>
                ${c.flag} ${c.name} (${c.currency})
              </option>
            `
            ).join('')}
          </select>
        </div>
        ${extraActionHtml}
        <button type="button" class="icon-circle-btn" id="theme-toggle-btn" aria-label="Toggle theme" title="Switch warm light / dark theme">
          ${theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>
    </div>
  `;

  const sel = document.getElementById('global-country-select');
  sel?.addEventListener('change', (e) => {
    const newCode = e.target.value;
    setGlobalCountry(newCode);
    if (typeof onCountryChange === 'function') {
      onCountryChange(newCode);
    }
  });

  const themeBtn = document.getElementById('theme-toggle-btn');
  themeBtn?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    saveTheme(next);
    themeBtn.textContent = next === 'dark' ? '☀️' : '🌙';
  });
}

/**
 * Shared Pop-Up Modal helper with Escape & backdrop close + smooth animation.
 */
export function openPopupModal({ title, subtitle = '', bodyHtml, wide = true }) {
  let modal = document.getElementById('shared-popup-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'shared-popup-modal';
    modal.className = 'modal-backdrop';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-close-popup]')) {
        closePopupModal();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) {
        closePopupModal();
      }
    });
  }

  modal.innerHTML = `
    <div class="modal-card ${wide ? 'modal-xl' : ''} animate-pop">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">${title}</h2>
          ${subtitle ? `<p class="modal-sub">${subtitle}</p>` : ''}
        </div>
        <button type="button" class="icon-btn" data-close-popup aria-label="Close">✕</button>
      </div>
      <div class="modal-scroll-body">
        ${bodyHtml}
      </div>
    </div>
  `;
  modal.hidden = false;
  return modal;
}

export function closePopupModal() {
  const modal = document.getElementById('shared-popup-modal');
  if (modal) modal.hidden = true;
}
