/**
 * PaySense — Rental Property, Negative Gearing, DIY Depreciation Schedule &
 * 10-Year Capital Gains Forecaster (property.html)
 */

import { COUNTRIES, COUNTRY_LIST } from './tax/countries.js';
import { formatCurrency, formatPercent } from './tax/brackets.js';
import { defaultPropertyState, calculatePropertyImpact } from './tax/propertyEngine.js';
import { loadTheme, saveTheme } from './state.js';

const EXAMPLE_PROMPTS = [
  {
    label: '🇦🇺 AU $145k salary · $780k unit (neg. geared)',
    prompt: 'Australia $145k salary buying a $780k apartment built in 2021, $624k loan at 6.2%, $680/wk rent',
  },
  {
    label: '🇦🇺 AU $180k salary · Brand-new $920k townhouse',
    prompt: 'AU $180k salary buying a brand new $920k house built in 2026, $736k loan at 6.1%, $780/wk rent',
  },
  {
    label: '🇺🇸 US $155k salary · $520k rental (27.5yr MACRS)',
    prompt: 'US $155k salary buying a $520k rental house, $416k loan at 6.5%, $3100/mo rent',
  },
  {
    label: '🇬🇧 UK £85k salary · £360k Buy-to-Let (Sec 24)',
    prompt: 'UK £85k salary with a £360k buy-to-let, £270k loan at 5.2%, £1750/mo rent',
  },
  {
    label: '🇮🇳 India ₹32L salary · ₹1.2Cr flat (Sec 24)',
    prompt: 'India 32L salary buying a 1.2Cr flat, 90L loan at 8.6%, 36k/mo rent',
  },
];

