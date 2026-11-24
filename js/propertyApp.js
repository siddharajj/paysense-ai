/**
 * PaySense — Rental Property, Negative Gearing, DIY Depreciation Schedule &
 * 10-Year Capital Gains Forecaster (property.html)
 * Uses Global Country Header + Compact Split Stage + Pop-Up Schedule Modals.
 */

import { COUNTRIES } from './tax/countries.js';
import { formatCurrency, formatPercent } from './tax/brackets.js';
import { defaultPropertyState, calculatePropertyImpact } from './tax/propertyEngine.js';
import {
  initGlobalHeader,
  getGlobalCountry,
  setGlobalCountry,
  openPopupModal,
} from './ui/globalHeader.js';

const EXAMPLE_PROMPTS = [
  {
    label: '🇦🇺 $145k salary · $780k unit (neg. geared)',
    prompt: 'Australia $145k salary buying a $780k apartment built in 2021, $624k loan at 6.2%, $680/wk rent',
  },
  {
    label: '🇦🇺 $180k salary · Brand-new $920k townhouse',
    prompt: 'AU $180k salary buying a brand new $920k house built in 2026, $736k loan at 6.1%, $780/wk rent',
  },
  {
    label: '🇺🇸 $155k salary · $520k rental (27.5yr MACRS)',
    prompt: 'US $155k salary buying a $520k rental house, $416k loan at 6.5%, $3100/mo rent',
  },
  {
    label: '🇬🇧 £85k salary · £360k Buy-to-Let (Sec 24)',
    prompt: 'UK £85k salary with a £360k buy-to-let, £270k loan at 5.2%, £1750/mo rent',
  },
];

let propState = {
  ...defaultPropertyState(getGlobalCountry()),
  stageView: 'impact', // 'impact' | 'depreciation' | 'forecast'
  lastParsed: null,
};

let currentImpact = calculatePropertyImpact(propState);

