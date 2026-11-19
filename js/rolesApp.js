/**
 * PaySense — Warm, Section-Divided Job Roles & Market Pay Guide (roles.html)
 * Designed with generous negative space, plain-English explanations, and
 * real localized after-tax take-home calculations.
 */

import { COUNTRIES, COUNTRY_LIST } from './tax/countries.js';
import { calculatePay, getCountryDefaultOptions } from './tax/calculator.js';
import { formatCurrency } from './tax/brackets.js';
import { encodeStateToHash, loadTheme, saveTheme } from './state.js';

let dataset = null;
let roleMap = new Map();

const uiState = {
  country: 'AU',
  category: 'All',
  search: '',
  sort: 'fteMedian',
  selectedRoleId: 'software-engineer',
  compareRoleId: null,
};

const els = {
  countryPills: document.getElementById('roles-country-pills'),
  categoryChips: document.getElementById('role-category-chips'),
  searchInput: document.getElementById('role-search-input'),
  sortSelect: document.getElementById('role-sort-select'),
  countLabel: document.getElementById('roles-count-label'),
  listRoot: document.getElementById('roles-list-root'),
  detailRoot: document.getElementById('role-detail-root'),
  compareBar: document.getElementById('role-compare-bar'),
  themeBtn: document.getElementById('theme-toggle-btn'),
  dataSourcesBtn: document.getElementById('data-sources-btn'),
  dsModal: document.getElementById('data-sources-modal'),
  closeDsBtn: document.getElementById('close-ds-btn'),
  dsModalBody: document.getElementById('ds-modal-body'),
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

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  saveTheme(theme);
  if (els.themeBtn) {
    els.themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
    els.themeBtn.title = theme === 'dark' ? 'Switch to warm paper light mode' : 'Switch to warm dark mode';
  }
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
  applyTheme(loadTheme());
  hydrateFromQueryParams();
  bindEvents();

  try {
    const res = await fetch('./data/roles.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    dataset = await res.json();
    roleMap = new Map(dataset.roles.map((r) => [r.id, r]));

    if (!roleMap.has(uiState.selectedRoleId) && dataset.roles.length) {
      uiState.selectedRoleId = dataset.roles[0].id;
    }

    updateDataSourcePill();
    renderCountryPills();
    renderCategoryChips();
    renderAll();
  } catch (err) {
    els.detailRoot.innerHTML = `
      <div class="card">
        <h2 class="card-title">Unable to load job market guide</h2>
        <p class="muted">Could not fetch <code>./data/roles.json</code> (${escapeHtml(err.message)}). Run <code>python3 -m http.server 8080</code> locally to preview.</p>
      </div>
    `;
  }
}

function hydrateFromQueryParams() {
  try {
    const params = new URLSearchParams(window.location.search);
    const c = params.get('country');
    if (c && COUNTRIES[c.toUpperCase()]) uiState.country = c.toUpperCase();
    const role = params.get('role');
    if (role) uiState.selectedRoleId = role;
  } catch {
    // ignore
  }
}

function updateDataSourcePill() {
  if (!els.dataSourcesBtn || !dataset) return;
  const isLive = dataset.liveSyncStatus === 'adzuna-live-synced';
  els.dataSourcesBtn.innerHTML = isLive
    ? `<span class="status-dot live"></span> Live Market Sync · ${escapeHtml(dataset.lastUpdated)}`
    : `<span class="status-dot local"></span> Public Data · Free`;
}

function renderCountryPills() {
  els.countryPills.innerHTML = COUNTRY_LIST.map(
    (c) => `
    <button type="button" class="country-pill ${c.code === uiState.country ? 'active' : ''}" data-country="${c.code}">
      <span class="pill-flag">${c.flag}</span>
      <span class="pill-name">${escapeHtml(c.name)}</span>
    </button>
  `
  ).join('');
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

function friendlyCompetitionLabel(level, shortageStatus) {
  if (level === 'Low') return `${shortageStatus} · Easier to get hired`;
  if (level === 'High') return `${shortageStatus} · High competition`;
  return `${shortageStatus} · Steady demand`;
}

function renderAll() {
  const roles = getFilteredRoles();
  const country = COUNTRIES[uiState.country];
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);

  if (roles.length && !roles.some((r) => r.id === uiState.selectedRoleId)) {
    uiState.selectedRoleId = roles[0].id;
  }

  els.countLabel.textContent = `Showing ${roles.length} of ${dataset.roles.length} roles in ${country.name}`;

  if (!roles.length) {
    els.listRoot.innerHTML = `<div class="empty-state">No roles match “${escapeHtml(uiState.search)}”. Try clearing your search or switching category.</div>`;
    els.detailRoot.innerHTML = '';
    renderCompareBar();
    return;
  }

  els.listRoot.innerHTML = roles
    .map((r) => {
      const m = r.markets[uiState.country];
      const active = r.id === uiState.selectedRoleId;
      const isCompared = r.id === uiState.compareRoleId;
      return `
        <button type="button" class="role-list-item ${active ? 'active' : ''}" data-role-id="${r.id}">
          <div class="rli-top">
            <span class="rli-title">${escapeHtml(r.title)}</span>
            ${isCompared ? '<span class="cmp-tag">Saved to Compare</span>' : `<span class="comp-pill ${competitionTone(m.competition.level)}">${escapeHtml(m.competition.shortageStatus)}</span>`}
          </div>
          <div class="rli-metrics">
            <span>Full-Time: <strong>${fmt(m.fteSalary.median)}/yr</strong></span>
            <span>Contract: <strong>${fmt(m.contractorDayRate.median)}/day</strong></span>
          </div>
          <div class="rli-footer">
            <span class="muted">${formatNumberCompact(m.workforceCount)} employed</span>
            <span class="growth-mini">+${m.headcountGrowth5yr}% jobs (5yr)</span>
          </div>
        </button>
      `;
    })
    .join('');

  renderRoleDetail(roleMap.get(uiState.selectedRoleId));
  renderCompareBar();
}

function renderRoleDetail(role) {
  if (!role) return;
  const cCode = uiState.country;
  const country = COUNTRIES[cCode];
  const m = role.markets[cCode];
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);

  const fteCalc = calculatePay(buildCalcInput(cCode, 'employee', m.fteSalary.median, m.contractorDayRate.median));
  const conCalc = calculatePay(buildCalcInput(cCode, 'contractor', m.contractorDayRate.median, m.fteSalary.median));
  const contractorAnnualMedian = m.contractorDayRate.median * country.defaultBillableDays;
  const contractorAnnualP25 = m.contractorDayRate.p25 * country.defaultBillableDays;
  const contractorAnnualP75 = m.contractorDayRate.p75 * country.defaultBillableDays;

  const fteLink = buildCalculatorDeepLink(cCode, 'employee', m.fteSalary.median, m.contractorDayRate.median);
  const conLink = buildCalculatorDeepLink(cCode, 'contractor', m.contractorDayRate.median, m.fteSalary.median);

  const isCompareTarget = uiState.compareRoleId === role.id;
  const maxPayScale = Math.max(m.fteSalary.p75, contractorAnnualP75, 1);

  els.detailRoot.innerHTML = `
    <!-- SECTION 02: THE ROLE AT A GLANCE & PAY -->
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">02</span>
        <div class="section-divider-text">
          <h2 class="section-heading">${escapeHtml(role.title)} — Pay &amp; Workforce Snapshot</h2>
          <p class="section-sub">How many people do this job in ${escapeHtml(country.name)}, and what full-time vs contracting pays.</p>
        </div>
        <button type="button" class="btn-ghost btn-sm" id="toggle-compare-role-btn" data-role-id="${role.id}">
          ${isCompareTarget ? '✓ Pinned for Comparison' : 'Compare With Another Role'}
        </button>
      </div>

      <div class="card role-hero-card">
        <div class="hero-eyebrow">
          <span>${country.flag} ${escapeHtml(country.name)}</span>
          <span class="dot-sep">·</span>
          <span>${escapeHtml(role.category)}</span>
          <span class="dot-sep">·</span>
          <span>Official Code: ANZSCO ${escapeHtml(role.codes.anzsco)} / SOC ${escapeHtml(role.codes.soc)}</span>
        </div>

        <p class="plain-english-summary" style="margin-top:12px;">
          Around <strong>${m.workforceCount.toLocaleString()} people</strong> work as a <strong>${escapeHtml(role.title)}</strong> in <strong>${escapeHtml(country.name)}</strong>, with roughly <strong>${m.annualOpenings.toLocaleString()} job openings</strong> each year. A typical full-time salary is <strong>${fmt(m.fteSalary.median)}/year</strong> (taking home <strong>${fmt(fteCalc.periods.net.monthly)}/month</strong> after tax), while contractors average <strong>${fmt(m.contractorDayRate.median)}/day</strong>.
        </p>

        <p class="role-hero-summary">${escapeHtml(role.summary)}</p>

        <div class="skills-row">
          <span class="chips-label">Core skills:</span>
          ${(role.skills || []).map((s) => `<span class="skill-chip">${escapeHtml(s)}</span>`).join('')}
        </div>

        <!-- Two Clear Side-by-Side Pay Cards: Full-Time vs Contractor -->
        <div class="pay-comparison-boxes">
          <div class="pay-mode-box">
            <div class="pay-mode-tag">Full-Time Employee</div>
            <div class="pay-mode-main">${fmt(m.fteSalary.median)} <span class="unit">per year</span></div>
            <div class="pay-mode-takehome">
              Real take-home: <strong>${fmt(fteCalc.periods.net.monthly)} / month</strong> (${fmt(fteCalc.netIncome)}/yr after tax)
            </div>
            <div class="pay-mode-range">
              Typical range: <strong>${fmt(m.fteSalary.p25)}</strong> (entry/mid) to <strong>${fmt(m.fteSalary.p75)}</strong> (senior)
            </div>
            <a href="${fteLink}" class="btn-primary btn-sm pay-mode-cta">
              Open Full-Time Pay in Calculator →
            </a>
          </div>

          <div class="pay-mode-box contractor-box">
            <div class="pay-mode-tag">Contractor / Freelancer</div>
            <div class="pay-mode-main">${fmt(m.contractorDayRate.median)} <span class="unit">per day</span></div>
            <div class="pay-mode-takehome">
              Real take-home: <strong>${fmt(conCalc.periods.net.monthly)} / month</strong> (assuming ${country.defaultBillableDays} billable days/yr)
            </div>
            <div class="pay-mode-range">
              Typical range: <strong>${fmt(m.contractorDayRate.p25)}/day</strong> to <strong>${fmt(m.contractorDayRate.p75)}/day</strong>
            </div>
            <a href="${conLink}" class="btn-secondary btn-sm pay-mode-cta">
              Open Contractor Rate in Calculator →
            </a>
          </div>
        </div>

        <div class="pay-bands-wrap" style="margin-top:22px;">
          ${renderPayRangeBar('Full-Time Salary Range (25th to 75th percentile)', m.fteSalary.p25, m.fteSalary.median, m.fteSalary.p75, maxPayScale, fmt, 'band-fte')}
          ${renderPayRangeBar(`Annualized Contractor Billing (${country.defaultBillableDays} days/yr)`, contractorAnnualP25, contractorAnnualMedian, contractorAnnualP75, maxPayScale, fmt, 'band-con')}
        </div>
      </div>
    </section>

    <!-- SECTION 03: GROWTH & COMPETITION -->
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">03</span>
        <div class="section-divider-text">
          <h2 class="section-heading">Job Growth &amp; How Competitive Is Hiring?</h2>
          <p class="section-sub">How pay and job numbers are moving over 5 years, and how hard employers find it to hire.</p>
        </div>
      </div>

      <div class="two-col-cards">
        <div class="card">
          <h3 class="card-title" style="margin-bottom:14px;">5-Year Growth (Pay vs Number of People)</h3>

          <div class="growth-bar-block">
            <div class="bracket-meta">
              <span class="bracket-label">Financial / Pay Growth (5-Year Trend)</span>
              <strong class="net-col">+${m.wageGrowth5yr}% <span class="muted">(+${m.wageGrowthYoY}% per year)</span></strong>
            </div>
            <div class="bracket-track tall">
              <div class="bracket-fill" style="width:${Math.min(100, Math.round(m.wageGrowth5yr * 1.45))}%"></div>
            </div>
            <div class="field-hint">At this pace, median full-time pay reaches ~<strong>${fmt(m.fteSalary.median * (1 + m.wageGrowth5yr / 100))}/yr</strong> over 5 years.</div>
          </div>

          <div class="growth-bar-block" style="margin-top:18px;">
            <div class="bracket-meta">
              <span class="bracket-label">Workforce / People Growth (5-Year Projection)</span>
              <strong class="retire-color">+${m.headcountGrowth5yr}% <span class="muted">(+${formatNumberCompact(m.workforceCount * (m.headcountGrowth5yr / 100))} new jobs)</span></strong>
            </div>
            <div class="bracket-track tall">
              <div class="bracket-fill jobs-bar" style="width:${Math.min(100, Math.round(m.headcountGrowth5yr * 2.4))}%"></div>
            </div>
            <div class="field-hint">Workforce projected to grow from <strong>${formatNumberCompact(m.workforceCount)}</strong> to ~<strong>${formatNumberCompact(m.workforceCount * (1 + m.headcountGrowth5yr / 100))} people</strong>.</div>
          </div>
        </div>

        <div class="card">
          <div class="card-title-row">
            <h3 class="card-title">Competition &amp; Hiring Demand</h3>
            <span class="comp-pill ${competitionTone(m.competition.level)}">${escapeHtml(friendlyCompetitionLabel(m.competition.level, m.competition.shortageStatus))}</span>
          </div>

          <div class="comp-stats-grid">
            <div class="comp-stat">
              <div class="kpi-label">People Working in Role</div>
              <div class="comp-stat-val">${m.workforceCount.toLocaleString()}</div>
            </div>
            <div class="comp-stat">
              <div class="kpi-label">Typical Applicants per Job Ad</div>
              <div class="comp-stat-val">~${m.competition.applicantsPerRole} people</div>
            </div>
          </div>

          <div class="fill-rate-box">
            <div class="bracket-meta">
              <span class="bracket-label">Share of Job Openings Employers Fill Easily</span>
              <strong>${m.competition.fillRatePct}% filled</strong>
            </div>
            <div class="bracket-track tall">
              <div class="bracket-fill fill-${m.competition.level.toLowerCase()}" style="width:${m.competition.fillRatePct}%"></div>
            </div>
            <div class="field-hint">When employers fill fewer than 65% of openings, qualified candidates have stronger bargaining power on pay and rates.</div>
          </div>

          <div class="driver-note">
            <strong>What’s happening in the market:</strong> ${escapeHtml(m.competition.driver)}
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION 04: CAREER GROWTH PATHWAYS -->
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">04</span>
        <div class="section-divider-text">
          <h2 class="section-heading">Where Can You Grow Next? (Career Pathways)</h2>
          <p class="section-sub">Common next steps from ${escapeHtml(role.title)}, showing how much extra take-home pay you actually keep after tax.</p>
        </div>
      </div>

      <div class="card">
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
                    <span class="pathway-time">Typical step: ${escapeHtml(pw.years)}</span>
                  </div>
                  <div class="pathway-title">${escapeHtml(targetTitle)}</div>
                  <div class="pathway-pay-row">
                    <span class="pathway-gross">${fmt(targetSalary)}/yr</span>
                    <span class="pathway-uplift ${pw.upliftPct >= 0 ? 'pos' : 'neg'}">${pw.upliftPct >= 0 ? '+' : ''}${pw.upliftPct}% gross pay</span>
                  </div>
                  <div class="pathway-net-impact ${positive ? 'pos' : 'neg'}">
                    ${positive ? 'Extra take-home: +' : 'Take-home change: −'}${fmt(Math.abs(netDeltaYr / 12))}/month (${positive ? '+' : '−'}${fmt(Math.abs(netDeltaYr))}/yr after tax)
                  </div>
                  <div class="pathway-skills-label">Skills to build for this step:</div>
                  <div class="pathway-skills">
                    ${(pw.bridgeSkills || []).map((sk) => `<span class="mini-skill">${escapeHtml(sk)}</span>`).join('')}
                  </div>
                  <div class="pathway-actions">
                    ${targetRole ? `<button type="button" class="btn-ghost btn-xs explore-pathway-btn" data-role-id="${targetRole.id}">Read Role Guide</button>` : ''}
                    <a href="${targetCalcUrl}" class="btn-primary btn-xs">Try in Calculator →</a>
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
        <div class="form-footnote mt-sm">Data source for ${escapeHtml(country.name)}: ${escapeHtml(m.source)} · Updated ${escapeHtml(dataset.lastUpdated)}.</div>
      </div>
    </section>
  `;
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
    <section class="editorial-section">
      <div class="card compare-roles-card">
        <div class="card-title-row">
          <h3 class="card-title">Side-by-Side Role Comparison (${country.flag} ${escapeHtml(country.name)})</h3>
          <button type="button" class="btn-ghost btn-xs" id="clear-role-compare-btn">Close Comparison</button>
        </div>
        <div class="table-scroll">
          <table class="freq-table">
            <thead>
              <tr>
                <th>What We’re Comparing</th>
                <th>${escapeHtml(roleA.title)}</th>
                <th>${escapeHtml(roleB.title)}</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>People Employed Nationally</td><td>${mA.workforceCount.toLocaleString()}</td><td>${mB.workforceCount.toLocaleString()}</td></tr>
              <tr><td>Full-Time Salary (Gross / Take-Home)</td><td>${fmt(mA.fteSalary.median)} · <span class="net-col">${fmt(netA)} net</span></td><td>${fmt(mB.fteSalary.median)} · <span class="net-col">${fmt(netB)} net</span></td></tr>
              <tr><td>Contractor Median Day Rate</td><td>${fmt(mA.contractorDayRate.median)}/day</td><td>${fmt(mB.contractorDayRate.median)}/day</td></tr>
              <tr><td>5-Year Pay / Job Growth</td><td>+${mA.wageGrowth5yr}% pay · +${mA.headcountGrowth5yr}% jobs</td><td>+${mB.wageGrowth5yr}% pay · +${mB.headcountGrowth5yr}% jobs</td></tr>
              <tr><td>Hiring Demand &amp; Fill Rate</td><td>${escapeHtml(mA.competition.shortageStatus)} (${mA.competition.fillRatePct}% filled)</td><td>${escapeHtml(mB.competition.shortageStatus)} (${mB.competition.fillRatePct}% filled)</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function renderDataSourcesModal() {
  if (!dataset) return;
  els.dsModalBody.innerHTML = `
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
    <div class="ds-sync-guide">
      <strong>Optional Free Weekly Live Refresh (GitHub Actions):</strong>
      <ol>
        <li>Register a free key at <code>developer.adzuna.com</code> (no credit card, 2,500 calls/mo free).</li>
        <li>In your GitHub repo → <strong>Settings → Secrets and variables → Actions</strong>, add <code>ADZUNA_APP_ID</code> and <code>ADZUNA_APP_KEY</code>.</li>
        <li>The included <code>.github/workflows/sync-data.yml</code> runs weekly to refresh live vacancy counts and salary averages into <code>data/roles.json</code> — keeping keys private and hosting at $0.</li>
      </ol>
    </div>
  `;
}

function bindEvents() {
  els.themeBtn?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });

  els.countryPills.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-country]');
    if (!btn) return;
    uiState.country = btn.dataset.country;
    renderCountryPills();
    renderAll();
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
    const item = e.target.closest('[data-role-id]');
    if (!item) return;
    uiState.selectedRoleId = item.dataset.roleId;
    renderAll();
  });

  els.detailRoot.addEventListener('click', (e) => {
    const cmpBtn = e.target.closest('#toggle-compare-role-btn');
    if (cmpBtn) {
      const id = cmpBtn.dataset.roleId;
      if (uiState.compareRoleId === id) {
        uiState.compareRoleId = null;
        showToast('Comparison closed');
      } else {
        uiState.compareRoleId = id;
        showToast('Pinned! Now click any other role in Section 01 to compare side-by-side.');
      }
      renderAll();
      return;
    }

    const exploreBtn = e.target.closest('.explore-pathway-btn');
    if (exploreBtn) {
      uiState.selectedRoleId = exploreBtn.dataset.roleId;
      uiState.category = 'All';
      uiState.search = '';
      if (els.searchInput) els.searchInput.value = '';
      renderCategoryChips();
      renderAll();
      els.detailRoot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  els.compareBar.addEventListener('click', (e) => {
    if (e.target.closest('#clear-role-compare-btn')) {
      uiState.compareRoleId = null;
      renderAll();
    }
  });

  els.dataSourcesBtn?.addEventListener('click', () => {
    renderDataSourcesModal();
    els.dsModal.hidden = false;
  });

  els.closeDsBtn?.addEventListener('click', () => {
    els.dsModal.hidden = true;
  });

  els.dsModal?.addEventListener('click', (e) => {
    if (e.target === els.dsModal) els.dsModal.hidden = true;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.dsModal && !els.dsModal.hidden) {
      els.dsModal.hidden = true;
    }
  });
}

init();
