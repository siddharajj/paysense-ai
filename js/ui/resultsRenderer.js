/**
 * Sections 02, 03 & 04 — Calm, Spacious, Confidence-Building Results Renderer.
 * Organizes results into clear numbered sections with plain-English takeaways
 * and a tabbed Section 04 for deeper tables so the screen never feels crowded.
 */

import { COUNTRIES, convertCurrency } from '../tax/countries.js';
import { formatCurrency, formatPercent } from '../tax/brackets.js';
import { renderMoneySplitBar, renderTaxBracketsChart } from './charts.js';
import { generateInsights } from '../ai/insights.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PERIOD_LABELS = {
  monthly: 'Monthly',
  fortnightly: 'Fortnightly',
  weekly: 'Weekly',
  annual: 'Yearly',
  daily: 'Daily',
  hourly: 'Hourly',
};

const PERIOD_UNIT_WORDS = {
  monthly: 'every month',
  fortnightly: 'every fortnight',
  weekly: 'every week',
  annual: 'per year',
  daily: 'per working day',
  hourly: 'per hour',
};

export function renderResultsDashboard(container, state, calc) {
  const { country, mode, periods, fteComparison } = calc;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);
  const dp = state.displayPeriod || 'monthly';
  const activeTab = state.detailTab || 'payslip';

  const heroNet = periods.net[dp] ?? periods.net.monthly;
  const heroGross = periods.gross[dp] ?? periods.gross.monthly;
  const heroTaxTotal = (periods.tax[dp] ?? 0) + (periods.levies[dp] ?? 0);
  const keepPct = calc.grossIncome > 0 ? Math.round((calc.netIncome / calc.grossIncome) * 100) : 100;

  const insights = generateInsights(calc, state);

  container.innerHTML = `
    <!-- SECTION 02: YOUR TAKE-HOME PAY -->
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">02</span>
        <div class="section-divider-text">
          <h2 class="section-heading">Your Take-Home Pay</h2>
          <p class="section-sub">What actually lands in your bank account after tax and deductions.</p>
        </div>
        <div class="hero-actions">
          <button type="button" class="btn-ghost btn-sm" id="pin-scenario-btn" title="Save this scenario to compare side-by-side">Save to Compare</button>
          <button type="button" class="btn-ghost btn-sm" id="share-link-btn" title="Copy a link to this exact calculation">Copy Link</button>
          <button type="button" class="btn-ghost btn-sm" id="export-csv-btn" title="Download spreadsheet CSV">Download CSV</button>
        </div>
      </div>

      <div class="card hero-card">
        <div class="period-tabs-row">
          <span class="period-prompt">View pay as:</span>
          <div class="period-tabs" role="tablist" aria-label="Display frequency">
            ${Object.entries(PERIOD_LABELS)
              .map(
                ([key, label]) => `
              <button type="button" class="period-tab ${dp === key ? 'active' : ''}" data-display-period="${key}">${label}</button>
            `
              )
              .join('')}
          </div>
        </div>

        <div class="take-home-spotlight">
          <div class="spotlight-label">Estimated Take-Home Pay (${PERIOD_LABELS[dp]})</div>
          <div class="hero-net-value">${fmt(heroNet)} <span class="hero-period-unit">${PERIOD_UNIT_WORDS[dp]}</span></div>
          <p class="plain-english-summary">
            Out of <strong>${fmt(calc.grossIncome)}/year</strong> in gross pay, you take home <strong>${fmt(calc.netIncome)}/year</strong> — meaning you keep <strong>${keepPct}%</strong> of what you earn, while <strong>${formatPercent(calc.effectiveTaxRate, 1)}</strong> goes to tax and levies.
          </p>
        </div>

        <!-- Simple, Intuitive Horizontal Money Split Bar -->
        ${renderMoneySplitBar(calc)}

        <div class="kpi-grid">
          <div class="kpi-tile">
            <div class="kpi-label">Gross Pay (${PERIOD_LABELS[dp]})</div>
            <div class="kpi-val">${fmt(heroGross)}</div>
            <div class="kpi-meta">${fmt(calc.grossIncome)} per year</div>
          </div>
          <div class="kpi-tile">
            <div class="kpi-label">Tax &amp; Levies (${PERIOD_LABELS[dp]})</div>
            <div class="kpi-val tax-color">${fmt(heroTaxTotal)}</div>
            <div class="kpi-meta">Overall tax rate: ${formatPercent(calc.effectiveTaxRate, 1)}</div>
          </div>
          <div class="kpi-tile">
            <div class="kpi-label">${escapeHtml(country.retirementLabel)}</div>
            <div class="kpi-val retire-color">${fmt(periods.retirement[dp])}</div>
            <div class="kpi-meta">${fmt(calc.totalRetirement)} per year into retirement</div>
          </div>
          <div class="kpi-tile">
            <div class="kpi-label">${mode === 'contractor' && calc.indirectTaxInvoice > 0 ? 'Total to Invoice Client' : 'Total Package Value'}</div>
            <div class="kpi-val">${mode === 'contractor' && calc.indirectTaxInvoice > 0 ? fmt((calc.grossIncome + calc.indirectTaxInvoice) / (dp === 'annual' ? 1 : dp === 'monthly' ? 12 : dp === 'fortnightly' ? 26 : dp === 'weekly' ? 52 : dp === 'daily' ? calc.workingDays : calc.annualHours)) : fmt(periods.totalPackage[dp])}</div>
            <div class="kpi-meta">${mode === 'contractor' && calc.indirectTaxInvoice > 0 ? `Includes +${fmt(calc.indirectTaxInvoice)}/yr ${country.indirectTaxLabel}` : `Salary + employer ${country.retirementLabel}`}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION 03: REALITY CHECK & HELPFUL GUIDANCE -->
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">03</span>
        <div class="section-divider-text">
          <h2 class="section-heading">${mode === 'contractor' ? 'Contractor vs Full-Time Reality Check' : 'Full-Time vs Contractor Reality Check'}</h2>
          <p class="section-sub">How your pay compares across work styles, plus practical tips for your tax bracket.</p>
        </div>
      </div>

      ${renderFteComparisonCard(calc, fmt)}

      <div class="card guidance-card">
        <h3 class="card-title" style="margin-bottom:14px;">Helpful Guidance for Your Numbers</h3>
        <div class="insights-grid">
          ${insights
            .map(
              (ins) => `
            <div class="insight-card tone-${ins.tone}">
              <div class="insight-badge">${escapeHtml(ins.badge)}</div>
              <div class="insight-title">${escapeHtml(ins.title)}</div>
              <p class="insight-body">${escapeHtml(ins.body)}</p>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    </section>

    <!-- SECTION 04: DETAILED BREAKDOWN (TABBED FOR BREATHING ROOM) -->
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">04</span>
        <div class="section-divider-text">
          <h2 class="section-heading">Line-by-Line Details</h2>
          <p class="section-sub">Switch tabs below to inspect your full annual statement, pay periods, or tax brackets.</p>
        </div>
      </div>

      <div class="card detail-tabs-card">
        <div class="detail-tab-bar" role="tablist">
          <button type="button" class="detail-tab-btn ${activeTab === 'payslip' ? 'active' : ''}" data-detail-tab="payslip">
            Line-by-Line Statement
          </button>
          <button type="button" class="detail-tab-btn ${activeTab === 'periods' ? 'active' : ''}" data-detail-tab="periods">
            All Pay Periods Table
          </button>
          <button type="button" class="detail-tab-btn ${activeTab === 'brackets' ? 'active' : ''}" data-detail-tab="brackets">
            How Your Tax Brackets Work
          </button>
        </div>

        <div class="detail-tab-panel">
          ${activeTab === 'payslip' ? renderPayslipTab(calc, fmt) : ''}
          ${activeTab === 'periods' ? renderPeriodsTab(calc, fmt, dp) : ''}
          ${activeTab === 'brackets' ? renderTaxBracketsChart(calc) : ''}
        </div>
      </div>
    </section>

    <!-- SAVED SCENARIO COMPARISONS (WHEN PINNED) -->
    ${renderPinnedComparison(state)}
  `;
}

function renderPayslipTab(calc, fmt) {
  return `
    <div class="statement-list">
      ${calc.lineItems
        .map(
          (item) => `
        <div class="statement-row kind-${item.kind}">
          <div class="statement-label-wrap">
            <span class="statement-label">${escapeHtml(item.label)}</span>
            ${item.note ? `<span class="statement-note">${escapeHtml(item.note)}</span>` : ''}
          </div>
          <span class="statement-val">${item.amount < 0 ? '−' : ''}${fmt(Math.abs(item.amount))}<span class="unit">/yr</span></span>
        </div>
      `
        )
        .join('')}
    </div>
  `;
}

function renderPeriodsTab(calc, fmt, dp) {
  const { periods } = calc;
  return `
    <div class="table-scroll">
      <table class="freq-table">
        <thead>
          <tr>
            <th>Pay Period</th>
            <th>Gross Pay</th>
            <th>Tax &amp; Levies</th>
            <th>${escapeHtml(calc.country.retirementLabel)}</th>
            <th>Take-Home Pay</th>
          </tr>
        </thead>
        <tbody>
          ${['annual', 'monthly', 'fortnightly', 'weekly', 'daily', 'hourly']
            .map(
              (p) => `
            <tr class="${p === dp ? 'active-row' : ''}">
              <td><strong>${PERIOD_LABELS[p]}</strong></td>
              <td>${fmt(periods.gross[p])}</td>
              <td class="tax-color">−${fmt(periods.tax[p] + periods.levies[p])}</td>
              <td class="retire-color">${fmt(periods.retirement[p])}</td>
              <td class="net-col">${fmt(periods.net[p])}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderFteComparisonCard(calc, fmt) {
  const { country, mode, fteComparison } = calc;
  if (!fteComparison || calc.grossIncome <= 0) return '';

  if (mode === 'contractor') {
    const hasCompare = Boolean(fteComparison.compareRes);
    const diff = fteComparison.wealthDeltaVsCompare || 0;
    const isAhead = diff >= 0;

    return `
      <div class="card reality-card">
        <p class="reality-intro">
          Because contractors don’t get paid holidays, sick leave, or employer ${escapeHtml(country.retirementLabel)}, a day rate needs to be higher than a full-time salary to leave you equally well off. Here is what your rate really equals:
        </p>
        <div class="reality-grid">
          <div class="reality-metric highlight">
            <div class="reality-label">Matches a Full-Time Salary of</div>
            <div class="reality-big">${fmt(fteComparison.equivalentFteBase)}<span class="unit">/yr</span></div>
            <div class="reality-sub">Plus employer ${escapeHtml(country.retirementLabel)} (${fmt(fteComparison.equivalentFtePackage)} total package)</div>
          </div>
          <div class="reality-metric">
            <div class="reality-label">Monthly Tax Savings Bucket</div>
            <div class="reality-big">${fmt(calc.taxVaultAnnual / 12)}<span class="unit">/mo</span></div>
            <div class="reality-sub">Set this aside each month to comfortably cover ${calc.indirectTaxInvoice > 0 ? `${country.indirectTaxLabel} & income tax` : 'your tax bill'}</div>
          </div>
          ${
            hasCompare
              ? `
            <div class="reality-metric ${isAhead ? 'verdict-pos' : 'verdict-neg'}">
              <div class="reality-label">Compared to ${fmt(fteComparison.compareSalary)} Full-Time Offer</div>
              <div class="reality-big">${isAhead ? '+' : '−'}${fmt(Math.abs(diff))}<span class="unit">/yr</span></div>
              <div class="reality-sub">${isAhead ? 'Contracting leaves you ahead overall' : 'The permanent role leaves you ahead overall'}</div>
            </div>
          `
              : `
            <div class="reality-metric">
              <div class="reality-label">Unpaid Time Off Built In</div>
              <div class="reality-big">${260 - fteComparison.billableDays} <span class="unit">days off</span></div>
              <div class="reality-sub">Covers ${escapeHtml(fteComparison.unpaidLeaveValueNote)}</div>
            </div>
          `
          }
        </div>
      </div>
    `;
  }

  const hasCompare = Boolean(fteComparison.compareRes);
  const diff = fteComparison.wealthDeltaVsCompare || 0;
  return `
    <div class="card reality-card">
      <p class="reality-intro">
        If you ever switch from this full-time job to contracting (assuming ${fteComparison.billableDays} billable days/year after holidays and sick leave), here is the daily rate you’d need just to break even:
      </p>
      <div class="reality-grid">
        <div class="reality-metric highlight">
          <div class="reality-label">Breakeven Contractor Day Rate</div>
          <div class="reality-big">${fmt(fteComparison.equivalentDayRate)}<span class="unit">/day</span></div>
          <div class="reality-sub">Or ~${fmt(fteComparison.equivalentHourlyRate)}/hour to match your net pay + ${escapeHtml(country.retirementLabel)}</div>
        </div>
        <div class="reality-metric">
          <div class="reality-label">Annual Contractor Billing Needed</div>
          <div class="reality-big">${fmt(fteComparison.equivalentContractorAnnual)}<span class="unit">/yr</span></div>
          <div class="reality-sub">Before any ${escapeHtml(country.indirectTaxLabel)} or business expenses</div>
        </div>
        ${
          hasCompare
            ? `
          <div class="reality-metric ${diff >= 0 ? 'verdict-pos' : 'verdict-neg'}">
            <div class="reality-label">Compared to ${fmt(fteComparison.compareDayRate)}/day Contract</div>
            <div class="reality-big">${diff >= 0 ? '+' : '−'}${fmt(Math.abs(diff))}<span class="unit">/yr</span></div>
            <div class="reality-sub">${diff >= 0 ? 'That contract rate beats your salary' : 'Your full-time package beats that contract rate'}</div>
          </div>
        `
            : `
          <div class="reality-metric">
            <div class="reality-label">Rule of Thumb</div>
            <div class="reality-sub" style="margin-top:6px;">Most contractors aim for <strong>15%–25% above breakeven</strong> (~${fmt(Math.round(fteComparison.equivalentDayRate * 1.2))}/day) to reward the extra risk between contracts.</div>
          </div>
        `
        }
      </div>
    </div>
  `;
}

function renderPinnedComparison(state) {
  const pins = state.pinnedScenarios || [];
  if (!pins.length) return '';

  const baseCode = state.comparisonCurrency || 'USD';
  const baseCountry = Object.values(COUNTRIES).find((c) => c.currency === baseCode) || COUNTRIES.US;

  return `
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">05</span>
        <div class="section-divider-text">
          <h2 class="section-heading">Your Saved Comparisons</h2>
          <p class="section-sub">Side-by-side comparison of scenarios you saved.</p>
        </div>
        <div class="pin-controls">
          <label class="sub-label" for="compare-currency-select">Compare in:</label>
          <select id="compare-currency-select" class="mini-select">
            ${Object.values(COUNTRIES)
              .map((c) => `<option value="${c.currency}" ${c.currency === baseCode ? 'selected' : ''}>${c.flag} ${c.currency}</option>`)
              .join('')}
          </select>
          <button type="button" class="btn-ghost btn-xs" id="clear-pins-btn">Clear All</button>
        </div>
      </div>

      <div class="card">
        <div class="table-scroll">
          <table class="freq-table pins-table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Take-Home (Local)</th>
                <th>Take-Home (${baseCode} approx.)</th>
                <th>Overall Tax Rate</th>
                <th>Take-Home + Retirement (${baseCode})</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${pins
                .map((p, idx) => {
                  const c = COUNTRIES[p.country] || COUNTRIES.AU;
                  const localNet = formatCurrency(p.netIncome, c.currency, c.locale);
                  const normNet = convertCurrency(p.netIncome, c.code, baseCountry.code);
                  const normWealth = convertCurrency(p.netIncome + p.totalRetirement, c.code, baseCountry.code);
                  return `
                    <tr>
                      <td>
                        <div class="pin-name">${c.flag} ${escapeHtml(p.label)}</div>
                        <div class="pin-meta">${p.mode === 'contractor' ? 'Contractor' : 'Full-Time'} · ${escapeHtml(p.subtitle)}</div>
                      </td>
                      <td><strong>${localNet}/yr</strong></td>
                      <td class="net-col">${formatCurrency(normNet, baseCountry.currency, baseCountry.locale)}/yr</td>
                      <td>${formatPercent(p.effectiveTaxRate, 1)}</td>
                      <td>${formatCurrency(normWealth, baseCountry.currency, baseCountry.locale)}/yr</td>
                      <td>
                        <button type="button" class="icon-btn remove-pin-btn" data-pin-idx="${idx}" title="Remove">✕</button>
                      </td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}