const els = {
  formRoot: document.getElementById('prop-form-root'),
  resultsRoot: document.getElementById('prop-results-root'),
  aiForm: document.getElementById('prop-ai-form'),
  aiInput: document.getElementById('prop-ai-input'),
  aiChips: document.getElementById('prop-example-chips'),
  aiFeedback: document.getElementById('prop-ai-feedback'),
  toast: document.getElementById('toast'),
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.classList.add('visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove('visible'), 2600);
}

function parseMoney(numStr, suf = '') {
  const n = Number(String(numStr).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const s = (suf || '').toLowerCase();
  if (s === 'k') return n * 1_000;
  if (s === 'm') return n * 1_000_000;
  if (s === 'l' || s === 'lakh' || s === 'lakhs' || s === 'lpa') return n * 100_000;
  if (s === 'cr' || s === 'crore') return n * 10_000_000;
  return n;
}

function switchCountry(newCode) {
  if (!COUNTRIES[newCode] || newCode === propState.country) return;
  setGlobalCountry(newCode);
  propState = {
    ...defaultPropertyState(newCode),
    stageView: propState.stageView,
  };
  renderAll();
}

function parsePropertyPrompt(rawText) {
  const text = (rawText || '').trim();
  if (!text) return;

  const tags = [];
  let newCountry = propState.country;

  const countryPatterns = [
    ['AU', /\b(australia|au|aud|sydney|melbourne|brisbane|perth|ato)\b/i],
    ['US', /\b(united states|usa|us|usd|california|texas|new york|irs|macrs)\b/i],
    ['UK', /\b(uk|united kingdom|gbp|britain|london|buy[- ]?to[- ]?let|btl|£)\b/i],
    ['CA', /\b(canada|ca|cad|toronto|vancouver|ontario|cca)\b/i],
    ['IN', /\b(india|in|inr|₹|lakh|lpa|cr|crore|mumbai|bengaluru)\b/i],
    ['NZ', /\b(new zealand|nz|nzd|auckland|bright[- ]?line)\b/i],
    ['SG', /\b(singapore|sg|sgd|s\$|iras)\b/i],
  ];

  for (const [code, re] of countryPatterns) {
    if (re.test(text)) {
      newCountry = code;
      break;
    }
  }

  if (newCountry !== propState.country) {
    setGlobalCountry(newCountry);
    propState = {
      ...defaultPropertyState(newCountry),
      stageView: propState.stageView,
    };
  }
  const c = COUNTRIES[propState.country];
  const fmt = (n) => formatCurrency(n, c.currency, c.locale);
  tags.push(`${c.flag} ${c.name}`);

  if (/\b(brand[- ]?new|new build|off[- ]?the[- ]?plan)\b/i.test(text)) {
    propState.isBrandNewBuild = true;
    tags.push('Brand-New Build');
  } else if (/\b(established|second[- ]?hand)\b/i.test(text)) {
    propState.isBrandNewBuild = false;
    tags.push('Established Property');
  }

  const yrMatch = text.match(/built\s+in\s+(19\d\d|20\d\d)/i);
  if (yrMatch) {
    propState.buildYear = Number(yrMatch[1]);
    tags.push(`Built ${propState.buildYear}`);
  }

  const rateMatch = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:interest|rate|loan|mortgage)?|(?:at|@)\s*(\d+(?:\.\d+)?)\s*%/i);
  if (rateMatch) {
    const r = Number(rateMatch[1] || rateMatch[2]);
    if (r > 0 && r < 25) {
      propState.interestRatePct = r;
      tags.push(`${r}% Interest`);
    }
  }

  const salMatch = text.match(/(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lakh|lpa|cr)?\s*(?:salary|income|pay|wage)|(?:salary|earning|income)\s*(?:of\s*)?(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lakh|lpa|cr)?/i);
  if (salMatch) {
    const val = parseMoney(salMatch[1] || salMatch[3], salMatch[2] || salMatch[4]);
    if (val && val > 0) {
      propState.salary = val;
      tags.push(`Salary: ${fmt(val)}`);
    }
  }

  const propMatch = text.match(/(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lakh|cr|crore)?\s*(?:new\s+)?(?:apartment|unit|house|townhouse|property|flat|condo|buy[- ]?to[- ]?let|rental)/i);
  if (propMatch) {
    const val = parseMoney(propMatch[1], propMatch[2]);
    if (val && val > 20000) {
      propState.propertyValue = val;
      propState.buildingStructureCost = Math.round(val * 0.42);
      propState.loanAmount = Math.round(val * 0.8);
      tags.push(`Property: ${fmt(val)}`);
    }
  }

  const loanMatch = text.match(/(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lakh|cr|crore)?\s*(?:loan|mortgage)/i);
  if (loanMatch) {
    const val = parseMoney(loanMatch[1], loanMatch[2]);
    if (val && val > 10000) {
      propState.loanAmount = val;
      tags.push(`Loan: ${fmt(val)}`);
    }
  }

  const rentMatch = text.match(/(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:\/\s*|per\s+)(wk|week|weekly|mo|month|monthly)\s*(?:rent)?/i);
  if (rentMatch) {
    const val = parseMoney(rentMatch[1], rentMatch[2]);
    const unit = rentMatch[3].toLowerCase();
    if (val && val > 0) {
      propState.weeklyRent = unit.startsWith('m') ? Math.round((val * 12) / 52) : Math.round(val);
      tags.push(`Rent: ${fmt(propState.weeklyRent)}/wk`);
    }
  }

  currentImpact = calculatePropertyImpact(propState);
  const yr1 = currentImpact.year1;
  propState.lastParsed = {
    tags,
    summary: `Updated ${c.name} property model: ${yr1.gearingStatus} with ${fmt(currentImpact.depSchedule.year1Total)}/yr depreciation and a ${yr1.taxSavedOrPaid >= 0 ? `${fmt(yr1.taxSavedOrPaid)}/yr tax refund` : `${fmt(Math.abs(yr1.taxSavedOrPaid))}/yr tax bill`}.`,
  };

  renderAll();
}

function renderExampleChips() {
  els.aiChips.innerHTML = EXAMPLE_PROMPTS.map(
    (ex, idx) => `<button type="button" class="prompt-chip" data-example-idx="${idx}">${escapeHtml(ex.label)}</button>`
  ).join('');
}

function renderAiFeedback() {
  if (!propState.lastParsed) {
    els.aiFeedback.hidden = true;
    els.aiFeedback.innerHTML = '';
    return;
  }
  const { tags, summary } = propState.lastParsed;
  els.aiFeedback.hidden = false;
  els.aiFeedback.innerHTML = `
    <div class="ai-feedback-inner animate-stage">
      <div class="ai-feedback-top">
        <span class="ai-source-badge">Updated Property Scenario</span>
        <div class="parsed-tags-wrap">
          ${tags.map((t) => `<span class="parsed-tag">${escapeHtml(t)}</span>`).join('')}
        </div>
        <button type="button" class="icon-btn" id="dismiss-prop-feedback" title="Dismiss">✕</button>
      </div>
      <div class="ai-reply-text">${escapeHtml(summary)}</div>
    </div>
  `;
}