let propState = {
  ...defaultPropertyState('AU'),
  drawerOpen: false,
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
  themeBtn: document.getElementById('theme-toggle-btn'),
  toast: document.getElementById('toast'),
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

/**
 * Plain-English natural language parser for rental property scenarios.
 */
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
    propState = {
      ...defaultPropertyState(newCountry),
      drawerOpen: propState.drawerOpen,
    };
  }
  const c = COUNTRIES[propState.country];
  const fmt = (n) => formatCurrency(n, c.currency, c.locale);
  tags.push(`${c.flag} ${c.name}`);

  if (/\b(buying|buy|plan|planning|forecast)\b/i.test(text)) {
    propState.intent = 'buy';
  } else if (/\b(already own|own|existing)\b/i.test(text)) {
    propState.intent = 'own';
  }

  if (/\b(brand[- ]?new|new build|off[- ]?the[- ]?plan)\b/i.test(text)) {
    propState.isBrandNewBuild = true;
    tags.push('Brand-New Build');
  } else if (/\b(established|second[- ]?hand)\b/i.test(text)) {
    propState.isBrandNewBuild = false;
    tags.push('Established Property');
  }

  // Year built ("built in 2021")
  const yrMatch = text.match(/built\s+in\s+(19\d\d|20\d\d)/i);
  if (yrMatch) {
    propState.buildYear = Number(yrMatch[1]);
    tags.push(`Built ${propState.buildYear}`);
  }

  // Interest rate ("at 6.2%", "6.2% interest")
  const rateMatch = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:interest|rate|loan|mortgage)?|(?:at|@)\s*(\d+(?:\.\d+)?)\s*%/i);
  if (rateMatch) {
    const r = Number(rateMatch[1] || rateMatch[2]);
    if (r > 0 && r < 25) {
      propState.interestRatePct = r;
      tags.push(`${r}% Interest`);
    }
  }

  // Salary ("$145k salary", "earning $150k")
  const salMatch = text.match(/(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lakh|lpa|cr)?\s*(?:salary|income|pay|wage)|(?:salary|earning|income)\s*(?:of\s*)?(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lakh|lpa|cr)?/i);
  if (salMatch) {
    const val = parseMoney(salMatch[1] || salMatch[3], salMatch[2] || salMatch[4]);
    if (val && val > 0) {
      propState.salary = val;
      tags.push(`Salary: ${fmt(val)}`);
    }
  }

  // Property value ("$780k apartment/house/unit/property/flat/buy-to-let")
  const propMatch = text.match(/(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lakh|cr|crore)?\s*(?:new\s+)?(?:apartment|unit|house|townhouse|property|flat|condo|buy[- ]?to[- ]?let|rental)/i);
  if (propMatch) {
    const val = parseMoney(propMatch[1], propMatch[2]);
    if (val && val > 20000) {
      propState.propertyValue = val;
      propState.buildingStructureCost = Math.round(val * 0.42);
      // Default 80% LVR if loan not explicitly stated
      propState.loanAmount = Math.round(val * 0.8);
      tags.push(`Property: ${fmt(val)}`);
    }
  }

  // Loan amount ("$624k loan", "80% loan")
  const loanMatch = text.match(/(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lakh|cr|crore)?\s*(?:loan|mortgage)/i);
  if (loanMatch) {
    const val = parseMoney(loanMatch[1], loanMatch[2]);
    if (val && val > 10000) {
      propState.loanAmount = val;
      tags.push(`Loan: ${fmt(val)}`);
    }
  }

  // Rent ("$680/wk rent", "$3100/mo rent")
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
    <div class="ai-feedback-inner">
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
  const fmt = (n) => formatCurrency(n, c.currency, c.locale);

  els.formRoot.innerHTML = `
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">01</span>
        <div class="section-divider-text">
          <h2 class="section-heading">Your Pay &amp; Rental Property Setup</h2>
          <p class="section-sub">Choose your country, whether you own or plan to buy, and enter the key property numbers.</p>
        </div>
        <span class="tax-year-pill">${escapeHtml(c.name)} · ${escapeHtml(c.taxYear)}</span>
      </div>

      <div class="card setup-card">
        <div class="setup-block">
          <label class="field-label">1. Which country’s tax &amp; property laws apply?</label>
          <div class="country-pills warm-country-pills" role="radiogroup" aria-label="Select country">
            ${COUNTRY_LIST.map(
              (country) => `
              <button type="button" class="country-pill ${country.code === propState.country ? 'active' : ''}" data-country="${country.code}">
                <span class="pill-flag">${country.flag}</span>
                <span class="pill-name">${escapeHtml(country.name)}</span>
              </button>
            `
            ).join('')}
          </div>
        </div>

        <div class="setup-two-col">
          <div class="setup-block">
            <label class="field-label">2. Where are you in your property journey?</label>
            <div class="segmented-control" role="tablist">
              <button type="button" class="seg-btn ${propState.intent === 'own' ? 'active' : ''}" data-intent="own">
                I Already Own One
              </button>
              <button type="button" class="seg-btn ${propState.intent === 'buy' ? 'active' : ''}" data-intent="buy">
                Planning to Buy (Forecaster)
              </button>
            </div>
            <div class="field-hint">
              ${
                propState.intent === 'own'
                  ? 'Focuses on your current-year tax refund, negative gearing, and DIY depreciation schedule.'
                  : 'Models upfront deposit, weekly holding cost after tax, 10-year equity, and Capital Gains Tax on exit.'
              }
            </div>
          </div>

          <div class="setup-block">
            <label class="field-label" for="prop-salary-input">3. Your annual gross salary / income (before property)</label>
            <div class="input-combo">
              <span class="input-prefix">${escapeHtml(c.symbol)}</span>
              <input type="number" id="prop-salary-input" class="num-input" min="0" step="2000" value="${propState.salary}" />
              <span class="input-suffix">per year</span>
            </div>
            <div class="field-hint">We combine your salary with the property’s rental profit or loss to calculate your real tax refund or bill.</div>
          </div>
        </div>

        <!-- Core Property Inputs Grid -->
        <div class="prop-core-grid">
          <div class="sub-field">
            <label class="sub-label" for="prop-value-input">Property Value / Purchase Price</label>
            <div class="input-combo compact">
              <span class="input-prefix">${escapeHtml(c.symbol)}</span>
              <input type="number" id="prop-value-input" class="num-input" min="0" step="10000" value="${propState.propertyValue}" />
            </div>
          </div>

          <div class="sub-field">
            <label class="sub-label" for="prop-loan-input">Mortgage Loan Amount (${currentImpact.summaryMetrics.lvrPct.toFixed(0)}% LVR)</label>
            <div class="input-combo compact">
              <span class="input-prefix">${escapeHtml(c.symbol)}</span>
              <input type="number" id="prop-loan-input" class="num-input" min="0" step="10000" value="${propState.loanAmount}" />
            </div>
          </div>

          <div class="sub-field">
            <label class="sub-label" for="prop-rate-input">Loan Interest Rate (%)</label>
            <input type="number" id="prop-rate-input" class="text-input" min="0" max="20" step="0.1" value="${propState.interestRatePct}" />
            <div class="field-hint">Interest: ${fmt(currentImpact.annualInterest)}/yr</div>
          </div>

          <div class="sub-field">
            <label class="sub-label" for="prop-rent-input">Weekly Rent Collected</label>
            <div class="input-combo compact">
              <span class="input-prefix">${escapeHtml(c.symbol)}</span>
              <input type="number" id="prop-rent-input" class="num-input" min="0" step="20" value="${propState.weeklyRent}" />
              <span class="input-suffix">/ wk</span>
            </div>
            <div class="field-hint">${fmt(currentImpact.annualRent)}/yr (${currentImpact.summaryMetrics.grossYieldPct.toFixed(1)}% gross yield)</div>
          </div>

          <div class="sub-field">
            <label class="sub-label" for="prop-expenses-input">Annual Running Costs (ex. interest)</label>
            <div class="input-combo compact">
              <span class="input-prefix">${escapeHtml(c.symbol)}</span>
              <input type="number" id="prop-expenses-input" class="num-input" min="0" step="500" value="${propState.annualExpenses}" />
              <span class="input-suffix">/ yr</span>
            </div>
            <div class="field-hint">Council rates, strata/HOA, insurance, water, agent fees.</div>
          </div>

          <div class="sub-field">
            <label class="sub-label" for="prop-build-type">Property Age / Type (for Depreciation)</label>
            <select id="prop-build-type" class="select-input">
              <option value="established" ${!propState.isBrandNewBuild ? 'selected' : ''}>Established / Second-Hand Property</option>
              <option value="new" ${propState.isBrandNewBuild ? 'selected' : ''}>Brand-New Build / Substantially Renovated</option>
            </select>
            <div class="field-hint">Built in <strong>${propState.buildYear}</strong> (adjust below)</div>
          </div>
        </div>

        <!-- Expandable Drawer for Depreciation Schedule & 10-Year Growth Tweaks -->
        <details class="optional-drawer" id="prop-optional-drawer" ${propState.drawerOpen ? 'open' : ''}>
          <summary class="optional-summary">
            <span>Customize depreciation schedule values &amp; 10-year capital gains assumptions <span class="muted-normal">(Optional)</span></span>
            <span class="summary-chevron" aria-hidden="true">▾</span>
          </summary>

          <div class="optional-body">
            <div class="optional-grid">
              <div>
                <h3 class="mini-section-title">Depreciation Schedule Inputs</h3>
                <div class="two-col-fields">
                  <div class="sub-field">
                    <label class="sub-label" for="prop-buildyear-input">Year Property Was Built</label>
                    <input type="number" id="prop-buildyear-input" class="text-input" min="1950" max="2026" step="1" value="${propState.buildYear}" />
                  </div>
                  <div class="sub-field">
                    <label class="sub-label" for="prop-depmethod-select">Fixtures Depreciation Method</label>
                    <select id="prop-depmethod-select" class="select-input">
                      <option value="diminishing" ${propState.depreciationMethod === 'diminishing' ? 'selected' : ''}>Diminishing Value (200% · Faster upfront)</option>
                      <option value="prime" ${propState.depreciationMethod === 'prime' ? 'selected' : ''}>Prime Cost (100% · Even straight-line)</option>
                    </select>
                  </div>
                </div>

                <div class="two-col-fields mt-sm">
                  <div class="sub-field">
                    <label class="sub-label" for="prop-struct-input">Historical Building Construction Cost</label>
                    <div class="input-combo compact">
                      <span class="input-prefix">${escapeHtml(c.symbol)}</span>
                      <input type="number" id="prop-struct-input" class="num-input" min="0" step="10000" value="${propState.buildingStructureCost}" />
                    </div>
                    <div class="field-hint">Structure cost excluding land (e.g. Div 43 / MACRS basis)</div>
                  </div>
                  <div class="sub-field">
                    <label class="sub-label" for="prop-plant-input">
                      ${propState.country === 'AU' && !propState.isBrandNewBuild ? 'Brand-New Upgrades You Installed' : 'Fixtures / Plant & Equipment Value'}
                    </label>
                    <div class="input-combo compact">
                      <span class="input-prefix">${escapeHtml(c.symbol)}</span>
                      <input
                        type="number"
                        id="prop-plant-input"
                        class="num-input"
                        min="0"
                        step="1000"
                        value="${propState.country === 'AU' && !propState.isBrandNewBuild ? propState.newUpgradesInstalled : propState.plantAndEquipmentValue}"
                      />
                    </div>
                    <div class="field-hint">Carpets, AC, blinds, oven, hot water, alarms</div>
                  </div>
                </div>
              </div>

              <div>
                <h3 class="mini-section-title">10-Year Forecast &amp; Sale (CGT) Assumptions</h3>
                <div class="two-col-fields">
                  <div class="sub-field">
                    <label class="sub-label" for="prop-capgrowth-input">Annual Property Value Growth (%)</label>
                    <input type="number" id="prop-capgrowth-input" class="text-input" min="-5" max="20" step="0.5" value="${propState.capitalGrowthPct}" />
                  </div>
                  <div class="sub-field">
                    <label class="sub-label" for="prop-rentgrowth-input">Annual Rent Growth (%)</label>
                    <input type="number" id="prop-rentgrowth-input" class="text-input" min="-5" max="15" step="0.5" value="${propState.rentGrowthPct}" />
                  </div>
                </div>
                <div class="two-col-fields mt-sm">
                  <div class="sub-field">
                    <label class="sub-label" for="prop-holdyears-input">Holding Period Before Sale (Years)</label>
                    <input type="number" id="prop-holdyears-input" class="text-input" min="1" max="25" step="1" value="${propState.holdingYears}" />
                  </div>
                  <div class="sub-field">
                    <label class="sub-label" for="prop-buycost-input">Buying Costs / Stamp Duty (%)</label>
                    <input type="number" id="prop-buycost-input" class="text-input" min="0" max="15" step="0.2" value="${propState.buyingCostsPct}" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </details>
      </div>
    </section>
  `;
}

