/**
 * Lightweight zero-dependency SVG charts for instant visual clarity.
 */

import { formatCurrency, formatPercent } from '../tax/brackets.js';

/**
 * Renders a crisp multi-segment SVG Donut Chart showing how Gross Pay splits
 * across Net Take-Home, Income Tax, Levies/Social, Retirement, and Expenses.
 */
export function renderDonutChart(calc) {
  const { country } = calc;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);

  const segments = [
    { label: 'Take-Home', value: Math.max(0, calc.netIncome), color: 'var(--chart-net)' },
    { label: 'Income Tax', value: Math.max(0, calc.incomeTax), color: 'var(--chart-tax)' },
    { label: 'Levies / Social', value: Math.max(0, calc.leviesAndSocial + calc.studentLoan), color: 'var(--chart-levy)' },
    { label: country.retirementLabel, value: Math.max(0, calc.employeeRetirement), color: 'var(--chart-retire)' },
    { label: 'Expenses', value: Math.max(0, calc.businessExpenses), color: 'var(--chart-expense)' },
  ].filter((s) => s.value > 0.5);

  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const keepRatio = calc.netIncome / total;

  const size = 188;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const circles = segments
    .map((seg) => {
      const fraction = seg.value / total;
      const dash = fraction * circumference;
      const gap = circumference - dash;
      const el = `<circle
        cx="${size / 2}" cy="${size / 2}" r="${radius}"
        fill="none"
        stroke="${seg.color}"
        stroke-width="${stroke}"
        stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}"
        stroke-linecap="butt"
      ><title>${seg.label}: ${fmt(seg.value)} (${formatPercent(fraction, 1)})</title></circle>`;
      offset += dash;
      return el;
    })
    .join('');

  const legend = segments
    .map((seg) => {
      const pct = formatPercent(seg.value / total, 1);
      return `
        <div class="donut-legend-item">
          <span class="legend-dot" style="background:${seg.color}"></span>
          <span class="legend-label">${seg.label}</span>
          <span class="legend-pct">${pct}</span>
          <span class="legend-val">${fmt(seg.value)}</span>
        </div>
      `;
    })
    .join('');

  return `
    <div class="donut-wrap">
      <div class="donut-svg-box">
        <svg viewBox="0 0 ${size} ${size}" class="donut-svg" role="img" aria-label="Pay breakdown donut chart">
          <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="var(--border-subtle)" stroke-width="${stroke}" />
          <g transform="rotate(-90 ${size / 2} ${size / 2})">
            ${circles}
          </g>
        </svg>
        <div class="donut-center">
          <div class="donut-center-val">${formatPercent(keepRatio, 0)}</div>
          <div class="donut-center-sub">Take-Home</div>
        </div>
      </div>
      <div class="donut-legend">${legend}</div>
    </div>
  `;
}

/**
 * Renders a visual progressive tax bracket waterfall so users can see
 * exactly how much income sits in each bracket (not flat tax!).
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
      const widthPct = Math.max(4, Math.round((b.taxableAmount / maxTaxable) * 100));
      const ratePct = formatPercent(b.rate, b.rate * 100 % 1 !== 0 ? 1 : 0);
      return `
        <div class="bracket-row">
          <div class="bracket-meta">
            <span class="bracket-label">${b.label}</span>
            <span class="bracket-nums">
              <span class="muted">${fmt(b.taxableAmount)} taxed</span>
              <strong>${fmt(b.tax)}</strong>
            </span>
          </div>
          <div class="bracket-track">
            <div class="bracket-fill" style="width:${widthPct}%" data-rate="${ratePct}"></div>
          </div>
        </div>
      `;
    })
    .join('');

  return `<div class="brackets-list">${rows}</div>`;
}