function renderAll() {
  currentImpact = calculatePropertyImpact(propState);
  renderPropertyForm();
  renderPropertyResults();
  renderAiFeedback();
}

function renderResultsOnly() {
  currentImpact = calculatePropertyImpact(propState);
  renderPropertyResults();
}

function renderPropertyForm() {
  const c = COUNTRIES[propState.country] || COUNTRIES.AU;

  els.formRoot.innerHTML = `
    <div class="card compact-form-card">
      <div class="compact-form-header">
        <span class="section-num">01</span>
        <div>
          <h2 class="compact-form-title">Property &amp; Pay Setup</h2>
          <div class="muted" style="font-size:0.78rem;" id="global-tax-year-badge">${c.flag} ${escapeHtml(c.name)} · ${escapeHtml(c.taxYear)}</div>
        </div>
      </div>

      <div class="setup-block">
        <label class="sub-label" for="prop-salary-input">Your Annual Gross Salary</label>
        <div class="input-combo compact">
          <span class="input-prefix">${escapeHtml(c.symbol)}</span>
          <input type="number" id="prop-salary-input" class="num-input" min="0" step="2000" value="${propState.salary}" />
          <span class="input-suffix">/ yr</span>
        </div>
      </div>

      <div class="setup-block">
        <label class="sub-label" for="prop-value-input">Property Value / Purchase Price</label>
        <div class="input-combo compact">
          <span class="input-prefix">${escapeHtml(c.symbol)}</span>
          <input type="number" id="prop-value-input" class="num-input" min="0" step="10000" value="${propState.propertyValue}" />
        </div>
      </div>

      <div class="two-col-fields">
        <div class="sub-field">
          <label class="sub-label" for="prop-loan-input">Loan (${currentImpact.summaryMetrics.lvrPct.toFixed(0)}% LVR)</label>
          <div class="input-combo compact">
            <span class="input-prefix">${escapeHtml(c.symbol)}</span>
            <input type="number" id="prop-loan-input" class="num-input" min="0" step="10000" value="${propState.loanAmount}" />
          </div>
        </div>
        <div class="sub-field">
          <label class="sub-label" for="prop-rate-input">Interest Rate (%)</label>
          <input type="number" id="prop-rate-input" class="text-input" min="0" max="20" step="0.1" value="${propState.interestRatePct}" />
        </div>
      </div>

      <div class="two-col-fields">
        <div class="sub-field">
          <label class="sub-label" for="prop-rent-input">Weekly Rent</label>
          <div class="input-combo compact">
            <span class="input-prefix">${escapeHtml(c.symbol)}</span>
            <input type="number" id="prop-rent-input" class="num-input" min="0" step="20" value="${propState.weeklyRent}" />
          </div>
        </div>
        <div class="sub-field">
          <label class="sub-label" for="prop-expenses-input">Running Costs / Yr</label>
          <div class="input-combo compact">
            <span class="input-prefix">${escapeHtml(c.symbol)}</span>
            <input type="number" id="prop-expenses-input" class="num-input" min="0" step="500" value="${propState.annualExpenses}" />
          </div>
        </div>
      </div>

      <div class="setup-block">
        <label class="sub-label" for="prop-build-type">Property Build Type</label>
        <select id="prop-build-type" class="select-input">
          <option value="established" ${!propState.isBrandNewBuild ? 'selected' : ''}>Established / Second-Hand (${propState.buildYear})</option>
          <option value="new" ${propState.isBrandNewBuild ? 'selected' : ''}>Brand-New Build (${propState.buildYear})</option>
        </select>
      </div>

      <button type="button" class="btn-ghost btn-sm full-width-btn" id="open-prop-settings-popup">
        ⚙️ Fine-Tune Building &amp; 10-Yr Growth
      </button>
    </div>
  `;
}