function renderPropertyResults() {
  const { country, year1, withoutPropertyCalc, depSchedule, forecastYears, exitCgt } = currentImpact;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);

  const isRefund = year1.taxSavedOrPaid >= 0;
  const isPositiveAfterTax = year1.afterTaxPropertyCashflow >= 0;
  const oldTaxTotal =
    withoutPropertyCalc.incomeTax + withoutPropertyCalc.leviesAndSocial + withoutPropertyCalc.studentLoan;

  els.resultsRoot.innerHTML = `
    <!-- SECTION 02: HOW THIS PROPERTY AFFECTS YOUR PAY & TAX -->
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">02</span>
        <div class="section-divider-text">
          <h2 class="section-heading">How This Property Affects Your Pay &amp; Tax (Year 1)</h2>
          <p class="section-sub">Your cashflow before tax, your non-cash depreciation, and your real weekly cost or income after tax.</p>
        </div>
        <span class="comp-pill ${isRefund ? 'comp-low' : 'comp-mod'}">${escapeHtml(year1.gearingStatus)}</span>
      </div>

      <div class="card hero-card">
        <div class="take-home-spotlight" style="padding-top:4px;">
          <div class="spotlight-label">
            ${isPositiveAfterTax ? 'Net Extra Cashflow in Your Pocket (After Tax)' : 'Real Out-of-Pocket Holding Cost (After Tax Refund)'}
          </div>
          <div class="hero-net-value ${isPositiveAfterTax ? 'net-col' : ''}">
            ${isPositiveAfterTax ? '+' : '−'}${fmt(Math.abs(year1.weeklyAfterTaxImpact))} <span class="hero-period-unit">per week</span>
            <span class="hero-period-unit">(${isPositiveAfterTax ? '+' : '−'}${fmt(Math.abs(year1.monthlyAfterTaxImpact))}/month)</span>
          </div>

          <p class="plain-english-summary">
            Before tax, your rent (${fmt(currentImpact.annualRent)}/yr) minus mortgage interest (${fmt(currentImpact.annualInterest)}/yr) and running costs (${fmt(currentImpact.annualExpenses)}/yr) leaves a pre-tax cashflow of <strong>${year1.preTaxCashflow >= 0 ? '+' : '−'}${fmt(Math.abs(year1.preTaxCashflow))}/year</strong>.
            Adding <strong>${fmt(year1.claimedTotalDep)}/year</strong> in paper depreciation produces a <strong>${isRefund ? `${fmt(year1.taxSavedOrPaid)}/year tax refund` : `${fmt(Math.abs(year1.taxSavedOrPaid))}/year extra tax bill`}</strong> — bringing your combined annual take-home (salary + property) from <strong>${fmt(withoutPropertyCalc.netIncome)}</strong> to <strong>${fmt(year1.combinedTakeHomeWithProperty)}</strong>.
          </p>
        </div>

        <!-- Side-by-Side: Pay Without Property vs Pay With Property -->
        <div class="pay-comparison-boxes" style="margin-top:8px;">
          <div class="pay-mode-box">
            <div class="pay-mode-tag">Your Pay Without Property</div>
            <div class="pay-mode-main">${fmt(withoutPropertyCalc.netIncome)} <span class="unit">/ yr net</span></div>
            <div class="pay-mode-takehome">Monthly take-home: <strong>${fmt(withoutPropertyCalc.netIncome / 12)}/mo</strong></div>
            <div class="pay-mode-range">Total Tax &amp; Levies Paid: <strong>${fmt(oldTaxTotal)}/yr</strong> (Marginal rate: ${formatPercent(withoutPropertyCalc.marginalRate, 1)})</div>
          </div>

          <div class="pay-mode-box contractor-box">
            <div class="pay-mode-tag">Your Combined Cashflow With Property</div>
            <div class="pay-mode-main">${fmt(year1.combinedTakeHomeWithProperty)} <span class="unit">/ yr net</span></div>
            <div class="pay-mode-takehome">
              New Total Tax Bill: <strong>${fmt(year1.newTotalTaxAndLevies)}/yr</strong>
              (${isRefund ? `You save ${fmt(year1.taxSavedOrPaid)} in tax` : `You pay ${fmt(Math.abs(year1.taxSavedOrPaid))} extra tax`})
            </div>
            <div class="pay-mode-range">
              Net Property Impact: <strong>${year1.afterTaxPropertyCashflow >= 0 ? '+' : '−'}${fmt(Math.abs(year1.afterTaxPropertyCashflow))}/yr</strong> (${isPositiveAfterTax ? '+' : '−'}${fmt(Math.abs(year1.weeklyAfterTaxImpact))}/wk)
            </div>
          </div>
        </div>

        <!-- Step-by-Step Property Cashflow & Tax Bridge -->
        <div class="kpi-grid" style="margin-top:20px;">
          <div class="kpi-tile">
            <div class="kpi-label">1. Pre-Tax Property Cash</div>
            <div class="kpi-val ${year1.preTaxCashflow < 0 ? 'tax-color' : 'net-col'}">${year1.preTaxCashflow >= 0 ? '+' : '−'}${fmt(Math.abs(year1.preTaxCashflow))}</div>
            <div class="kpi-meta">${year1.preTaxCashflow >= 0 ? '+' : '−'}${fmt(Math.abs(year1.preTaxCashflow / 52))}/wk before tax</div>
          </div>
          <div class="kpi-tile">
            <div class="kpi-label">2. Non-Cash Depreciation</div>
            <div class="kpi-val retire-color">${fmt(year1.claimedTotalDep)}</div>
            <div class="kpi-meta">Paper deduction (costs $0 cash)</div>
          </div>
          <div class="kpi-tile">
            <div class="kpi-label">3. ${isRefund ? 'Annual Tax Refund / Saved' : 'Extra Annual Tax Owed'}</div>
            <div class="kpi-val ${isRefund ? 'net-col' : 'tax-color'}">${isRefund ? '+' : '−'}${fmt(Math.abs(year1.taxSavedOrPaid))}</div>
            <div class="kpi-meta">${isRefund ? '+' : '−'}${fmt(Math.abs(year1.taxSavedOrPaid / 52))}/wk tax effect</div>
          </div>
          <div class="kpi-tile">
            <div class="kpi-label">4. Real After-Tax Cashflow</div>
            <div class="kpi-val ${isPositiveAfterTax ? 'net-col' : ''}">${isPositiveAfterTax ? '+' : '−'}${fmt(Math.abs(year1.afterTaxPropertyCashflow))}</div>
            <div class="kpi-meta">${isPositiveAfterTax ? '+' : '−'}${fmt(Math.abs(year1.weeklyAfterTaxImpact))}/wk in pocket</div>
          </div>
        </div>

        <div class="driver-note" style="margin-top:18px;">
          <strong>Local Law Applied (${escapeHtml(year1.lawTitle)}):</strong> ${escapeHtml(year1.lawExplanation)}
        </div>
      </div>
    </section>

    <!-- SECTION 03: FREE DIY DEPRECIATION SCHEDULE GENERATOR -->
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">03</span>
        <div class="section-divider-text">
          <h2 class="section-heading">Your Property Depreciation Schedule (Free Generator)</h2>
          <p class="section-sub">Itemized building structure and fixtures schedule — compare Diminishing Value vs Prime Cost and export to CSV.</p>
        </div>
        <div class="hero-actions">
          <button type="button" class="btn-ghost btn-sm" id="export-dep-csv-btn">Download Schedule (CSV)</button>
          <button type="button" class="btn-ghost btn-sm" id="print-dep-btn">Print Schedule</button>
        </div>
      </div>

      <div class="card">
        <div class="dep-controls-bar">
          <div>
            <strong>10-Year Total Non-Cash Deductions: ${fmt(depSchedule.tenYearTotal)}</strong>
            <div class="muted" style="font-size:0.84rem;">Year 1 Deduction: <strong>${fmt(depSchedule.year1Total)}</strong> (Structure: ${fmt(year1.claimedStructureDep)} + Fixtures: ${fmt(year1.claimedPlantDep)})</div>
          </div>
          <div class="segmented-control" style="min-width:290px;">
            <button type="button" class="seg-btn ${depSchedule.method === 'diminishing' ? 'active' : ''}" data-dep-method="diminishing">
              Diminishing Value (200%)
            </button>
            <button type="button" class="seg-btn ${depSchedule.method === 'prime' ? 'active' : ''}" data-dep-method="prime">
              Prime Cost (Straight-Line)
            </button>
          </div>
        </div>

        <p class="reassure-note" style="margin-top:16px;">
          <strong>How this schedule works in ${escapeHtml(country.name)}:</strong> ${escapeHtml(depSchedule.plantRuleNote)}
        </p>

        <!-- Year 1 Itemized Asset Table -->
        <h3 class="mini-section-title" style="margin-top:18px;">Part A — Itemized Assets &amp; Year-1 Depreciation Breakdown</h3>
        <div class="table-scroll">
          <table class="freq-table">
            <thead>
              <tr>
                <th>Asset Category</th>
                <th>Effective Life</th>
                <th>Annual Rate (${depSchedule.method === 'diminishing' ? 'DV' : 'Prime'})</th>
                <th>Depreciable Base</th>
                <th>Year 1 Claim</th>
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

        <!-- 10-Year Schedule Table -->
        <h3 class="mini-section-title" style="margin-top:26px;">Part B — 10-Year Year-by-Year Depreciation Schedule</h3>
        <div class="table-scroll">
          <table class="freq-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Building Structure</th>
                <th>Fixtures / Plant (Div 40)</th>
                <th>Total Non-Cash Deduction</th>
                <th>Est. Tax Saved from Depreciation</th>
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

        ${
          propState.country === 'AU'
            ? `
          <div class="form-footnote mt-sm">
            <strong>ATO Tip:</strong> You can claim new fixtures/upgrades you buy yourself using your actual tax invoices for $0. To claim Division 43 building construction costs when the original builder’s construction cost isn’t known, the ATO requires a one-off report signed by a registered Quantity Surveyor (whose fee is 100% tax-deductible).
          </div>
        `
            : ''
        }
      </div>
    </section>

    <!-- SECTION 04: 10-YEAR BUY FORECASTER & CAPITAL GAINS TAX ON EXIT -->
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">04</span>
        <div class="section-divider-text">
          <h2 class="section-heading">${exitCgt.holdingYears}-Year Wealth Forecaster &amp; Capital Gains Tax on Sale</h2>
          <p class="section-sub">What happens if property values grow at ${propState.capitalGrowthPct}%/yr and you sell after ${exitCgt.holdingYears} years.</p>
        </div>
      </div>

      <div class="card">
        <div class="reality-grid">
          <div class="reality-metric highlight">
            <div class="reality-label">Projected Value in Year ${exitCgt.holdingYears}</div>
            <div class="reality-big">${fmt(exitCgt.salePrice)}</div>
            <div class="reality-sub">Up from ${fmt(propState.propertyValue)} purchase price (+${fmt(exitCgt.salePrice - propState.propertyValue)} gross appreciation)</div>
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
            <div class="reality-label">Total Net Profit (After CGT &amp; Holding Costs)</div>
            <div class="reality-big">${exitCgt.totalNetWealthCreated >= 0 ? '+' : '−'}${fmt(Math.abs(exitCgt.totalNetWealthCreated))}</div>
            <div class="reality-sub">Net sale profit after CGT + ${exitCgt.holdingYears} yrs after-tax cashflow (${currentImpact.summaryMetrics.cumulativeNetCashflow >= 0 ? '+' : '−'}${fmt(Math.abs(currentImpact.summaryMetrics.cumulativeNetCashflow))})</div>
          </div>
        </div>

        <div class="driver-note" style="margin-top:18px; margin-bottom:22px;">
          <strong>How Capital Gains Tax works on exit in ${escapeHtml(country.name)}:</strong> ${escapeHtml(exitCgt.cgtRuleNote)}
        </div>

        <h3 class="mini-section-title">Year-by-Year Cashflow, Tax Benefit &amp; Equity Forecast</h3>
        <div class="table-scroll">
          <table class="freq-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Est. Property Value</th>
                <th>Your Net Equity</th>
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
      </div>
    </section>
  `;
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
  els.themeBtn?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });

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

  els.formRoot.addEventListener(
    'toggle',
    (e) => {
      if (e.target.id === 'prop-optional-drawer') {
        propState.drawerOpen = e.target.open;
      }
    },
    true
  );

  els.formRoot.addEventListener('click', (e) => {
    const countryBtn = e.target.closest('[data-country]');
    if (countryBtn) {
      const newCode = countryBtn.dataset.country;
      if (COUNTRIES[newCode] && newCode !== propState.country) {
        propState = {
          ...defaultPropertyState(newCode),
          intent: propState.intent,
          drawerOpen: propState.drawerOpen,
        };
        renderAll();
      }
      return;
    }

    const intentBtn = e.target.closest('[data-intent]');
    if (intentBtn) {
      propState.intent = intentBtn.dataset.intent;
      renderAll();
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
    else if (t.id === 'prop-buildyear-input') propState.buildYear = val || 2020;
    else if (t.id === 'prop-struct-input') propState.buildingStructureCost = val;
    else if (t.id === 'prop-plant-input') {
      if (propState.country === 'AU' && !propState.isBrandNewBuild) {
        propState.newUpgradesInstalled = val;
      } else {
        propState.plantAndEquipmentValue = val;
      }
    } else if (t.id === 'prop-capgrowth-input') propState.capitalGrowthPct = Number(t.value) || 0;
    else if (t.id === 'prop-rentgrowth-input') propState.rentGrowthPct = Number(t.value) || 0;
    else if (t.id === 'prop-holdyears-input') propState.holdingYears = Math.max(1, val || 10);
    else if (t.id === 'prop-buycost-input') propState.buyingCostsPct = Number(t.value) || 0;
    renderResultsOnly();
  });

  els.formRoot.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'prop-build-type') {
      propState.isBrandNewBuild = t.value === 'new';
      renderAll();
    } else if (t.id === 'prop-depmethod-select') {
      propState.depreciationMethod = t.value;
      renderResultsOnly();
    }
  });

  els.resultsRoot.addEventListener('click', (e) => {
    const depBtn = e.target.closest('[data-dep-method]');
    if (depBtn) {
      propState.depreciationMethod = depBtn.dataset.depMethod;
      renderAll();
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
  applyTheme(loadTheme());
  renderExampleChips();
  renderAll();
  bindEvents();
}

init();
