/**
 * PaySense — Job Roles & Market Pay Guide (roles.html)
 * Uses Global Country Header + Clean Role Card Grid + Animated Pop-Up Role Dossier Modal
 * so users never have to scroll past 24 cards to read a role's details!
 */

import { COUNTRIES } from './tax/countries.js';
import { calculatePay, getCountryDefaultOptions } from './tax/calculator.js';
import { formatCurrency } from './tax/brackets.js';
import { encodeStateToHash } from './state.js';
import {
  initGlobalHeader,
  getGlobalCountry,
  setGlobalCountry,
  openPopupModal,
} from './ui/globalHeader.js';

let dataset = null;
let roleMap = new Map();

const uiState = {
  country: getGlobalCountry(),
  category: 'All',
  search: '',
  sort: 'fteMedian',
  selectedRoleId: 'software-engineer',
  compareRoleId: null,
  modalTab: 'pay', // 'pay' | 'growth' | 'pathways'
};

const els = {
  categoryChips: document.getElementById('role-category-chips'),
  searchInput: document.getElementById('role-search-input'),
  sortSelect: document.getElementById('role-sort-select'),
  countLabel: document.getElementById('roles-count-label'),
  listRoot: document.getElementById('roles-list-root'),
  compareBar: document.getElementById('role-compare-bar'),
  toast: document.getElementById('toast'),
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumberCompact(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return Math.round(n).toLocaleString();
}

function showToast(msg) {
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.classList.add('visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove('visible'), 2600);
}

function buildCalcInput(countryCode, mode, amount, compareVal = 0) {
  const c = COUNTRIES[countryCode] || COUNTRIES.AU;
  const countryOptions = { [countryCode]: getCountryDefaultOptions(countryCode) };
  return {
    country: countryCode,
    mode,
    amount,
    ratePeriod: mode === 'contractor' ? 'daily' : 'annual',
    bonus: 0,
    billableDays: c.defaultBillableDays,
    hoursPerDay: c.standardHoursPerDay,
    hoursPerWeek: c.standardHoursPerWeek,
    businessExpenses: 0,
    compareSalary: mode === 'contractor' ? compareVal : 0,
    compareDayRate: mode === 'employee' ? compareVal : 0,
    displayPeriod: 'monthly',
    countryOptions,
  };
}

function buildCalculatorDeepLink(countryCode, mode, amount, compareVal = 0) {
  const input = buildCalcInput(countryCode, mode, amount, compareVal);
  return `./index.html${encodeStateToHash(input)}`;
}

async function init() {
  initGlobalHeader({
    activePage: 'roles',
    onCountryChange: (newCode) => {
      uiState.country = newCode;
      setGlobalCountry(newCode);
      renderAll();
      // If a role dossier modal is currently open, refresh it in the new country!
      const openModal = document.getElementById('shared-popup-modal');
      if (openModal && !openModal.hidden && roleMap.has(uiState.selectedRoleId)) {
        openRoleDossierModal(uiState.selectedRoleId);
      }
    },
    extraActionHtml: `<button type="button" class="ai-mode-pill" id="data-sources-btn" title="View public data sources"><span class="status-dot local"></span> Public Data</button>`,
  });

  bindEvents();

  try {
    const res = await fetch('./data/roles.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    dataset = await res.json();
    roleMap = new Map(dataset.roles.map((r) => [r.id, r]));

    renderCategoryChips();
    renderAll();
  } catch (err) {
    els.listRoot.innerHTML = `
      <div class="card">
        <h2 class="card-title">Unable to load job market guide</h2>
        <p class="muted">Could not fetch <code>./data/roles.json</code> (${escapeHtml(err.message)}).</p>
      </div>
    `;
  }
}

function renderCategoryChips() {
  const categories = ['All', ...new Set(dataset.roles.map((r) => r.category))];
  els.categoryChips.innerHTML = categories
    .map(
      (cat) => `
    <button type="button" class="prompt-chip ${cat === uiState.category ? 'chip-active' : ''}" data-category="${escapeHtml(cat)}">
      ${cat === 'All' ? 'All Fields' : escapeHtml(cat)}
    </button>
  `
    )
    .join('');
}

function getFilteredRoles() {
  const q = uiState.search.trim().toLowerCase();
  const cCode = uiState.country;

  const filtered = dataset.roles.filter((r) => {
    if (uiState.category !== 'All' && r.category !== uiState.category) return false;
    if (!q) return true;
    const haystack = [
      r.title,
      r.category,
      r.summary,
      r.codes?.anzsco,
      r.codes?.soc,
      r.codes?.onet,
      ...(r.skills || []),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  filtered.sort((a, b) => {
    const ma = a.markets[cCode];
    const mb = b.markets[cCode];
    switch (uiState.sort) {
      case 'dayMedian':
        return mb.contractorDayRate.median - ma.contractorDayRate.median;
      case 'headcountGrowth5yr':
        return mb.headcountGrowth5yr - ma.headcountGrowth5yr;
      case 'wageGrowth5yr':
        return mb.wageGrowth5yr - ma.wageGrowth5yr;
      case 'fillRateAsc':
        return ma.competition.fillRatePct - mb.competition.fillRatePct;
      case 'workforce':
        return mb.workforceCount - ma.workforceCount;
      case 'fteMedian':
      default:
        return mb.fteSalary.median - ma.fteSalary.median;
    }
  });

  return filtered;
}

function competitionTone(level) {
  if (level === 'Low') return 'comp-low';
  if (level === 'High') return 'comp-high';
  return 'comp-mod';
}

function renderAll() {
  const roles = getFilteredRoles();
  const country = COUNTRIES[uiState.country];
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);

  els.countLabel.textContent = `${country.flag} ${country.name} · ${roles.length} roles`;

  if (!roles.length) {
    els.listRoot.innerHTML = `<div class="empty-state">No roles match “${escapeHtml(uiState.search)}”. Try clearing your search.</div>`;
    renderCompareBar();
    return;
  }

  els.listRoot.innerHTML = roles
    .map((r) => {
      const m = r.markets[uiState.country];
      const isCompared = r.id === uiState.compareRoleId;
      return `
        <div class="role-grid-card animate-stage" data-role-id="${r.id}" tabindex="0" role="button" aria-label="View ${escapeHtml(r.title)} details">
          <div class="rli-top">
            <div>
              <span class="role-cat-eyebrow">${escapeHtml(r.category)}</span>
              <div class="rli-title">${escapeHtml(r.title)}</div>
            </div>
            ${
              isCompared
                ? '<span class="cmp-tag">Comparing</span>'
                : `<span class="comp-pill ${competitionTone(m.competition.level)}">${escapeHtml(m.competition.shortageStatus)}</span>`
            }
          </div>

          <div class="role-card-pay-grid">
            <div class="rcp-box">
              <span class="rcp-label">Full-Time Median</span>
              <strong class="rcp-val">${fmt(m.fteSalary.median)}<span class="unit">/yr</span></strong>
            </div>
            <div class="rcp-box">
              <span class="rcp-label">Contractor Median</span>
              <strong class="rcp-val">${fmt(m.contractorDayRate.median)}<span class="unit">/day</span></strong>
            </div>
          </div>

          <div class="rli-footer">
            <span class="muted">👥 ${formatNumberCompact(m.workforceCount)} employed</span>
            <span class="growth-mini">+${m.headcountGrowth5yr}% jobs · +${m.wageGrowth5yr}% pay</span>
          </div>

          <div class="role-card-cta-row">
            <span class="role-open-hint">Open Role Guide &amp; Pathways →</span>
          </div>
        </div>
      `;
    })
    .join('');

  renderCompareBar();
}

function openRoleDossierModal(roleId) {
  const role = roleMap.get(roleId);
  if (!role) return;
  uiState.selectedRoleId = roleId;

  const cCode = uiState.country;
  const country = COUNTRIES[cCode];
  const m = role.markets[cCode];
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);

  const fteCalc = calculatePay(buildCalcInput(cCode, 'employee', m.fteSalary.median, m.contractorDayRate.median));
  const conCalc = calculatePay(buildCalcInput(cCode, 'contractor', m.contractorDayRate.median, m.fteSalary.median));
  const contractorAnnualMedian = m.contractorDayRate.median * country.defaultBillableDays;
  const contractorAnnualP25 = m.contractorDayRate.p25 * country.defaultBillableDays;
  const contractorAnnualP75 = m.contractorDayRate.p75 * country.defaultBillableDays;
  const maxPayScale = Math.max(m.fteSalary.p75, contractorAnnualP75, 1);

  const fteLink = buildCalculatorDeepLink(cCode, 'employee', m.fteSalary.median, m.contractorDayRate.median);
  const conLink = buildCalculatorDeepLink(cCode, 'contractor', m.contractorDayRate.median, m.fteSalary.median);
  const tab = uiState.modalTab || 'pay';
  const isCompareTarget = uiState.compareRoleId === role.id;

  const modal = openPopupModal({
    title: `${country.flag} ${role.title} (${country.name})`,
    subtitle: `${role.category} · ANZSCO ${role.codes.anzsco} / SOC ${role.codes.soc} · ${m.workforceCount.toLocaleString()} employed nationally`,
    wide: true,
    bodyHtml: `
      <div id="role-dossier-modal-content">
        <div class="stage-nav-bar" style="margin-bottom:16px;">
          <div class="stage-tabs">
            <button type="button" class="stage-tab ${tab === 'pay' ? 'active' : ''}" data-dossier-tab="pay">
              01 · Pay &amp; Take-Home
            </button>
            <button type="button" class="stage-tab ${tab === 'growth' ? 'active' : ''}" data-dossier-tab="growth">
              02 · Growth &amp; Competition
            </button>
            <button type="button" class="stage-tab ${tab === 'pathways' ? 'active' : ''}" data-dossier-tab="pathways">
              03 · Career Growth Pathways
            </button>
          </div>
          <button type="button" class="btn-ghost btn-xs" id="modal-compare-role-btn" data-role-id="${role.id}">
            ${isCompareTarget ? '✓ Pinned for Comparison' : '⚖️ Pin to Compare'}
          </button>
        </div>

        ${
          tab === 'pay'
            ? `
          <div class="animate-stage">
            <p class="plain-english-summary" style="margin-top:0;">
              Around <strong>${m.workforceCount.toLocaleString()} people</strong> work as a <strong>${escapeHtml(role.title)}</strong> in <strong>${escapeHtml(country.name)}</strong> (~${m.annualOpenings.toLocaleString()} openings/yr).
              A typical full-time salary is <strong>${fmt(m.fteSalary.median)}/yr</strong> (taking home <strong>${fmt(fteCalc.periods.net.monthly)}/mo</strong> after tax), while contractors average <strong>${fmt(m.contractorDayRate.median)}/day</strong>.
            </p>

            <div class="pay-comparison-boxes" style="margin-top:16px;">
              <div class="pay-mode-box">
                <div class="pay-mode-tag">Full-Time Employee</div>
                <div class="pay-mode-main">${fmt(m.fteSalary.median)} <span class="unit">/ year</span></div>
                <div class="pay-mode-takehome">Take-home: <strong>${fmt(fteCalc.periods.net.monthly)} / month</strong> (${fmt(fteCalc.netIncome)}/yr net)</div>
                <div class="pay-mode-range">Range (25th–75th): <strong>${fmt(m.fteSalary.p25)}</strong> – <strong>${fmt(m.fteSalary.p75)}</strong></div>
                <a href="${fteLink}" class="btn-primary btn-sm pay-mode-cta">Open Full-Time Pay in Calculator →</a>
              </div>

              <div class="pay-mode-box contractor-box">
                <div class="pay-mode-tag">Contractor / Freelancer</div>
                <div class="pay-mode-main">${fmt(m.contractorDayRate.median)} <span class="unit">/ day</span></div>
                <div class="pay-mode-takehome">Take-home: <strong>${fmt(conCalc.periods.net.monthly)} / month</strong> (${country.defaultBillableDays} days/yr)</div>
                <div class="pay-mode-range">Range (25th–75th): <strong>${fmt(m.contractorDayRate.p25)}/day</strong> – <strong>${fmt(m.contractorDayRate.p75)}/day</strong></div>
                <a href="${conLink}" class="btn-secondary btn-sm pay-mode-cta">Open Contractor Rate in Calculator →</a>
              </div>
            </div>

            <div class="pay-bands-wrap" style="margin-top:18px;">
              ${renderPayRangeBar('Full-Time Salary Range (25th to 75th percentile)', m.fteSalary.p25, m.fteSalary.median, m.fteSalary.p75, maxPayScale, fmt, 'band-fte')}
              ${renderPayRangeBar(`Annualized Contractor Billing (${country.defaultBillableDays} days/yr)`, contractorAnnualP25, contractorAnnualMedian, contractorAnnualP75, maxPayScale, fmt, 'band-con')}
            </div>

            <div class="skills-row">
              <span class="chips-label">Top skills:</span>
              ${(role.skills || []).map((s) => `<span class="skill-chip">${escapeHtml(s)}</span>`).join('')}
            </div>
          </div>
        `
            : ''
        }

        ${
          tab === 'growth'
            ? `
          <div class="two-col-cards animate-stage">
            <div class="card" style="padding:20px;">
              <h3 class="mini-section-title">5-Year Growth (Pay vs Headcount)</h3>
              <div class="growth-bar-block">
                <div class="bracket-meta">
                  <span class="bracket-label">Financial / Pay Growth (5-Yr)</span>
                  <strong class="net-col">+${m.wageGrowth5yr}% <span class="muted">(+${m.wageGrowthYoY}%/yr)</span></strong>
                </div>
                <div class="bracket-track tall">
                  <div class="bracket-fill" style="width:${Math.min(100, Math.round(m.wageGrowth5yr * 1.45))}%"></div>
                </div>
                <div class="field-hint">5-yr projected median FTE pay: <strong>${fmt(m.fteSalary.median * (1 + m.wageGrowth5yr / 100))}/yr</strong></div>
              </div>

              <div class="growth-bar-block" style="margin-top:16px;">
                <div class="bracket-meta">
                  <span class="bracket-label">Workforce / People Growth (5-Yr)</span>
                  <strong class="retire-color">+${m.headcountGrowth5yr}% <span class="muted">(+${formatNumberCompact(m.workforceCount * (m.headcountGrowth5yr / 100))} jobs)</span></strong>
                </div>
                <div class="bracket-track tall">
                  <div class="bracket-fill jobs-bar" style="width:${Math.min(100, Math.round(m.headcountGrowth5yr * 2.4))}%"></div>
                </div>
                <div class="field-hint">5-yr projected workforce: <strong>${formatNumberCompact(m.workforceCount * (1 + m.headcountGrowth5yr / 100))} people</strong></div>
              </div>
            </div>

            <div class="card" style="padding:20px;">
              <div class="card-title-row">
                <h3 class="mini-section-title" style="margin:0;">Competition &amp; Hiring Demand</h3>
                <span class="comp-pill ${competitionTone(m.competition.level)}">${escapeHtml(m.competition.shortageStatus)}</span>
              </div>
              <div class="comp-stats-grid">
                <div class="comp-stat">
                  <div class="kpi-label">Annual Openings</div>
                  <div class="comp-stat-val">~${m.annualOpenings.toLocaleString()}/yr</div>
                </div>
                <div class="comp-stat">
                  <div class="kpi-label">Avg Applicants / Role</div>
                  <div class="comp-stat-val">~${m.competition.applicantsPerRole}</div>
                </div>
              </div>
              <div class="fill-rate-box">
                <div class="bracket-meta">
                  <span class="bracket-label">Vacancies Employers Fill Easily</span>
                  <strong>${m.competition.fillRatePct}% filled</strong>
                </div>
                <div class="bracket-track tall">
                  <div class="bracket-fill fill-${m.competition.level.toLowerCase()}" style="width:${m.competition.fillRatePct}%"></div>
                </div>
              </div>
              <div class="driver-note">
                <strong>Market Driver:</strong> ${escapeHtml(m.competition.driver)}
              </div>
            </div>
          </div>
        `
            : ''
        }

        ${
          tab === 'pathways'
            ? `
          <div class="animate-stage">
            <div class="pathways-grid">
              ${(role.pathways || [])
                .map((pw) => {
                  const targetRole = roleMap.get(pw.targetId);
                  const targetTitle = targetRole ? targetRole.title : pw.targetId;
                  const targetSalary = Math.round(m.fteSalary.median * (1 + pw.upliftPct / 100));
                  const targetCalc = calculatePay(buildCalcInput(cCode, 'employee', targetSalary));
                  const netDeltaYr = targetCalc.netIncome - fteCalc.netIncome;
                  const targetCalcUrl = buildCalculatorDeepLink(cCode, 'employee', targetSalary);
                  const positive = netDeltaYr >= 0;

                  return `
                    <div class="pathway-card">
                      <div class="pathway-top">
                        <span class="pathway-type">${escapeHtml(pw.type)}</span>
                        <span class="pathway-time">${escapeHtml(pw.years)}</span>
                      </div>
                      <div class="pathway-title">${escapeHtml(targetTitle)}</div>
                      <div class="pathway-pay-row">
                        <span class="pathway-gross">${fmt(targetSalary)}/yr</span>
                        <span class="pathway-uplift ${pw.upliftPct >= 0 ? 'pos' : 'neg'}">${pw.upliftPct >= 0 ? '+' : ''}${pw.upliftPct}% gross</span>
                      </div>
                      <div class="pathway-net-impact ${positive ? 'pos' : 'neg'}">
                        ${positive ? 'Extra take-home: +' : 'Change: −'}${fmt(Math.abs(netDeltaYr / 12))}/mo (${positive ? '+' : '−'}${fmt(Math.abs(netDeltaYr))}/yr net)
                      </div>
                      <div class="pathway-skills">
                        ${(pw.bridgeSkills || []).map((sk) => `<span class="mini-skill">${escapeHtml(sk)}</span>`).join('')}
                      </div>
                      <div class="pathway-actions">
                        ${targetRole ? `<button type="button" class="btn-ghost btn-xs explore-pathway-btn" data-role-id="${targetRole.id}">Switch to Role</button>` : ''}
                        <a href="${targetCalcUrl}" class="btn-primary btn-xs">Try in Calculator →</a>
                      </div>
                    </div>
                  `;
                })
                .join('')}
            </div>
            <div class="form-footnote mt-sm">Benchmark source: ${escapeHtml(m.source)}.</div>
          </div>
        `
            : ''
        }
      </div>
    `,
  });

  const content = modal.querySelector('#role-dossier-modal-content');
  content?.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('[data-dossier-tab]');
    if (tabBtn) {
      uiState.modalTab = tabBtn.dataset.dossierTab;
      openRoleDossierModal(role.id);
      return;
    }
    const cmpBtn = e.target.closest('#modal-compare-role-btn');
    if (cmpBtn) {
      if (uiState.compareRoleId === role.id) {
        uiState.compareRoleId = null;
        showToast('Comparison cleared');
      } else {
        uiState.compareRoleId = role.id;
        showToast('Pinned! Click another role card to compare side-by-side.');
      }
      renderAll();
      openRoleDossierModal(role.id);
      return;
    }
    const exploreBtn = e.target.closest('.explore-pathway-btn');
    if (exploreBtn) {
      uiState.modalTab = 'pay';
      openRoleDossierModal(exploreBtn.dataset.roleId);
    }
  });
}

function renderPayRangeBar(label, p25, median, p75, maxScale, fmt, cls) {
  const leftPct = Math.round((p25 / maxScale) * 100);
  const widthPct = Math.max(8, Math.round(((p75 - p25) / maxScale) * 100));
  const medPct = Math.round((median / maxScale) * 100);
  return `
    <div class="pay-range-row">
      <div class="bracket-meta">
        <span class="bracket-label">${escapeHtml(label)}</span>
        <span class="bracket-nums">
          <span class="muted">25%: ${fmt(p25)}</span>
          <strong>Median: ${fmt(median)}</strong>
          <span class="muted">75%: ${fmt(p75)}</span>
        </span>
      </div>
      <div class="range-track">
        <div class="range-span ${cls}" style="left:${leftPct}%; width:${widthPct}%;"></div>
        <div class="range-median-dot ${cls}" style="left:${medPct}%;" title="Median: ${fmt(median)}"></div>
      </div>
    </div>
  `;
}

function renderCompareBar() {
  if (!uiState.compareRoleId || uiState.compareRoleId === uiState.selectedRoleId) {
    els.compareBar.hidden = true;
    els.compareBar.innerHTML = '';
    return;
  }

  const roleA = roleMap.get(uiState.compareRoleId);
  const roleB = roleMap.get(uiState.selectedRoleId);
  if (!roleA || !roleB) {
    els.compareBar.hidden = true;
    return;
  }

  const cCode = uiState.country;
  const country = COUNTRIES[cCode];
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);
  const mA = roleA.markets[cCode];
  const mB = roleB.markets[cCode];
  const netA = calculatePay(buildCalcInput(cCode, 'employee', mA.fteSalary.median)).netIncome;
  const netB = calculatePay(buildCalcInput(cCode, 'employee', mB.fteSalary.median)).netIncome;

  els.compareBar.hidden = false;
  els.compareBar.innerHTML = `
    <div class="card compare-roles-card animate-stage" style="margin-bottom:18px;">
      <div class="card-title-row">
        <h3 class="card-title">⚖️ Side-by-Side Role Comparison (${country.flag} ${escapeHtml(country.name)})</h3>
        <button type="button" class="btn-ghost btn-xs" id="clear-role-compare-btn">Close Comparison</button>
      </div>
      <div class="table-scroll">
        <table class="freq-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>${escapeHtml(roleA.title)}</th>
              <th>${escapeHtml(roleB.title)}</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>People Employed</td><td>${mA.workforceCount.toLocaleString()}</td><td>${mB.workforceCount.toLocaleString()}</td></tr>
            <tr><td>Full-Time Salary (Gross / Net)</td><td>${fmt(mA.fteSalary.median)} · <span class="net-col">${fmt(netA)} net</span></td><td>${fmt(mB.fteSalary.median)} · <span class="net-col">${fmt(netB)} net</span></td></tr>
            <tr><td>Contractor Median Day Rate</td><td>${fmt(mA.contractorDayRate.median)}/day</td><td>${fmt(mB.contractorDayRate.median)}/day</td></tr>
            <tr><td>5-Yr Pay / Job Growth</td><td>+${mA.wageGrowth5yr}% pay · +${mA.headcountGrowth5yr}% jobs</td><td>+${mB.wageGrowth5yr}% pay · +${mB.headcountGrowth5yr}% jobs</td></tr>
            <tr><td>Hiring Demand</td><td>${escapeHtml(mA.competition.shortageStatus)} (${mA.competition.fillRatePct}% filled)</td><td>${escapeHtml(mB.competition.shortageStatus)} (${mB.competition.fillRatePct}% filled)</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function openDataSourcesPopup() {
  if (!dataset) return;
  openPopupModal({
    title: 'Public Data Sources & Optional Free Live Refresh',
    subtitle: 'No API keys required. Optionally add a free Adzuna key in GitHub Secrets for weekly automated updates.',
    wide: false,
    bodyHtml: `
      <div class="ds-list">
        ${(dataset.sources || [])
          .map(
            (s) => `
          <div class="ds-item">
            <div class="ds-item-top">
              <strong>${escapeHtml(s.name)}</strong>
              <span class="tax-year-pill">${escapeHtml(s.coverage)}</span>
            </div>
            <div class="muted" style="font-size:0.84rem;">${escapeHtml(s.metrics)}</div>
            <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" class="ds-link">${escapeHtml(s.url)} ↗</a>
          </div>
        `
          )
          .join('')}
      </div>
    `,
  });
}

function bindEvents() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('#data-sources-btn')) {
      openDataSourcesPopup();
    }
  });

  els.categoryChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-category]');
    if (!btn) return;
    uiState.category = btn.dataset.category;
    renderCategoryChips();
    renderAll();
  });

  els.searchInput.addEventListener('input', (e) => {
    uiState.search = e.target.value;
    renderAll();
  });

  els.sortSelect.addEventListener('change', (e) => {
    uiState.sort = e.target.value;
    renderAll();
  });

  els.listRoot.addEventListener('click', (e) => {
    const card = e.target.closest('[data-role-id]');
    if (!card) return;
    uiState.modalTab = 'pay';
    openRoleDossierModal(card.dataset.roleId);
  });

  els.listRoot.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target.closest('[data-role-id]');
      if (!card) return;
      e.preventDefault();
      uiState.modalTab = 'pay';
      openRoleDossierModal(card.dataset.roleId);
    }
  });

  els.compareBar.addEventListener('click', (e) => {
    if (e.target.closest('#clear-role-compare-btn')) {
      uiState.compareRoleId = null;
      renderAll();
    }
  });
}

init();