function renderPropertyResults() {
  const { country, year1, withoutPropertyCalc, depSchedule, exitCgt } = currentImpact;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);
  const stageView = propState.stageView || 'impact';

  const isRefund = year1.taxSavedOrPaid >= 0;
  const isPositiveAfterTax = year1.afterTaxPropertyCashflow >= 0;

  els.resultsRoot.innerHTML = `
    <div class="stage-nav-bar">
      <div class="stage-tabs" role="tablist">
        <button type="button" class="stage-tab ${stageView === 'impact' ? 'active' : ''}" data-stage-view="impact">
          02 · Year-1 Pay &amp; Tax Impact
        </button>
        <button type="button" class="stage-tab ${stageView === 'depreciation' ? 'active' : ''}" data-stage-view="depreciation">
          03 · Depreciation Schedule
        </button>
        <button type="button" class="stage-tab ${stageView === 'forecast' ? 'active' : ''}" data-stage-view="forecast">
          04 · ${exitCgt.holdingYears}-Yr Forecast &amp; CGT
        </button>
      </div>
      <span class="comp-pill ${isRefund ? 'comp-low' : 'comp-mod'}">${escapeHtml(year1.gearingStatus)}</span>
    </div>

    <div class="card stage-card animate-stage">
      ${stageView === 'impact' ? renderImpactStage(year1, withoutPropertyCalc, fmt, isRefund, isPositiveAfterTax) : ''}
      ${stageView === 'depreciation' ? renderDepreciationStage(country, year1, depSchedule, withoutPropertyCalc, fmt) : ''}
      ${stageView === 'forecast' ? renderForecastStage(country, exitCgt, fmt) : ''}
    </div>
  `;
}

function renderImpactStage(year1, withoutPropertyCalc, fmt, isRefund, isPositiveAfterTax) {
  const oldTaxTotal =
    withoutPropertyCalc.incomeTax + withoutPropertyCalc.leviesAndSocial + withoutPropertyCalc.studentLoan;

  return `
    <div class="take-home-spotlight" style="padding-top:0;">
      <div class="spotlight-label">
        ${isPositiveAfterTax ? 'Net Extra Cashflow in Your Pocket (After Tax)' : 'Real Out-of-Pocket Holding Cost (After Tax Refund)'}
      </div>
      <div class="hero-net-value ${isPositiveAfterTax ? 'net-col' : ''}">
        ${isPositiveAfterTax ? '+' : '−'}${fmt(Math.abs(year1.weeklyAfterTaxImpact))} <span class="hero-period-unit">per week</span>
        <span class="hero-period-unit">(${isPositiveAfterTax ? '+' : '−'}${fmt(Math.abs(year1.monthlyAfterTaxImpact))}/month)</span>
      </div>
      <p class="plain-english-summary">
        Before tax, rent (${fmt(currentImpact.annualRent)}/yr) minus interest (${fmt(currentImpact.annualInterest)}/yr) and running costs (${fmt(currentImpact.annualExpenses)}/yr) leaves <strong>${year1.preTaxCashflow >= 0 ? '+' : '−'}${fmt(Math.abs(year1.preTaxCashflow))}/yr</strong>.
        Adding <strong>${fmt(year1.claimedTotalDep)}/yr</strong> in paper depreciation creates a <strong>${isRefund ? `${fmt(year1.taxSavedOrPaid)}/yr tax refund` : `${fmt(Math.abs(year1.taxSavedOrPaid))}/yr tax bill`}</strong>.
      </p>
    </div>

    <div class="pay-comparison-boxes" style="margin-top:6px;">
      <div class="pay-mode-box">
        <div class="pay-mode-tag">Your Pay Without Property</div>
        <div class="pay-mode-main">${fmt(withoutPropertyCalc.netIncome)} <span class="unit">/ yr net</span></div>
        <div class="pay-mode-takehome">Monthly take-home: <strong>${fmt(withoutPropertyCalc.netIncome / 12)}/mo</strong></div>
        <div class="pay-mode-range">Tax &amp; Levies Paid: <strong>${fmt(oldTaxTotal)}/yr</strong> (${formatPercent(withoutPropertyCalc.marginalRate, 1)} marginal)</div>
      </div>

      <div class="pay-mode-box contractor-box">
        <div class="pay-mode-tag">Combined Cashflow With Property</div>
        <div class="pay-mode-main">${fmt(year1.combinedTakeHomeWithProperty)} <span class="unit">/ yr net</span></div>
        <div class="pay-mode-takehome">
          New Tax Bill: <strong>${fmt(year1.newTotalTaxAndLevies)}/yr</strong>
          (${isRefund ? `Saves ${fmt(year1.taxSavedOrPaid)}` : `+${fmt(Math.abs(year1.taxSavedOrPaid))} tax`})
        </div>
        <div class="pay-mode-range">
          Net Property Impact: <strong>${year1.afterTaxPropertyCashflow >= 0 ? '+' : '−'}${fmt(Math.abs(year1.afterTaxPropertyCashflow))}/yr</strong>
        </div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-tile">
        <div class="kpi-label">1. Pre-Tax Cashflow</div>
        <div class="kpi-val ${year1.preTaxCashflow < 0 ? 'tax-color' : 'net-col'}">${year1.preTaxCashflow >= 0 ? '+' : '−'}${fmt(Math.abs(year1.preTaxCashflow))}</div>
        <div class="kpi-meta">${year1.preTaxCashflow >= 0 ? '+' : '−'}${fmt(Math.abs(year1.preTaxCashflow / 52))}/wk</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">2. Non-Cash Depreciation</div>
        <div class="kpi-val retire-color">${fmt(year1.claimedTotalDep)}</div>
        <div class="kpi-meta">Paper deduction ($0 cash)</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">3. ${isRefund ? 'Tax Refund / Saved' : 'Extra Tax Owed'}</div>
        <div class="kpi-val ${isRefund ? 'net-col' : 'tax-color'}">${isRefund ? '+' : '−'}${fmt(Math.abs(year1.taxSavedOrPaid))}</div>
        <div class="kpi-meta">${isRefund ? '+' : '−'}${fmt(Math.abs(year1.taxSavedOrPaid / 52))}/wk tax effect</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">4. After-Tax Cashflow</div>
        <div class="kpi-val ${isPositiveAfterTax ? 'net-col' : ''}">${isPositiveAfterTax ? '+' : '−'}${fmt(Math.abs(year1.afterTaxPropertyCashflow))}</div>
        <div class="kpi-meta">${isPositiveAfterTax ? '+' : '−'}${fmt(Math.abs(year1.weeklyAfterTaxImpact))}/wk net</div>
      </div>
    </div>

    <div class="driver-note" style="margin-top:16px;">
      <strong>${escapeHtml(year1.lawTitle)}:</strong> ${escapeHtml(year1.lawExplanation)}
    </div>
  `;
}

