/**
 * Compact Animated Tabbed Stage for Pay Calculator Results (index.html).
 * Eliminates long vertical scrolling by showing one clean view at a time
 * with smooth animations + Pop-Up modal support for full tables.
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
  const { country, mode, periods } = calc;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);
  const dp = state.displayPeriod || 'monthly';
  const stageView = state.stageView || 'overview'; // 'overview' | 'reality' | 'payslip' | 'brackets' | 'saved'

  const heroNet = periods.net[dp] ?? periods.net.monthly;
  const heroGross = periods.gross[dp] ?? periods.gross.monthly;
  const heroTaxTotal = (periods.tax[dp] ?? 0) + (periods.levies[dp] ?? 0);
  const keepPct = calc.grossIncome > 0 ? Math.round((calc.netIncome / calc.grossIncome) * 100) : 100;
  const pins = state.pinnedScenarios || [];

  container.innerHTML = `
    <!-- Animated Stage Navigation Bar -->
    <div class="stage-nav-bar">
      <div class="stage-tabs" role="tablist">
        <button type="button" class="stage-tab ${stageView === 'overview' ? 'active' : ''}" data-stage-view="overview">
          02 · Take-Home &amp; Split
        </button>
        <button type="button" class="stage-tab ${stageView === 'reality' ? 'active' : ''}" data-stage-view="reality">
          03 · Reality Check &amp; Tips
        </button>
        <button type="button" class="stage-tab ${stageView === 'payslip' ? 'active' : ''}" data-stage-view="payslip">
          04 · Payslip &amp; Periods
        </button>
        <button type="button" class="stage-tab ${stageView === 'brackets' ? 'active' : ''}" data-stage-view="brackets">
          05 · Tax Brackets
        </button>
        ${
          pins.length > 0
            ? `
          <button type="button" class="stage-tab ${stageView === 'saved' ? 'active' : ''}" data-stage-view="saved">
            Saved (${pins.length})
          </button>
        `
            : ''
        }
      </div>

      <div class="hero-actions">
        <button type="button" class="btn-ghost btn-xs" id="pin-scenario-btn" title="Save to compare">📌 Compare</button>
        <button type="button" class="btn-ghost btn-xs" id="share-link-btn" title="Copy share link">🔗 Link</button>
        <button type="button" class="btn-ghost btn-xs" id="export-csv-btn" title="Download CSV">⬇ CSV</button>
      </div>
    </div>

    <!-- Active Stage Panel (Animated, Fits Above the Fold!) -->
    <div class="card stage-card animate-stage">
      ${stageView === 'overview' ? renderOverviewStage(calc, state, fmt, dp, heroNet, heroGross, heroTaxTotal, keepPct) : ''}
      ${stageView === 'reality' ? renderRealityStage(calc, state, fmt) : ''}
      ${stageView === 'payslip' ? renderPayslipAndPeriodsStage(calc, fmt, dp) : ''}
      ${stageView === 'brackets' ? renderTaxBracketsChart(calc) : ''}
      ${stageView === 'saved' ? renderPinnedComparison(state) : ''}
    </div>
  `;
}

function renderOverviewStage(calc, state, fmt, dp, heroNet, heroGross, heroTaxTotal, keepPct) {
  const { country, mode, periods } = calc;
  return `
    <div class="period-tabs-row">
      <span class="period-prompt">Show pay as:</span>
      <div class="period-tabs" role="tablist">
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
        Out of <strong>${fmt(calc.grossIncome)}/year</strong> in gross pay, you take home <strong>${fmt(calc.netIncome)}/year</strong> — keeping <strong>${keepPct}%</strong> of what you earn while <strong>${formatPercent(calc.effectiveTaxRate, 1)}</strong> goes to tax and levies.
      </p>
    </div>

    ${renderMoneySplitBar(calc)}

    <div class="kpi-grid">
      <div class="kpi-tile">
        <div class="kpi-label">Gross Pay (${PERIOD_LABELS[dp]})</div>
        <div class="kpi-val">${fmt(heroGross)}</div>
        <div class="kpi-meta">${fmt(calc.grossIncome)} / year</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Tax &amp; Levies (${PERIOD_LABELS[dp]})</div>
        <div class="kpi-val tax-color">${fmt(heroTaxTotal)}</div>
        <div class="kpi-meta">Overall tax: ${formatPercent(calc.effectiveTaxRate, 1)}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">${escapeHtml(country.retirementLabel)}</div>
        <div class="kpi-val retire-color">${fmt(periods.retirement[dp])}</div>
        <div class="kpi-meta">${fmt(calc.totalRetirement)} / year total</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">${mode === 'contractor' && calc.indirectTaxInvoice > 0 ? 'Total to Invoice Client' : 'Total Package Value'}</div>
        <div class="kpi-val">${mode === 'contractor' && calc.indirectTaxInvoice > 0 ? fmt((calc.grossIncome + calc.indirectTaxInvoice) / (dp === 'annual' ? 1 : dp === 'monthly' ? 12 : dp === 'fortnightly' ? 26 : dp === 'weekly' ? 52 : dp === 'daily' ? calc.workingDays : calc.annualHours)) : fmt(periods.totalPackage[dp])}</div>
        <div class="kpi-meta">${mode === 'contractor' && calc.indirectTaxInvoice > 0 ? `+${fmt(calc.indirectTaxInvoice)}/yr ${country.indirectTaxLabel}` : `Salary + ${country.retirementLabel}`}</div>
      </div>
    </div>
  `;
}

function renderRealityStage(calc, state, fmt) {
  const insights = generateInsights(calc, state);
  return `
    ${renderFteComparisonCard(calc, fmt)}
    <h3 class="mini-section-title" style="margin-top:22px;">Helpful Guidance for Your Numbers</h3>
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
  `;
}

function renderPayslipAndPeriodsStage(calc, fmt, dp) {
  const { periods } = calc;
  return `
    <div class="two-col-cards">
      <div>
        <h3 class="mini-section-title">Line-by-Line Annual Statement</h3>
        <div class="statement-list">
          ${calc.lineItems
            .map(
              (item) => `
            <div class="statement-row kind-${item.kind}">
              <div class="statement-label-wrap">
                <span class="statement-label">${escapeHtml(item.label)}</span>
                ${item.note ? `<span class="statement-note">${escapeHtml(item.note)}</span>` : ''}
              </div>
              <span class="statement-val">${item.amount < 0 ? '−' : ''}${fmt(Math.abs(item.amount))}</span>
            </div>
          `
            )
            .join('')}
        </div>
      </div>

      <div>
        <h3 class="mini-section-title">Pay Across All Periods</h3>
        <div class="table-scroll">
          <table class="freq-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Gross</th>
                <th>Tax &amp; Levies</th>
                <th>Take-Home</th>
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
                  <td class="net-col">${fmt(periods.net[p])}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
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
      <div>
        <h3 class="mini-section-title">Contractor vs Full-Time Reality Check (${fteComparison.billableDays} billable days/yr)</h3>
        <div class="reality-grid">
          <div class="reality-metric highlight">
            <div class="reality-label">Matches a Full-Time Salary of</div>
            <div class="reality-big">${fmt(fteComparison.equivalentFteBase)}<span class="unit">/yr</span></div>
            <div class="reality-sub">Plus employer ${escapeHtml(country.retirementLabel)} (${fmt(fteComparison.equivalentFtePackage)} total package)</div>
          </div>
          <div class="reality-metric">
            <div class="reality-label">Monthly Tax Savings Bucket</div>
            <div class="reality-big">${fmt(calc.taxVaultAnnual / 12)}<span class="unit">/mo</span></div>
            <div class="reality-sub">Set aside to cover ${calc.indirectTaxInvoice > 0 ? `${country.indirectTaxLabel} & income tax` : 'your tax bill'}</div>
          </div>
          ${
            hasCompare
              ? `
            <div class="reality-metric ${isAhead ? 'verdict-pos' : 'verdict-neg'}">
              <div class="reality-label">vs ${fmt(fteComparison.compareSalary)} Full-Time Offer</div>
              <div class="reality-big">${isAhead ? '+' : '−'}${fmt(Math.abs(diff))}<span class="unit">/yr</span></div>
              <div class="reality-sub">${isAhead ? 'Contracting leaves you ahead' : 'The permanent role leaves you ahead'}</div>
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
    <div>
      <h3 class="mini-section-title">Full-Time vs Contractor Reality Check</h3>
      <div class="reality-grid">
        <div class="reality-metric highlight">
          <div class="reality-label">Breakeven Contractor Day Rate</div>
          <div class="reality-big">${fmt(fteComparison.equivalentDayRate)}<span class="unit">/day</span></div>
          <div class="reality-sub">Or ~${fmt(fteComparison.equivalentHourlyRate)}/hr at ${fteComparison.billableDays} days/yr</div>
        </div>
        <div class="reality-metric">
          <div class="reality-label">Annual Contractor Billing Needed</div>
          <div class="reality-big">${fmt(fteComparison.equivalentContractorAnnual)}<span class="unit">/yr</span></div>
          <div class="reality-sub">Before any ${escapeHtml(country.indirectTaxLabel)} or expenses</div>
        </div>
        ${
          hasCompare
            ? `
          <div class="reality-metric ${diff >= 0 ? 'verdict-pos' : 'verdict-neg'}">
            <div class="reality-label">vs ${fmt(fteComparison.compareDayRate)}/day Contract</div>
            <div class="reality-big">${diff >= 0 ? '+' : '−'}${fmt(Math.abs(diff))}<span class="unit">/yr</span></div>
            <div class="reality-sub">${diff >= 0 ? 'That contract rate beats your salary' : 'Your full-time package wins'}</div>
          </div>
        `
            : `
          <div class="reality-metric">
            <div class="reality-label">Target Contractor Rate (+20% buffer)</div>
            <div class="reality-big">${fmt(Math.round(fteComparison.equivalentDayRate * 1.2))}<span class="unit">/day</span></div>
            <div class="reality-sub">Recommended 20% buffer for contract risk</div>
          </div>
        `
        }
      </div>
    </div>
  `;
}

function renderPinnedComparison(state) {
  const pins = state.pinnedScenarios || [];
  if (!pins.length) return '<p class="muted">No saved scenarios yet. Click 📌 Compare to pin scenarios.</p>';

  const baseCode = state.comparisonCurrency || 'USD';
  const baseCountry = Object.values(COUNTRIES).find((c) => c.currency === baseCode) || COUNTRIES.US;

  return `
    <div class="card-title-row">
      <h3 class="mini-section-title" style="margin:0;">Saved Scenarios Side-by-Side</h3>
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

    <div class="table-scroll">
      <table class="freq-table pins-table">
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Take-Home (Local)</th>
            <th>Take-Home (${baseCode})</th>
            <th>Tax Rate</th>
            <th>Total Wealth (${baseCode})</th>
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
  `;
}
