/**
 * Live Pay Dashboard Renderer:
 * Hero KPI, Pay Period Matrix, Donut + Bracket Charts, Contractor vs FTE Reality Check,
 * Detailed Line-Item Statement, AI Advisor Insights, and Multi-Country Pinned Comparator.
 */

import { COUNTRIES, convertCurrency } from '../tax/countries.js';
import { formatCurrency, formatPercent } from '../tax/brackets.js';
import { renderDonutChart, renderTaxBracketsChart } from './charts.js';
import { generateInsights } from '../ai/insights.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PERIOD_LABELS = {
  annual: 'Yearly',
  monthly: 'Monthly',
  fortnightly: 'Fortnightly',
  weekly: 'Weekly',
  daily: 'Daily',
  hourly: 'Hourly',
};

export function renderResultsDashboard(container, state, calc) {
  const { country, mode, periods, fteComparison } = calc;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);
  const dp = state.displayPeriod || 'monthly';
  const heroNet = periods.net[dp] ?? periods.net.monthly;
  const heroGross = periods.gross[dp] ?? periods.gross.monthly;
  const heroTaxTotal = (periods.tax[dp] ?? 0) + (periods.levies[dp] ?? 0);

  const insights = generateInsights(calc, state);

  container.innerHTML = `
    <!-- Hero Take-Home Summary -->
    <section class="card hero-card">
      <div class="hero-top-row">
        <div>
          <div class="hero-eyebrow">
            <span>${country.flag} ${escapeHtml(country.name)}</span>
            <span class="dot-sep">·</span>
            <span>${mode === 'contractor' ? 'Contractor / Freelance' : 'Full-Time Employee'}</span>
            <span class="dot-sep">·</span>
            <span>${escapeHtml(country.taxYear)}</span>
          </div>
          <div class="hero-net-value">${fmt(heroNet)}<span class="hero-period-unit"> / ${dp === 'annual' ? 'year' : dp === 'monthly' ? 'mo' : dp === 'fortnightly' ? 'fn' : dp === 'weekly' ? 'wk' : dp === 'daily' ? 'day' : 'hr'}</span></div>
          <div class="hero-sub">Estimated Net Take-Home Pay · ${fmt(calc.netIncome)} / year</div>
        </div>
        <div class="hero-actions">
          <button type="button" class="btn-ghost btn-sm" id="pin-scenario-btn" title="Pin scenario for side-by-side comparison">📌 Pin</button>
          <button type="button" class="btn-ghost btn-sm" id="share-link-btn" title="Copy shareable URL">🔗 Share</button>
          <button type="button" class="btn-ghost btn-sm" id="export-csv-btn" title="Download CSV breakdown">⬇ CSV</button>
        </div>
      </div>

      <div class="period-tabs" role="tablist" aria-label="Display frequency">
        ${Object.entries(PERIOD_LABELS)
          .map(
            ([key, label]) => `
          <button type="button" class="period-tab ${dp === key ? 'active' : ''}" data-display-period="${key}">${label}</button>
        `
          )
          .join('')}
      </div>

      <div class="kpi-grid">
        <div class="kpi-tile">
          <div class="kpi-label">Gross (${PERIOD_LABELS[dp]})</div>
          <div class="kpi-val">${fmt(heroGross)}</div>
          <div class="kpi-meta">${fmt(calc.grossIncome)}/yr</div>
        </div>
        <div class="kpi-tile">
          <div class="kpi-label">Tax & Levies</div>
          <div class="kpi-val tax-color">${fmt(heroTaxTotal)}</div>
          <div class="kpi-meta">Eff. ${formatPercent(calc.effectiveTaxRate, 1)} · Marg. ${formatPercent(calc.marginalRate, 1)}</div>
        </div>
        <div class="kpi-tile">
          <div class="kpi-label">${escapeHtml(country.retirementLabel)}</div>
          <div class="kpi-val retire-color">${fmt(periods.retirement[dp])}</div>
          <div class="kpi-meta">${fmt(calc.totalRetirement)}/yr total</div>
        </div>
        <div class="kpi-tile">
          <div class="kpi-label">${mode === 'contractor' && calc.indirectTaxInvoice > 0 ? 'Invoice Total (incl. Tax)' : 'Total Package'}</div>
          <div class="kpi-val">${mode === 'contractor' && calc.indirectTaxInvoice > 0 ? fmt((calc.grossIncome + calc.indirectTaxInvoice) / (dp === 'annual' ? 1 : dp === 'monthly' ? 12 : dp === 'fortnightly' ? 26 : dp === 'weekly' ? 52 : dp === 'daily' ? calc.workingDays : calc.annualHours)) : fmt(periods.totalPackage[dp])}</div>
          <div class="kpi-meta">${mode === 'contractor' && calc.indirectTaxInvoice > 0 ? `+${fmt(calc.indirectTaxInvoice)}/yr ${country.indirectTaxLabel}` : `${fmt(calc.totalPackage)}/yr value`}</div>
        </div>
      </div>
    </section>

    <!-- Contractor vs FTE Reality Check -->
    ${renderFteComparisonCard(calc, fmt)}

    <!-- Visuals Row: Donut + Progressive Brackets -->
    <section class="two-col-cards">
      <div class="card">
        <div class="card-title-row">
          <h2 class="card-title">Where Your Pay Goes</h2>
          <span class="card-badge">Annual Split</span>
        </div>
        ${renderDonutChart(calc)}
      </div>

      <div class="card">
        <div class="card-title-row">
          <h2 class="card-title">Progressive Tax Brackets</h2>
          <span class="card-badge">Marginal ${formatPercent(calc.marginalRate, 1)}</span>
        </div>
        ${renderTaxBracketsChart(calc)}
      </div>
    </section>

    <!-- Smart AI Insights -->
    <section class="card">
      <div class="card-title-row">
        <h2 class="card-title">✨ Smart Pay Insights</h2>
        <span class="card-badge">Live Analysis</span>
      </div>
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
    </section>

    <!-- Detailed Statement & Pay Frequency Matrix -->
    <section class="two-col-cards">
      <div class="card">
        <div class="card-title-row">
          <h2 class="card-title">Detailed Breakdown</h2>
          <span class="card-badge">Annual</span>
        </div>
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

      <div class="card">
        <div class="card-title-row">
          <h2 class="card-title">Pay Frequency Table</h2>
          <span class="card-badge">${calc.workingDays}d / yr</span>
        </div>
        <div class="table-scroll">
          <table class="freq-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Gross</th>
                <th>Tax & Levies</th>
                <th>Take-Home</th>
              </tr>
            </thead>
            <tbody>
              ${['annual', 'monthly', 'fortnightly', 'weekly', 'daily', 'hourly']
                .map(
                  (p) => `
                <tr class="${p === dp ? 'active-row' : ''}">
                  <td>${PERIOD_LABELS[p]}</td>
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
    </section>

    <!-- Pinned Multi-Country Scenario Comparator -->
    ${renderPinnedComparison(state)}
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
      <section class="card reality-card">
        <div class="card-title-row">
          <h2 class="card-title">⚖️ Contractor vs Permanent (FTE) Reality Check</h2>
          <span class="card-badge">${fteComparison.billableDays} billable days/yr</span>
        </div>
        <div class="reality-grid">
          <div class="reality-metric highlight">
            <div class="reality-label">Equivalent FTE Base Salary</div>
            <div class="reality-big">${fmt(fteComparison.equivalentFteBase)}</div>
            <div class="reality-sub">+ ${country.retirementLabel} (${fmt(fteComparison.equivalentFtePackage)} total package)</div>
          </div>
          <div class="reality-metric">
            <div class="reality-label">Monthly Tax Vault Set-Aside</div>
            <div class="reality-big">${fmt(calc.taxVaultAnnual / 12)}<span class="unit">/mo</span></div>
            <div class="reality-sub">${calc.indirectTaxInvoice > 0 ? `Includes ${country.indirectTaxLabel} + Income Tax` : 'Income Tax & Social/SE Levies'}</div>
          </div>
          ${
            hasCompare
              ? `
            <div class="reality-metric ${isAhead ? 'verdict-pos' : 'verdict-neg'}">
              <div class="reality-label">vs ${fmt(fteComparison.compareSalary)} FTE Offer</div>
              <div class="reality-big">${isAhead ? '+' : '−'}${fmt(Math.abs(diff))}<span class="unit">/yr</span></div>
              <div class="reality-sub">${isAhead ? 'Contracting ahead' : 'Permanent FTE ahead'} (Net + ${country.retirementLabel})</div>
            </div>
          `
              : `
            <div class="reality-metric">
              <div class="reality-label">Unpaid Leave Buffer</div>
              <div class="reality-big">${260 - fteComparison.billableDays} <span class="unit">days</span></div>
              <div class="reality-sub">${escapeHtml(fteComparison.unpaidLeaveValueNote)}</div>
            </div>
          `
          }
        </div>
      </section>
    `;
  }

  // Employee mode: show equivalent contractor day rate!
  const hasCompare = Boolean(fteComparison.compareRes);
  const diff = fteComparison.wealthDeltaVsCompare || 0;
  return `
    <section class="card reality-card">
      <div class="card-title-row">
        <h2 class="card-title">⚖️ Equivalent Contractor Rate</h2>
        <span class="card-badge">At ${fteComparison.billableDays} billable days/yr</span>
      </div>
      <div class="reality-grid">
        <div class="reality-metric highlight">
          <div class="reality-label">Breakeven Contractor Day Rate</div>
          <div class="reality-big">${fmt(fteComparison.equivalentDayRate)}<span class="unit">/day</span></div>
          <div class="reality-sub">Or ~${fmt(fteComparison.equivalentHourlyRate)}/hr to match net + ${country.retirementLabel}</div>
        </div>
        <div class="reality-metric">
          <div class="reality-label">Implied Annual Billing</div>
          <div class="reality-big">${fmt(fteComparison.equivalentContractorAnnual)}</div>
          <div class="reality-sub">Excl. ${country.indirectTaxLabel} & business expenses</div>
        </div>
        ${
          hasCompare
            ? `
          <div class="reality-metric ${diff >= 0 ? 'verdict-pos' : 'verdict-neg'}">
            <div class="reality-label">vs ${fmt(fteComparison.compareDayRate)}/day Contract</div>
            <div class="reality-big">${diff >= 0 ? '+' : '−'}${fmt(Math.abs(diff))}<span class="unit">/yr</span></div>
            <div class="reality-sub">${diff >= 0 ? 'Contract rate wins' : 'Your FTE package wins'}</div>
          </div>
        `
            : `
          <div class="reality-metric">
            <div class="reality-label">Quick Tip</div>
            <div class="reality-sub" style="margin-top:6px;">Ask in the AI bar: <em>“compare with ${fmt(Math.round(fteComparison.equivalentDayRate * 1.15))}/day contractor”</em> to test an offer.</div>
          </div>
        `
        }
      </div>
    </section>
  `;
}

function renderPinnedComparison(state) {
  const pins = state.pinnedScenarios || [];
  if (!pins.length) return '';

  const baseCode = state.comparisonCurrency || 'USD';
  const baseCountry = Object.values(COUNTRIES).find((c) => c.currency === baseCode) || COUNTRIES.US;

  return `
    <section class="card">
      <div class="card-title-row">
        <h2 class="card-title">📌 Pinned Scenarios (Multi-Country Comparison)</h2>
        <div class="pin-controls">
          <label class="sub-label" for="compare-currency-select">Normalize to:</label>
          <select id="compare-currency-select" class="mini-select">
            ${Object.values(COUNTRIES)
              .map((c) => `<option value="${c.currency}" ${c.currency === baseCode ? 'selected' : ''}>${c.flag} ${c.currency}</option>`)
              .join('')}
          </select>
          <button type="button" class="btn-ghost btn-xs" id="clear-pins-btn">Clear</button>
        </div>
      </div>
      <div class="table-scroll">
        <table class="freq-table pins-table">
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Local Net / Yr</th>
              <th>Net / Yr (${baseCode} est.)</th>
              <th>Eff. Tax</th>
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
                      <div class="pin-meta">${p.mode === 'contractor' ? 'Contractor' : 'FTE'} · ${escapeHtml(p.subtitle)}</div>
                    </td>
                    <td><strong>${localNet}</strong></td>
                    <td class="net-col">${formatCurrency(normNet, baseCountry.currency, baseCountry.locale)}</td>
                    <td>${formatPercent(p.effectiveTaxRate, 1)}</td>
                    <td>${formatCurrency(normWealth, baseCountry.currency, baseCountry.locale)}</td>
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
      <div class="form-footnote mt-sm">FX conversion uses offline reference rates for quick $0 side-by-side comparison.</div>
    </section>
  `;
}