function renderDepreciationStage(country, year1, depSchedule, withoutPropertyCalc, fmt) {
  return `
    <div class="dep-controls-bar">
      <div>
        <h3 class="mini-section-title" style="margin:0;">Free DIY Property Depreciation Schedule</h3>
        <div class="muted" style="font-size:0.84rem;">Year-1 Claim: <strong>${fmt(depSchedule.year1Total)}</strong> · 10-Yr Total: <strong>${fmt(depSchedule.tenYearTotal)}</strong></div>
      </div>
      <div class="segmented-control" style="min-width:270px;">
        <button type="button" class="seg-btn ${depSchedule.method === 'diminishing' ? 'active' : ''}" data-dep-method="diminishing">
          Diminishing Value (200%)
        </button>
        <button type="button" class="seg-btn ${depSchedule.method === 'prime' ? 'active' : ''}" data-dep-method="prime">
          Prime Cost (100%)
        </button>
      </div>
    </div>

    <p class="reassure-note" style="margin-top:14px;">
      <strong>${escapeHtml(country.name)} Rule:</strong> ${escapeHtml(depSchedule.plantRuleNote)}
    </p>

    <div class="table-scroll">
      <table class="freq-table">
        <thead>
          <tr>
            <th>Itemized Asset Class</th>
            <th>Effective Life</th>
            <th>Rate (${depSchedule.method === 'diminishing' ? 'DV' : 'Prime'})</th>
            <th>Opening Value</th>
            <th>Year-1 Deduction</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>${escapeHtml(depSchedule.structureLabel)}</strong></td>
            <td>${depSchedule.structureRemainingYears > 0 ? `${depSchedule.structureRemainingYears} yrs left` : '—'}</td>
            <td>${(depSchedule.structureRate * 100).toFixed(2).replace(/\.00$/, '')}%</td>
            <td>${fmt(propState.buildingStructureCost)}</td>
            <td class="retire-color"><strong>${fmt(depSchedule.years[0]?.structureDeduction || 0)}</strong></td>
          </tr>
          ${depSchedule.year1Itemized
            .map(
              (item) => `
            <tr>
              <td>${escapeHtml(item.name)}</td>
              <td>${item.effectiveLifeYrs} yrs</td>
              <td>${((depSchedule.method === 'diminishing' ? item.dvRate : item.pcRate) * 100).toFixed(1)}%</td>
              <td>${fmt(item.openingValue)}</td>
              <td class="retire-color"><strong>${fmt(item.year1Deduction)}</strong></td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>

    <div class="popup-action-bar">
      <button type="button" class="btn-primary btn-sm" id="open-10yr-dep-popup">
        📋 Open Full 10-Year Schedule in Pop-Up
      </button>
      <button type="button" class="btn-ghost btn-sm" id="export-dep-csv-btn">⬇ Download CSV</button>
      <button type="button" class="btn-ghost btn-sm" id="print-dep-btn">🖨 Print Schedule</button>
    </div>
  `;
}

function renderForecastStage(country, exitCgt, fmt) {
  return `
    <h3 class="mini-section-title" style="margin-top:0;">${exitCgt.holdingYears}-Year Capital Growth &amp; Capital Gains Tax (CGT) on Exit</h3>
    <div class="reality-grid">
      <div class="reality-metric highlight">
        <div class="reality-label">Projected Sale Price (Year ${exitCgt.holdingYears})</div>
        <div class="reality-big">${fmt(exitCgt.salePrice)}</div>
        <div class="reality-sub">Up from ${fmt(propState.propertyValue)} (+${fmt(exitCgt.salePrice - propState.propertyValue)} gross gain at ${propState.capitalGrowthPct}%/yr)</div>
      </div>

      <div class="reality-metric">
        <div class="reality-label">Est. Capital Gains &amp; Recapture Tax</div>
        <div class="reality-big tax-color">−${fmt(exitCgt.estimatedCgtAndRecaptureTax)}</div>
        <div class="reality-sub">
          ${
            exitCgt.costBaseAdjustmentOrRecapture > 0
              ? `Includes ${fmt(exitCgt.costBaseAdjustmentOrRecapture)} depreciation cost-base / recapture adjustment`
              : 'Based on local Capital Gains Tax rules'
          }
        </div>
      </div>

      <div class="reality-metric ${exitCgt.totalNetWealthCreated >= 0 ? 'verdict-pos' : 'verdict-neg'}">
        <div class="reality-label">Total Net Profit (After CGT &amp; Holding Cashflow)</div>
        <div class="reality-big">${exitCgt.totalNetWealthCreated >= 0 ? '+' : '−'}${fmt(Math.abs(exitCgt.totalNetWealthCreated))}</div>
        <div class="reality-sub">Walk-away profit after paying off loan, CGT, buying/selling costs &amp; ${exitCgt.holdingYears} yrs net cashflow</div>
      </div>
    </div>

    <div class="driver-note" style="margin-top:16px;">
      <strong>${escapeHtml(country.name)} Exit CGT Rule:</strong> ${escapeHtml(exitCgt.cgtRuleNote)}
    </div>

    <div class="popup-action-bar">
      <button type="button" class="btn-primary btn-sm" id="open-10yr-forecast-popup">
        📈 Open Year-by-Year ${exitCgt.holdingYears}-Year Cashflow &amp; Equity Table (Pop-Up)
      </button>
    </div>
  `;
}

function openPropertySettingsPopup() {
  const c = COUNTRIES[propState.country];
  const modal = openPopupModal({
    title: 'Building Depreciation & 10-Year Growth Settings',
    subtitle: 'Fine-tune construction cost, fixtures value, and capital growth assumptions.',
    wide: false,
    bodyHtml: `
      <div id="prop-modal-controls" class="modal-form">
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="prop-buildyear-input">Year Property Built</label>
            <input type="number" id="prop-buildyear-input" class="text-input" min="1950" max="2026" step="1" value="${propState.buildYear}" />
          </div>
          <div class="sub-field">
            <label class="sub-label" for="prop-struct-input">Building Construction Cost (${escapeHtml(c.symbol)})</label>
            <input type="number" id="prop-struct-input" class="text-input" min="0" step="10000" value="${propState.buildingStructureCost}" />
          </div>
        </div>
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="prop-plant-input">
              ${propState.country === 'AU' && !propState.isBrandNewBuild ? 'Brand-New Upgrades Installed' : 'Fixtures / Plant Value'} (${escapeHtml(c.symbol)})
            </label>
            <input type="number" id="prop-plant-input" class="text-input" min="0" step="1000" value="${propState.country === 'AU' && !propState.isBrandNewBuild ? propState.newUpgradesInstalled : propState.plantAndEquipmentValue}" />
          </div>
          <div class="sub-field">
            <label class="sub-label" for="prop-holdyears-input">Holding Period (Years)</label>
            <input type="number" id="prop-holdyears-input" class="text-input" min="1" max="25" step="1" value="${propState.holdingYears}" />
          </div>
        </div>
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="prop-capgrowth-input">Annual Capital Growth (%)</label>
            <input type="number" id="prop-capgrowth-input" class="text-input" min="-5" max="20" step="0.5" value="${propState.capitalGrowthPct}" />
          </div>
          <div class="sub-field">
            <label class="sub-label" for="prop-rentgrowth-input">Annual Rent Growth (%)</label>
            <input type="number" id="prop-rentgrowth-input" class="text-input" min="-5" max="15" step="0.5" value="${propState.rentGrowthPct}" />
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-primary" data-close-popup>Done</button>
        </div>
      </div>
    `,
  });

  modal.querySelector('#prop-modal-controls')?.addEventListener('input', (e) => {
    const t = e.target;
    const val = Math.max(0, Number(t.value) || 0);
    if (t.id === 'prop-buildyear-input') propState.buildYear = val || 2020;
    else if (t.id === 'prop-struct-input') propState.buildingStructureCost = val;
    else if (t.id === 'prop-plant-input') {
      if (propState.country === 'AU' && !propState.isBrandNewBuild) propState.newUpgradesInstalled = val;
      else propState.plantAndEquipmentValue = val;
    } else if (t.id === 'prop-holdyears-input') propState.holdingYears = Math.max(1, val || 10);
    else if (t.id === 'prop-capgrowth-input') propState.capitalGrowthPct = Number(t.value) || 0;
    else if (t.id === 'prop-rentgrowth-input') propState.rentGrowthPct = Number(t.value) || 0;
    renderAll();
  });
}

function open10YrDepreciationPopup() {
  const { country, depSchedule, withoutPropertyCalc } = currentImpact;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);
  openPopupModal({
    title: `10-Year Property Depreciation Schedule (${country.name})`,
    subtitle: `Method: ${depSchedule.method === 'diminishing' ? 'Diminishing Value (200%)' : 'Prime Cost (100% Straight-Line)'} · 10-Yr Total: ${fmt(depSchedule.tenYearTotal)}`,
    bodyHtml: `
      <div class="table-scroll">
        <table class="freq-table">
          <thead>
            <tr>
              <th>Year</th>
              <th>Building Structure</th>
              <th>Fixtures / Plant</th>
              <th>Total Non-Cash Deduction</th>
              <th>Est. Annual Tax Saved</th>
            </tr>
          </thead>
          <tbody>
            ${depSchedule.years
              .map(
                (y) => `
              <tr>
                <td><strong>Year ${y.year} (${y.calendarYear})</strong></td>
                <td>${fmt(y.structureDeduction)}</td>
                <td>${fmt(y.plantDeduction)}</td>
                <td class="retire-color"><strong>${fmt(y.totalDeduction)}</strong></td>
                <td class="net-col">+${fmt(y.totalDeduction * withoutPropertyCalc.marginalRate)}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `,
  });
}

