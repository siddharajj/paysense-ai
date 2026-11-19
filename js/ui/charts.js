/**
 * Warm, easy-to-read visual components for everyday confidence:
 * 1) Horizontal Money Split Bar (clearer than a complex donut!)
 * 2) Donut Chart (available if needed)
 * 3) Progressive Tax Bracket Visualizer with plain-English explanation.
 */

import { formatCurrency, formatPercent } from '../tax/brackets.js';

/**
 * Renders a single, crystal-clear horizontal Money Split Bar + legend tiles
 * so anyone can see at a glance where every dollar goes.
 */
export function renderMoneySplitBar(calc) {
  const { country } = calc;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);

  const segments = [
    { key: 'net', label: 'Yours to Keep (Take-Home)', value: Math.max(0, calc.netIncome), color: 'var(--chart-net)' },
    { key: 'tax', label: 'Income Tax', value: Math.max(0, calc.incomeTax), color: 'var(--chart-tax)' },
    { key: 'levy', label: 'Social / Medicare / Levies', value: Math.max(0, calc.leviesAndSocial + calc.studentLoan), color: 'var(--chart-levy)' },
    { key: 'retire', label: `Your ${country.retirementLabel}`, value: Math.max(0, calc.employeeRetirement), color: 'var(--chart-retire)' },
    { key: 'expense', label: 'Business Expenses', value: Math.max(0, calc.businessExpenses), color: 'var(--chart-expense)' },
  ].filter((s) => s.value > 0.5);

  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;

  const barSegments = segments
    .map((s) => {
      const pct = Math.max(1.5, (s.value / total) * 100);
      return `<div class="split-segment seg-${s.key}" style="width:${pct.toFixed(2)}%; background:${s.color}" title="${s.label}: ${fmt(s.value)} (${formatPercent(s.value / total, 1)})"></div>`;
    })
    .join('');

  const legendCards = segments
    .map((s) => {
      const pct = formatPercent(s.value / total, 0);
      return `
        <div class="split-legend-card">
          <div class="split-legend-top">
            <span class="legend-dot" style="background:${s.color}"></span>
            <span class="split-legend-name">${s.label}</span>
          </div>
          <div class="split-legend-bottom">
            <strong class="split-legend-val">${fmt(s.value)}<span class="unit">/yr</span></strong>
            <span class="split-legend-pct">${pct}</span>
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <div class="money-split-wrap">
      <div class="money-split-label-row">
        <span>How your annual pay is divided</span>
        <span class="muted">Keep <strong>${formatPercent(calc.netIncome / total, 0)}</strong> of gross</span>
      </div>
      <div class="money-split-bar" role="img" aria-label="Horizontal breakdown of gross pay">
        ${barSegments}
      </div>
      <div class="split-legend-grid">
        ${legendCards}
      </div>
    </div>
  `;
}

export function renderDonutChart(calc) {
  return renderMoneySplitBar(calc);
}

/**
 * Renders a visual progressive tax bracket waterfall with reassuring explanation.
 */
export function renderTaxBracketsChart(calc) {
  const { country, brackets } = calc;
  if (!brackets || !brackets.length) return '';

  const fmt = (n) => formatCurrency(n, country.currency, country.locale);
  const activeBrackets = brackets.filter((b) => b.taxableAmount > 0);
  const displayBrackets = activeBrackets.length ? activeBrackets : brackets.slice(0, 3);
  const maxTaxable = Math.max(...displayBrackets.map((b) => b.taxableAmount), 1);

  const rows = displayBrackets
    .map((b) => {
      const widthPct = Math.max(5, Math.round((b.taxableAmount / maxTaxable) * 100));
      const ratePct = formatPercent(b.rate, b.rate * 100 % 1 !== 0 ? 1 : 0);
      return `
        <div class="bracket-row">
          <div class="bracket-meta">
            <span class="bracket-label">${b.label}</span>
            <span class="bracket-nums">
              <span class="muted">${fmt(b.taxableAmount)} in this slice</span>
              <strong>Tax: ${fmt(b.tax)}</strong>
            </span>
          </div>
          <div class="bracket-track">
            <div class="bracket-fill" style="width:${widthPct}%" data-rate="${ratePct}"></div>
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <p class="reassure-note">
      <strong>How tax brackets work:</strong> Moving into a higher tax bracket never taxes your whole income at that rate — only the slice of dollars inside each bracket is taxed at that bracket’s percentage.
    </p>
    <div class="brackets-list">${rows}</div>
  `;
}
