/**
 * PaySense AI — Role & Market Intelligence Explorer (roles.html)
 * Loads static open-data benchmarks from ./data/roles.json, computes real
 * localized after-tax take-home for FTE, Contractor, and Career Pathways,
 * and deep-links straight into the Pay Calculator (./index.html#s=...).
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
    els.themeBtn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }
}

function showToast(msg) {
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.classList.add('visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove('visible'), 2500);
}

/**
 * Build a real PaySense AI calculator input for any role's FTE or Contractor median.
 */
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
        <h2 class="card-title">Unable to load open market dataset</h2>
        <p class="muted">Could not fetch <code>./data/roles.json</code> (${escapeHtml(err.message)}). If viewing locally, run <code>python3 -m http.server 8080</code>.</p>
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
    ? `<span class="status-dot live"></span> Live Synced · ${escapeHtml(dataset.lastUpdated)}`
    : `<span class="status-dot local"></span> Open Gov Data · $0`;
}

function renderCountryPills() {
  els.countryPills.innerHTML = COUNTRY_LIST.map(
    (c) => `
    <button type="button" class="country-pill ${c.code === uiState.country ? 'active' : ''}" data-country="${c.code}" title="${escapeHtml(c.name)} (${escapeHtml(c.currency)})">
      <span class="pill-flag">${c.flag}</span>
      <span class="pill-code">${c.code}</span>
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
      ${escapeHtml(cat)}
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

  if (roles.length && !roles.some((r) => r.id === uiState.selectedRoleId)) {
    uiState.selectedRoleId = roles[0].id;
  }

  els.countLabel.textContent = `${roles.length} of ${dataset.roles.length} roles in ${country.flag} ${country.name}`;

  if (!roles.length) {
    els.listRoot.innerHTML = `<div class="empty-state">No roles match “${escapeHtml(uiState.search)}”. Try clearing filters.</div>`;
    els.detailRoot.innerHTML = `<div class="card"><p class="muted">Select a role to view full market intelligence.</p></div>`;
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
            <span class="comp-pill ${competitionTone(m.competition.level)}">${escapeHtml(m.competition.shortageStatus)}</span>
          </div>
          <div class="rli-metrics">
            <span>💼 ${fmt(m.fteSalary.median)}/yr</span>
            <span>🛠 ${fmt(m.contractorDayRate.median)}/day</span>
          </div>
          <div class="rli-footer">
            <span class="muted">👥 ${formatNumberCompact(m.workforceCount)} people</span>
            <span class="growth-mini">+${m.headcountGrowth5yr}% jobs · +${m.wageGrowth5yr}% pay (5y)</span>
            ${isCompared ? '<span class="cmp-tag">Comparing</span>' : ''}
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

  // Compute live after-tax take-home for FTE median and Contractor median!
  const fteCalc = calculatePay(buildCalcInput(cCode, 'employee', m.fteSalary.median, m.contractorDayRate.median));
  const conCalc = calculatePay(buildCalcInput(cCode, 'contractor', m.contractorDayRate.median, m.fteSalary.median));
  const contractorAnnualMedian = m.contractorDayRate.median * country.defaultBillableDays;
  const contractorAnnualP25 = m.contractorDayRate.p25 * country.defaultBillableDays;
  const contractorAnnualP75 = m.contractorDayRate.p75 * country.defaultBillableDays;

  const fteLink = buildCalculatorDeepLink(cCode, 'employee', m.fteSalary.median, m.contractorDayRate.median);
  const conLink = buildCalculatorDeepLink(cCode, 'contractor', m.contractorDayRate.median, m.fteSalary.median);

  const isCompareTarget = uiState.compareRoleId === role.id;

  // Compute max scale for SVG pay range comparison
  const maxPayScale = Math.max(m.fteSalary.p75, contractorAnnualP75, 1);

  els.detailRoot.innerHTML = `
    <!-- Role Hero Card -->
    <section class="card role-hero-card">
      <div class="role-hero-top">
        <div>
          <div class="hero-eyebrow">
            <span>${country.flag} ${escapeHtml(country.name)}</span>
            <span class="dot-sep">·</span>
            <span>${escapeHtml(role.category)}</span>
            <span class="dot-sep">·</span>
            <span title="Official occupation classification codes">ANZSCO ${escapeHtml(role.codes.anzsco)} · SOC ${escapeHtml(role.codes.soc)}</span>
          </div>
          <h2 class="role-hero-title">${escapeHtml(role.title)}</h2>
          <p class="role-hero-summary">${escapeHtml(role.summary)}</p>
        </div>
        <div class="role-hero-actions">
          <button type="button" class="btn-ghost btn-sm" id="toggle-compare-role-btn" data-role-id="${role.id}">
            ${isCompareTarget ? '✓ Comparing' : '⚖️ Compare Role'}
          </button>
        </div>
      </div>

      <div class="skills-row">
        ${(role.skills || []).map((s) => `<span class="skill-chip">${escapeHtml(s)}</span>`).join('')}
      </div>

      <div class="calc-launch-row">
        <a href="${fteLink}" class="btn-primary calc-launch-btn">
          💼 Load FTE (${fmt(m.fteSalary.median)}/yr) in Pay Calculator →
        </a>
        <a href="${conLink}" class="btn-secondary calc-launch-btn">
          🛠 Load Contractor (${fmt(m.contractorDayRate.median)}/day) in Calculator →
        </a>
      </div>
    </section>

    <!-- 4 Core Market KPIs -->
    <section class="role-kpi-grid">
      <div class="card role-kpi-card">
        <div class="kpi-label">👥 People in This Role</div>
        <div class="role-kpi-big">${formatNumberCompact(m.workforceCount)}</div>
        <div class="kpi-meta">~${formatNumberCompact(m.annualOpenings)} openings / yr in ${escapeHtml(country.name)}</div>
        ${m.liveVacancies ? `<div class="live-pulse-tag">🟢 ${m.liveVacancies.toLocaleString()} live Adzuna ads</div>` : ''}
      </div>

      <div class="card role-kpi-card">
        <div class="kpi-label">💼 Median Full-Time Pay</div>
        <div class="role-kpi-big">${fmt(m.fteSalary.median)}<span class="unit">/yr</span></div>
        <div class="kpi-meta">Est. take-home: <strong class="net-col">${fmt(fteCalc.periods.net.monthly)}/mo</strong></div>
        <div class="kpi-meta">Range: ${fmt(m.fteSalary.p25)} – ${fmt(m.fteSalary.p75)}</div>
      </div>

      <div class="card role-kpi-card">
        <div class="kpi-label">🛠 Median Contractor Rate</div>
        <div class="role-kpi-big">${fmt(m.contractorDayRate.median)}<span class="unit">/day</span></div>
        <div class="kpi-meta">Est. take-home: <strong class="net-col">${fmt(conCalc.periods.net.monthly)}/mo</strong> (${country.defaultBillableDays}d)</div>
        <div class="kpi-meta">Range: ${fmt(m.contractorDayRate.p25)} – ${fmt(m.contractorDayRate.p75)} / day</div>
      </div>

      <div class="card role-kpi-card">
        <div class="kpi-label">📈 5-Year Dual Growth</div>
        <div class="dual-growth-vals">
          <div>
            <span class="growth-pill pay">+${m.wageGrowth5yr}%</span>
            <span class="kpi-meta">Pay (+${m.wageGrowthYoY}% YoY)</span>
          </div>
          <div>
            <span class="growth-pill jobs">+${m.headcountGrowth5yr}%</span>
            <span class="kpi-meta">Headcount</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Pay Distribution + Competition & Market Tightness -->
    <section class="two-col-cards">
      <div class="card">
        <div class="card-title-row">
          <h3 class="card-title">FTE vs Contractor Annualized Pay Bands</h3>
          <span class="card-badge">25th · Median · 75th</span>
        </div>

        <div class="pay-bands-wrap">
          ${renderPayRangeBar('Full-Time Salary (Gross)', m.fteSalary.p25, m.fteSalary.median, m.fteSalary.p75, maxPayScale, fmt, 'band-fte')}
          ${renderPayRangeBar(`Contractor (${country.defaultBillableDays}d Gross)`, contractorAnnualP25, contractorAnnualMedian, contractorAnnualP75, maxPayScale, fmt, 'band-con')}
        </div>

        <div class="reality-strip">
          <div>
            <span class="muted">Contractor Net Premium vs FTE:</span>
            <strong class="${conCalc.netIncome >= fteCalc.netIncome ? 'net-col' : 'tax-color'}">
              ${conCalc.netIncome >= fteCalc.netIncome ? '+' : '−'}${fmt(Math.abs(conCalc.netIncome - fteCalc.netIncome))}/yr cash
            </strong>
          </div>
          <div class="muted" style="font-size:0.74rem; margin-top:4px;">
            Contractor day rate equals ~${fmt(conCalc.fteComparison.equivalentFteBase)} + ${country.retirementLabel} permanent package.
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title-row">
          <h3 class="card-title">Competition &amp; Talent Shortage</h3>
          <span class="comp-pill ${competitionTone(m.competition.level)}">${escapeHtml(m.competition.level)} Competition</span>
        </div>

        <div class="comp-stats-grid">
          <div class="comp-stat">
            <div class="kpi-label">Market Rating</div>
            <div class="comp-stat-val">${escapeHtml(m.competition.shortageStatus)}</div>
          </div>
          <div class="comp-stat">
            <div class="kpi-label">Avg Applicants / Role</div>
            <div class="comp-stat-val">~${m.competition.applicantsPerRole}</div>
          </div>
        </div>

        <div class="fill-rate-box">
          <div class="bracket-meta">
            <span class="bracket-label">Employer Vacancy Fill Rate</span>
            <strong>${m.competition.fillRatePct}% filled</strong>
          </div>
          <div class="bracket-track">
            <div class="bracket-fill fill-${m.competition.level.toLowerCase()}" style="width:${m.competition.fillRatePct}%"></div>
          </div>
          <div class="field-hint">Lower fill rate = harder for employers to hire = stronger pay negotiation leverage.</div>
        </div>

        <div class="driver-note">
          <strong>Key Market Driver:</strong> ${escapeHtml(m.competition.driver)}
        </div>
      </div>
    </section>

    <!-- Dual Growth Visual (Financial vs People Growth) -->
    <section class="card">
      <div class="card-title-row">
        <h3 class="card-title">📊 Growth Trajectory — Financial vs Workforce Size</h3>
        <span class="card-badge">5-Year Outlook</span>
      </div>
      <div class="growth-bars-grid">
        <div class="growth-bar-block">
          <div class="bracket-meta">
            <span class="bracket-label">💰 Financial / Wage Growth (5-yr cumulative)</span>
            <strong class="net-col">+${m.wageGrowth5yr}% <span class="muted">(+${m.wageGrowthYoY}% YoY)</span></strong>
          </div>
          <div class="bracket-track tall">
            <div class="bracket-fill" style="width:${Math.min(100, Math.round(m.wageGrowth5yr * 1.45))}%"></div>
          </div>
          <div class="field-hint">Projected median FTE pay in 5 yrs at current trend: <strong>${fmt(m.fteSalary.median * (1 + m.wageGrowth5yr / 100))}</strong></div>
        </div>

        <div class="growth-bar-block">
          <div class="bracket-meta">
            <span class="bracket-label">👥 Workforce / Headcount Growth (5-yr projection)</span>
            <strong class="retire-color">+${m.headcountGrowth5yr}% <span class="muted">(+${formatNumberCompact(m.workforceCount * (m.headcountGrowth5yr / 100))} net new jobs)</span></strong>
          </div>
          <div class="bracket-track tall">
            <div class="bracket-fill jobs-bar" style="width:${Math.min(100, Math.round(m.headcountGrowth5yr * 2.4))}%"></div>
          </div>
          <div class="field-hint">Projected national headcount in 5 yrs: <strong>${formatNumberCompact(m.workforceCount * (1 + m.headcountGrowth5yr / 100))}</strong></div>
        </div>
      </div>
    </section>

    <!-- Interactive Career Growth Pathways -->
    <section class="card">
      <div class="card-title-row">
        <h3 class="card-title">🚀 Career Growth Pathways (After-Tax Impact)</h3>
        <span class="card-badge">O*NET &amp; JSA Mobility</span>
      </div>
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
                  ${positive ? '+' : '−'}${fmt(Math.abs(netDeltaYr))}/yr after-tax (${positive ? '+' : '−'}${fmt(Math.abs(netDeltaYr / 12))}/mo)
                </div>
                <div class="pathway-skills">
                  ${(pw.bridgeSkills || []).map((sk) => `<span class="mini-skill">${escapeHtml(sk)}</span>`).join('')}
                </div>
                <div class="pathway-actions">
                  ${targetRole ? `<button type="button" class="btn-ghost btn-xs explore-pathway-btn" data-role-id="${targetRole.id}">Explore Role</button>` : ''}
                  <a href="${targetCalcUrl}" class="btn-primary btn-xs">Test in Calculator →</a>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
      <div class="form-footnote mt-sm">Primary benchmark source for ${escapeHtml(country.name)}: ${escapeHtml(m.source)} · Dataset updated ${escapeHtml(dataset.lastUpdated)}.</div>
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
          <span class="muted">${fmt(p25)}</span>
          <strong>${fmt(median)}</strong>
          <span class="muted">${fmt(p75)}</span>
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
    <section class="card compare-roles-card">
      <div class="card-title-row">
        <h3 class="card-title">⚖️ Role vs Role Comparison (${country.flag} ${escapeHtml(country.name)})</h3>
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
            <tr><td>Workforce Size</td><td>${formatNumberCompact(mA.workforceCount)}</td><td>${formatNumberCompact(mB.workforceCount)}</td></tr>
            <tr><td>FTE Median (Gross / Net)</td><td>${fmt(mA.fteSalary.median)} · <span class="net-col">${fmt(netA)}</span></td><td>${fmt(mB.fteSalary.median)} · <span class="net-col">${fmt(netB)}</span></td></tr>
            <tr><td>Contractor Median Day Rate</td><td>${fmt(mA.contractorDayRate.median)}/day</td><td>${fmt(mB.contractorDayRate.median)}/day</td></tr>
            <tr><td>5-Yr Wage / Job Growth</td><td>+${mA.wageGrowth5yr}% pay · +${mA.headcountGrowth5yr}% jobs</td><td>+${mB.wageGrowth5yr}% pay · +${mB.headcountGrowth5yr}% jobs</td></tr>
            <tr><td>Competition / Fill Rate</td><td>${escapeHtml(mA.competition.level)} (${mA.competition.fillRatePct}% filled)</td><td>${escapeHtml(mB.competition.level)} (${mB.competition.fillRatePct}% filled)</td></tr>
          </tbody>
        </table>
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
          <div class="muted" style="font-size:0.8rem;">${escapeHtml(s.metrics)}</div>
          <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" class="ds-link">${escapeHtml(s.url)} ↗</a>
        </div>
      `
        )
        .join('')}
    </div>
    <div class="ds-sync-guide">
      <strong>🔄 Enable Optional Free Weekly Live Refresh (GitHub Actions):</strong>
      <ol>
        <li>Register a free developer key at <code>developer.adzuna.com</code> (no credit card, 2,500 calls/mo free).</li>
        <li>In your GitHub repo → <strong>Settings → Secrets and variables → Actions</strong>, add <code>ADZUNA_APP_ID</code> and <code>ADZUNA_APP_KEY</code>.</li>
        <li>The included <code>.github/workflows/sync-data.yml</code> runs weekly (or manually via <strong>Actions → Sync Open Market Data</strong>) to refresh live vacancies and salary pulses directly into <code>data/roles.json</code> — keeping keys 100% hidden and hosting at $0!</li>
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
        showToast('Comparison cleared');
      } else {
        uiState.compareRoleId = id;
        showToast('Pinned! Now click another role on the left to compare side-by-side.');
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