function open10YrForecastPopup() {
  const { country, forecastYears, exitCgt } = currentImpact;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);
  openPopupModal({
    title: `${exitCgt.holdingYears}-Year Property Cashflow, Tax & Equity Forecast`,
    subtitle: `Assuming ${propState.capitalGrowthPct}%/yr capital growth and ${propState.rentGrowthPct}%/yr rent growth.`,
    bodyHtml: `
      <div class="table-scroll">
        <table class="freq-table">
          <thead>
            <tr>
              <th>Year</th>
              <th>Property Value</th>
              <th>Net Equity</th>
              <th>Gross Rent</th>
              <th>Pre-Tax Cashflow</th>
              <th>Tax Refund / (Bill)</th>
              <th>After-Tax Cashflow</th>
            </tr>
          </thead>
          <tbody>
            ${forecastYears
              .map(
                (fy) => `
              <tr>
                <td><strong>Year ${fy.year}</strong></td>
                <td>${fmt(fy.propertyValue)}</td>
                <td><strong>${fmt(fy.equity)}</strong></td>
                <td>${fmt(fy.grossRent)}</td>
                <td class="${fy.preTaxCashflow < 0 ? 'tax-color' : ''}">${fy.preTaxCashflow >= 0 ? '+' : '−'}${fmt(Math.abs(fy.preTaxCashflow))}</td>
                <td class="${fy.taxSavedOrPaid >= 0 ? 'net-col' : 'tax-color'}">${fy.taxSavedOrPaid >= 0 ? '+' : '−'}${fmt(Math.abs(fy.taxSavedOrPaid))}</td>
                <td class="${fy.afterTaxCashflow >= 0 ? 'net-col' : ''}"><strong>${fy.afterTaxCashflow >= 0 ? '+' : '−'}${fmt(Math.abs(fy.afterTaxCashflow))}</strong></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `,
  });
}

function exportDepreciationCsv() {
  const { country, depSchedule, withoutPropertyCalc } = currentImpact;
  const rows = [
    ['PaySense — Property Depreciation Schedule'],
    ['Country', `${country.name} (${country.taxYear})`],
    ['Property Value', propState.propertyValue],
    ['Year Built', propState.buildYear],
    ['Method', depSchedule.method === 'diminishing' ? 'Diminishing Value (200%)' : 'Prime Cost (100%)'],
    [],
    ['Year', 'Calendar Year', 'Building Structure Deduction', 'Fixtures / Plant Deduction', 'Total Non-Cash Deduction', 'Est. Tax Saved'],
    ...depSchedule.years.map((y) => [
      `Year ${y.year}`,
      y.calendarYear,
      y.structureDeduction,
      y.plantDeduction,
      y.totalDeduction,
      Math.round(y.totalDeduction * withoutPropertyCalc.marginalRate),
    ]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `paysense-depreciation-schedule-${country.code.toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Depreciation schedule CSV downloaded!');
}

function bindEvents() {
  els.aiForm.addEventListener('submit', (e) => {
    e.preventDefault();
    parsePropertyPrompt(els.aiInput.value);
  });

  els.aiChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-example-idx]');
    if (!btn) return;
    const ex = EXAMPLE_PROMPTS[Number(btn.dataset.exampleIdx)];
    if (!ex) return;
    els.aiInput.value = ex.prompt;
    parsePropertyPrompt(ex.prompt);
  });

  els.aiFeedback.addEventListener('click', (e) => {
    if (e.target.closest('#dismiss-prop-feedback')) {
      propState.lastParsed = null;
      renderAiFeedback();
    }
  });

  els.formRoot.addEventListener('click', (e) => {
    if (e.target.closest('#open-prop-settings-popup')) {
      openPropertySettingsPopup();
    }
  });

  els.formRoot.addEventListener('input', (e) => {
    const t = e.target;
    const val = Math.max(0, Number(t.value) || 0);
    if (t.id === 'prop-salary-input') propState.salary = val;
    else if (t.id === 'prop-value-input') propState.propertyValue = val;
    else if (t.id === 'prop-loan-input') propState.loanAmount = val;
    else if (t.id === 'prop-rate-input') propState.interestRatePct = Number(t.value) || 0;
    else if (t.id === 'prop-rent-input') propState.weeklyRent = val;
    else if (t.id === 'prop-expenses-input') propState.annualExpenses = val;
    renderResultsOnly();
  });

  els.formRoot.addEventListener('change', (e) => {
    if (e.target.id === 'prop-build-type') {
      propState.isBrandNewBuild = e.target.value === 'new';
      renderAll();
    }
  });

  els.resultsRoot.addEventListener('click', (e) => {
    const stageBtn = e.target.closest('[data-stage-view]');
    if (stageBtn) {
      propState.stageView = stageBtn.dataset.stageView;
      renderResultsOnly();
      return;
    }
    const depBtn = e.target.closest('[data-dep-method]');
    if (depBtn) {
      propState.depreciationMethod = depBtn.dataset.depMethod;
      renderResultsOnly();
      return;
    }
    if (e.target.closest('#open-10yr-dep-popup')) {
      open10YrDepreciationPopup();
      return;
    }
    if (e.target.closest('#open-10yr-forecast-popup')) {
      open10YrForecastPopup();
      return;
    }
    if (e.target.closest('#export-dep-csv-btn')) {
      exportDepreciationCsv();
      return;
    }
    if (e.target.closest('#print-dep-btn')) {
      window.print();
    }
  });
}

function init() {
  initGlobalHeader({
    activePage: 'property',
    onCountryChange: (newCode) => switchCountry(newCode),
  });
  renderExampleChips();
  renderAll();
  bindEvents();
}

init();
