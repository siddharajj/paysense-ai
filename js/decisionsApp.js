/**
 * PaySense — Life & Money Decisions Controller (decisions.html)
 * 100% client-side natural language parser & interactive decision calculators:
 *   1. Car: Novated Lease & EV vs Petrol vs Loan vs Cash
 *   2. Home: Rent vs Buy & Invest the Difference in ETFs
 *   3. Smart What-Ifs: Extra Monthly Savings (Offset vs Super vs ETFs) & 4-Day Work Week
 */

import { COUNTRIES, COUNTRY_LIST } from './tax/countries.js';
import { formatCurrency } from './tax/brackets.js';
import {
  defaultDecisionsState,
  calculateCarDecision,
  calculateRentVsBuy,
  calculateWhatIfScenarios,
} from './tax/decisionsEngine.js';
import { loadTheme, saveTheme } from './state.js';

const EXAMPLE_PROMPTS = [
  {
    label: '🚗 AU $145k salary · $62k EV novated lease vs $54k petrol',
    prompt: 'AU $145k salary, $62k EV novated lease over 4 years, 15000 km vs $54k petrol car',
  },
  {
    label: '🚗 UK £85k salary · £48k EV salary sacrifice (3% BiK)',
    prompt: 'UK £85k salary, £48k EV novated lease over 3 years vs £40k petrol',
  },
  {
    label: '🏡 Rent $720/wk vs Buy $850k home ($170k deposit)',
    prompt: 'Should I buy a $850k home with $170k deposit at 6.1% or rent for $720/wk over 10 years?',
  },
  {
    label: '💰 Extra $1,200/mo: Offset at 6.2% vs Super vs ETFs',
    prompt: 'I have an extra $1200/month on $150k salary — mortgage offset at 6.2% vs super vs ETFs over 10 years?',
  },
  {
    label: '⏳ What if I switch to a 4-day work week on $140k?',
    prompt: 'What if I switch to a 4-day work week on $140k salary in Australia?',
  },
];

let decState = {
  ...defaultDecisionsState('AU'),
  lastParsed: null,
};

const els = {
  formRoot: document.getElementById('dec-form-root'),
  resultsRoot: document.getElementById('dec-results-root'),
  aiForm: document.getElementById('dec-ai-form'),
  aiInput: document.getElementById('dec-ai-input'),
  aiChips: document.getElementById('dec-example-chips'),
  aiFeedback: document.getElementById('dec-ai-feedback'),
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

function parseMoney(numStr, suf = '') {
  const n = Number(String(numStr).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const s = (suf || '').toLowerCase();
  if (s === 'k') return n * 1_000;
  if (s === 'm') return n * 1_000_000;
  if (s === 'l' || s === 'lakh' || s === 'lpa') return n * 100_000;
  if (s === 'cr' || s === 'crore') return n * 10_000_000;
  return n;
}

/**
 * 100% Client-Side Natural Language Parser for Life & Money Decisions.
 */
function parseDecisionPrompt(rawText) {
  const text = (rawText || '').trim();
  if (!text) return;

  const tags = [];
  let newCountry = decState.country;

  const countryPatterns = [
    ['AU', /\b(australia|au|aud|sydney|melbourne|brisbane|ato|fbt|hecs)\b/i],
    ['US', /\b(united states|usa|us|usd|california|texas|401k)\b/i],
    ['UK', /\b(uk|united kingdom|gbp|britain|london|bik|£)\b/i],
    ['CA', /\b(canada|ca|cad|toronto|vancouver|rrsp)\b/i],
    ['IN', /\b(india|in|inr|₹|lakh|lpa|cr|crore)\b/i],
    ['NZ', /\b(new zealand|nz|nzd|auckland|kiwisaver)\b/i],
    ['SG', /\b(singapore|sg|sgd|s\$|cpf)\b/i],
  ];

  for (const [code, re] of countryPatterns) {
    if (re.test(text)) {
      newCountry = code;
      break;
    }
  }

  if (newCountry !== decState.country) {
    const prevTool = decState.activeTool;
    decState = {
      ...defaultDecisionsState(newCountry),
      activeTool: prevTool,
    };
  }

  const c = COUNTRIES[decState.country];
  const fmt = (n) => formatCurrency(n, c.currency, c.locale);
  tags.push(`${c.flag} ${c.name}`);

  // Detect which of the 3 tools the prompt is asking about
  if (/\b(novated|ev|electric|petrol|hybrid|car|tesla|byd|lease|bik|km)\b/i.test(text)) {
    decState.activeTool = 'car';
    tags.push('Car & Novated Lease');
  } else if (/\b(rent\s+vs\s+buy|buy\s+a?\s*(?:home|house|apartment)|rent\s+for|deposit)\b/i.test(text)) {
    decState.activeTool = 'rentbuy';
    tags.push('Rent vs Buy Home');
  } else if (/\b(extra|surplus|offset|super|401k|etf|4[- ]?day|part[- ]?time|days?\s+a\s+week)\b/i.test(text)) {
    decState.activeTool = 'whatif';
    tags.push('Smart What-Ifs');
  }

  // Extract salary ("$145k salary", "on $140k")
  const salMatch = text.match(/(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lakh|lpa|cr)?\s*(?:salary|income|pay)|(?:on|earning)\s+(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lakh|lpa|cr)\b/i);
  if (salMatch) {
    const val = parseMoney(salMatch[1] || salMatch[3], salMatch[2] || salMatch[4]);
    if (val && val > 10000) {
      decState.salary = val;
      tags.push(`Salary: ${fmt(val)}`);
    }
  }

  if (decState.activeTool === 'car') {
    const evMatch = text.match(/(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|l|lakh)?\s*(?:ev|electric|tesla|byd)/i);
    if (evMatch) {
      const val = parseMoney(evMatch[1], evMatch[2]);
      if (val && val > 5000) {
        decState.car.evPrice = val;
        tags.push(`EV: ${fmt(val)}`);
      }
    }
    const petMatch = text.match(/(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|l|lakh)?\s*(?:petrol|hybrid|gas|ice)/i);
    if (petMatch) {
      const val = parseMoney(petMatch[1], petMatch[2]);
      if (val && val > 5000) {
        decState.car.petrolPrice = val;
        tags.push(`Petrol: ${fmt(val)}`);
      }
    }
    const yrMatch = text.match(/\b([1-5])\s*(?:yr|year)s?\b/i);
    if (yrMatch) {
      decState.car.leaseYears = Number(yrMatch[1]);
      tags.push(`${decState.car.leaseYears}-Yr Lease`);
    }
    const kmMatch = text.match(/([\d,]+)\s*km/i);
    if (kmMatch) {
      const km = Number(kmMatch[1].replace(/,/g, ''));
      if (km >= 2000 && km <= 100000) {
        decState.car.annualKm = km;
        tags.push(`${km.toLocaleString()} km/yr`);
      }
    }
    if (/\bhecs\b/i.test(text)) {
      decState.car.hasHecs = !/\bno\s+hecs\b/i.test(text);
    }

    const res = calculateCarDecision(decState);
    const diff = res.options.petrolNovated.totalCostToOwnAfterTerm - res.options.evNovated.totalCostToOwnAfterTerm;
    decState.lastParsed = {
      tags,
      summary: `An EV on a ${res.years}-year novated lease costs ${fmt(res.options.evNovated.weeklyNetCost)}/wk out of your take-home pay (saving ${fmt(res.options.evNovated.totalTaxAndGstSaved)} in tax & GST) — beating a petrol novated lease by ${fmt(Math.abs(diff))} over ${res.years} years.`,
    };
  } else if (decState.activeTool === 'rentbuy') {
    const homeMatch = text.match(/(?:buy\s+a?\s*)?(?:[$£₹]|s\$)\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|cr)?\s*(?:home|house|apartment|unit|property)/i);
    if (homeMatch) {
      const val = parseMoney(homeMatch[1], homeMatch[2]);
      if (val && val > 50000) {
        decState.rentBuy.homePrice = val;
        tags.push(`Home: ${fmt(val)}`);
      }
    }
    const depMatch = text.match(/(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|cr)?\s*deposit/i);
    if (depMatch) {
      const val = parseMoney(depMatch[1], depMatch[2]);
      if (val && val >= 0) {
        decState.rentBuy.depositSaved = val;
        tags.push(`Deposit: ${fmt(val)}`);
      }
    }
    const rentMatch = text.match(/rent\s+(?:for\s+)?(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:\/\s*|per\s+)?(wk|week|mo|month)?/i);
    if (rentMatch) {
      const val = parseMoney(rentMatch[1], rentMatch[2]);
      const unit = (rentMatch[3] || 'wk').toLowerCase();
      if (val && val > 0) {
        decState.rentBuy.weeklyRent = unit.startsWith('m') ? Math.round((val * 12) / 52) : Math.round(val);
        tags.push(`Rent: ${fmt(decState.rentBuy.weeklyRent)}/wk`);
      }
    }
    const rateMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
    if (rateMatch) {
      const r = Number(rateMatch[1]);
      if (r > 1 && r < 18) decState.rentBuy.mortgageRatePct = r;
    }

    const res = calculateRentVsBuy(decState);
    const buyerWins = res.netDifference >= 0;
    decState.lastParsed = {
      tags,
      summary: `Over ${res.holdingYears} years, ${buyerWins ? 'Buying the home' : 'Renting & investing the difference in ETFs'} comes out ahead by ${fmt(Math.abs(res.netDifference))} (${fmt(res.finalBuyerNetWealth)} home equity vs ${fmt(res.finalRenterNetWealth)} ETF portfolio after CGT).`,
    };
  } else {
    const surMatch = text.match(/(?:extra|surplus|save|invest)\s+(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:\/\s*|per\s+)?(?:mo|month)?/i);
    if (surMatch) {
      const val = parseMoney(surMatch[1], surMatch[2]);
      if (val && val > 0) {
        decState.whatIf.monthlySurplus = val;
        tags.push(`Extra: ${fmt(val)}/mo`);
      }
    }
    const res = calculateWhatIfScenarios(decState);
    const fourDay = res.partTimeCushion[1];
    decState.lastParsed = {
      tags,
      summary: `On ${fmt(decState.salary)}/yr: switching to a 4-day week (80% time) keeps ${fourDay.netRatioPct}% of your take-home pay (${fmt(fourDay.netMonthly)}/mo), while sacrificing ${fmt(decState.whatIf.monthlySurplus)}/mo into ${c.retirementLabel} grows to ${fmt(res.surplusAllocation.superSacrifice.finalValue)} over ${res.surplusAllocation.years} years.`,
    };
  }

  renderAll();
}

function renderExampleChips() {
  els.aiChips.innerHTML = EXAMPLE_PROMPTS.map(
    (ex, idx) => `<button type="button" class="prompt-chip" data-example-idx="${idx}">${escapeHtml(ex.label)}</button>`
  ).join('');
}

function renderAiFeedback() {
  if (!decState.lastParsed) {
    els.aiFeedback.hidden = true;
    els.aiFeedback.innerHTML = '';
    return;
  }
  const { tags, summary } = decState.lastParsed;
  els.aiFeedback.hidden = false;
  els.aiFeedback.innerHTML = `
    <div class="ai-feedback-inner">
      <div class="ai-feedback-top">
        <span class="ai-source-badge">Instant Client-Side Analysis</span>
        <div class="parsed-tags-wrap">
          ${tags.map((t) => `<span class="parsed-tag">${escapeHtml(t)}</span>`).join('')}
        </div>
        <button type="button" class="icon-btn" id="dismiss-dec-feedback" title="Dismiss">✕</button>
      </div>
      <div class="ai-reply-text">${escapeHtml(summary)}</div>
    </div>
  `;
}

function renderAll() {
  renderDecisionForm();
  renderDecisionResults();
  renderAiFeedback();
}

function renderResultsOnly() {
  renderDecisionResults();
}

function renderDecisionForm() {
  const c = COUNTRIES[decState.country] || COUNTRIES.AU;
  const tool = decState.activeTool;

  els.formRoot.innerHTML = `
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">01</span>
        <div class="section-divider-text">
          <h2 class="section-heading">Choose Your Decision &amp; Numbers</h2>
          <p class="section-sub">Pick which decision you’re exploring, select your country, and enter your numbers.</p>
        </div>
        <span class="tax-year-pill">${escapeHtml(c.name)} · ${escapeHtml(c.taxYear)}</span>
      </div>

      <div class="card setup-card">
        <!-- Tool Switcher Cards -->
        <div class="setup-block">
          <label class="field-label">1. Which decision do you want to work out?</label>
          <div class="decision-tool-tabs" role="tablist">
            <button type="button" class="decision-tool-card ${tool === 'car' ? 'active' : ''}" data-tool="car">
              <div class="dtc-title">🚗 Car: Novated Lease &amp; EV vs Petrol</div>
              <div class="dtc-sub">Compare pre-tax EV lease (FBT-exempt), petrol lease, car loan &amp; paying cash.</div>
            </button>
            <button type="button" class="decision-tool-card ${tool === 'rentbuy' ? 'active' : ''}" data-tool="rentbuy">
              <div class="dtc-title">🏡 Home: Rent vs Buy (&amp; Invest Difference)</div>
              <div class="dtc-sub">Compare buying a home to live in vs renting and investing your deposit in ETFs.</div>
            </button>
            <button type="button" class="decision-tool-card ${tool === 'whatif' ? 'active' : ''}" data-tool="whatif">
              <div class="dtc-title">🧭 Smart “What-If” Playbooks</div>
              <div class="dtc-sub">Where to put extra monthly savings (Offset vs Super vs ETFs) &amp; 4-day work week impact.</div>
            </button>
          </div>
        </div>

        <!-- Country & Salary -->
        <div class="setup-two-col">
          <div class="setup-block">
            <label class="field-label">2. Your Country</label>
            <div class="country-pills warm-country-pills" role="radiogroup" aria-label="Select country">
              ${COUNTRY_LIST.map(
                (country) => `
                <button type="button" class="country-pill ${country.code === decState.country ? 'active' : ''}" data-country="${country.code}">
                  <span class="pill-flag">${country.flag}</span>
                  <span class="pill-name">${escapeHtml(country.name)}</span>
                </button>
              `
              ).join('')}
            </div>
          </div>

          <div class="setup-block">
            <label class="field-label" for="dec-salary-input">3. Your Annual Gross Salary</label>
            <div class="input-combo">
              <span class="input-prefix">${escapeHtml(c.symbol)}</span>
              <input type="number" id="dec-salary-input" class="num-input" min="0" step="2000" value="${decState.salary}" />
              <span class="input-suffix">per year</span>
            </div>
            <div class="field-hint">Your tax bracket determines how much you save on a pre-tax lease, super sacrifice, or mortgage offset.</div>
          </div>
        </div>

        <!-- Tool-Specific Inputs -->
        ${tool === 'car' ? renderCarInputs(c) : ''}
        ${tool === 'rentbuy' ? renderRentBuyInputs(c) : ''}
        ${tool === 'whatif' ? renderWhatIfInputs(c) : ''}
      </div>
    </section>
  `;
}

function renderCarInputs(c) {
  const car = decState.car;
  return `
    <div class="prop-core-grid">
      <div class="sub-field">
        <label class="sub-label" for="car-evprice-input">Electric Vehicle (EV) Drive-Away Price</label>
        <div class="input-combo compact">
          <span class="input-prefix">${escapeHtml(c.symbol)}</span>
          <input type="number" id="car-evprice-input" class="num-input" min="5000" step="1000" value="${car.evPrice}" />
        </div>
        <div class="field-hint">${c.code === 'AU' ? 'FBT-exempt in AU up to $91,387 LCT threshold' : 'Compare against petrol car price →'}</div>
      </div>

      <div class="sub-field">
        <label class="sub-label" for="car-petrolprice-input">Comparable Petrol / Hybrid Car Price</label>
        <div class="input-combo compact">
          <span class="input-prefix">${escapeHtml(c.symbol)}</span>
          <input type="number" id="car-petrolprice-input" class="num-input" min="5000" step="1000" value="${car.petrolPrice}" />
        </div>
        <div class="field-hint">Can be same price or lower than EV</div>
      </div>

      <div class="sub-field">
        <label class="sub-label" for="car-years-select">Lease / Loan Term</label>
        <select id="car-years-select" class="select-input">
          ${[1, 2, 3, 4, 5]
            .map((y) => `<option value="${y}" ${Number(car.leaseYears) === y ? 'selected' : ''}>${y} ${y === 1 ? 'Year' : 'Years'}</option>`)
            .join('')}
        </select>
      </div>

      <div class="sub-field">
        <label class="sub-label" for="car-km-input">Distance Driven per Year (km)</label>
        <input type="number" id="car-km-input" class="text-input" min="2000" max="80000" step="1000" value="${car.annualKm}" />
        <div class="field-hint">Drives fuel vs home-charging savings</div>
      </div>

      <div class="sub-field">
        <label class="sub-label" for="car-rate-input">Lease / Loan Finance Rate (%)</label>
        <input type="number" id="car-rate-input" class="text-input" min="0" max="20" step="0.2" value="${car.financeRatePct}" />
      </div>

      <div class="sub-field">
        <label class="sub-label" for="car-petrolcost-input">Petrol Price (${escapeHtml(c.symbol)}/Litre) vs Home EV (${escapeHtml(c.symbol)}/kWh)</label>
        <div class="two-col-fields">
          <input type="number" id="car-petrolcost-input" class="text-input" min="0.5" max="200" step="0.05" value="${car.petrolCostPerLiter}" title="Petrol price per litre" />
          <input type="number" id="car-eleccost-input" class="text-input" min="0.05" max="50" step="0.02" value="${car.electricityCostPerKwh}" title="Electricity cost per kWh" />
        </div>
      </div>
    </div>
    ${
      c.code === 'AU'
        ? `
      <div class="toggle-grid" style="margin-top:4px;">
        <label class="toggle-row">
          <input type="checkbox" id="car-hecs-checkbox" ${car.hasHecs ? 'checked' : ''} />
          <span>I have a HECS-HELP student loan (models ATO Reportable Fringe Benefit add-back on EV leases)</span>
        </label>
      </div>
    `
        : ''
    }
  `;
}

function renderRentBuyInputs(c) {
  const rb = decState.rentBuy;
  return `
    <div class="prop-core-grid">
      <div class="sub-field">
        <label class="sub-label" for="rb-homeprice-input">Home Price You’d Buy</label>
        <div class="input-combo compact">
          <span class="input-prefix">${escapeHtml(c.symbol)}</span>
          <input type="number" id="rb-homeprice-input" class="num-input" min="50000" step="10000" value="${rb.homePrice}" />
        </div>
      </div>

      <div class="sub-field">
        <label class="sub-label" for="rb-deposit-input">Your Saved Deposit</label>
        <div class="input-combo compact">
          <span class="input-prefix">${escapeHtml(c.symbol)}</span>
          <input type="number" id="rb-deposit-input" class="num-input" min="0" step="5000" value="${rb.depositSaved}" />
        </div>
        <div class="field-hint">If renting, this deposit is invested in ETFs instead</div>
      </div>

      <div class="sub-field">
        <label class="sub-label" for="rb-rate-input">Home Mortgage Interest Rate (%)</label>
        <input type="number" id="rb-rate-input" class="text-input" min="0.5" max="18" step="0.1" value="${rb.mortgageRatePct}" />
      </div>

      <div class="sub-field">
        <label class="sub-label" for="rb-rent-input">Weekly Rent for Equivalent Home</label>
        <div class="input-combo compact">
          <span class="input-prefix">${escapeHtml(c.symbol)}</span>
          <input type="number" id="rb-rent-input" class="num-input" min="50" step="20" value="${rb.weeklyRent}" />
          <span class="input-suffix">/ wk</span>
        </div>
      </div>

      <div class="sub-field">
        <label class="sub-label" for="rb-homegrowth-input">Expected Home Price Growth (%/yr)</label>
        <input type="number" id="rb-homegrowth-input" class="text-input" min="-5" max="15" step="0.2" value="${rb.homeGrowthPct}" />
        <div class="field-hint">0% Capital Gains Tax on primary residence</div>
      </div>

      <div class="sub-field">
        <label class="sub-label" for="rb-etfreturn-input">Expected ETF Portfolio Return (%/yr)</label>
        <input type="number" id="rb-etfreturn-input" class="text-input" min="0" max="18" step="0.2" value="${rb.etfReturnPct}" />
        <div class="field-hint">Compounds deposit + monthly savings difference</div>
      </div>
    </div>
  `;
}

function renderWhatIfInputs(c) {
  const wi = decState.whatIf;
  return `
    <div class="prop-core-grid">
      <div class="sub-field">
        <label class="sub-label" for="wi-surplus-input">Extra Monthly Take-Home You Can Save</label>
        <div class="input-combo compact">
          <span class="input-prefix">${escapeHtml(c.symbol)}</span>
          <input type="number" id="wi-surplus-input" class="num-input" min="50" step="100" value="${wi.monthlySurplus}" />
          <span class="input-suffix">/ mo</span>
        </div>
      </div>

      <div class="sub-field">
        <label class="sub-label" for="wi-offset-input">Your Mortgage Offset Interest Rate (%)</label>
        <input type="number" id="wi-offset-input" class="text-input" min="0" max="15" step="0.1" value="${wi.mortgageOffsetRatePct}" />
        <div class="field-hint">100% tax-free interest saved</div>
      </div>

      <div class="sub-field">
        <label class="sub-label" for="wi-etf-input">Expected Index ETF Return (%/yr)</label>
        <input type="number" id="wi-etf-input" class="text-input" min="0" max="18" step="0.2" value="${wi.etfReturnPct}" />
      </div>

      <div class="sub-field">
        <label class="sub-label" for="wi-super-input">Expected ${escapeHtml(c.retirementLabel)} Fund Return (%/yr)</label>
        <input type="number" id="wi-super-input" class="text-input" min="0" max="18" step="0.2" value="${wi.superReturnPct}" />
      </div>

      <div class="sub-field">
        <label class="sub-label" for="wi-years-input">Investment Time Horizon (Years)</label>
        <input type="number" id="wi-years-input" class="text-input" min="1" max="30" step="1" value="${wi.horizonYears}" />
      </div>
    </div>
  `;
}

function renderDecisionResults() {
  if (decState.activeTool === 'car') {
    renderCarResults();
  } else if (decState.activeTool === 'rentbuy') {
    renderRentBuyResults();
  } else {
    renderWhatIfResults();
  }
}

function renderCarResults() {
  const res = calculateCarDecision(decState);
  const { country, years, options, energyComparison } = res;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);

  const ev = options.evNovated;
  const pet = options.petrolNovated;
  const loan = options.personalLoan;
  const cash = options.cashEv;

  const evVsPetSavings = pet.totalCostToOwnAfterTerm - ev.totalCostToOwnAfterTerm;
  const evVsLoanSavings = loan.totalCostToOwnAfterTerm - ev.totalCostToOwnAfterTerm;

  els.resultsRoot.innerHTML = `
    <!-- SECTION 02: NOVATED LEASE & EV VS PETROL VERDICT -->
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">02</span>
        <div class="section-divider-text">
          <h2 class="section-heading">Novated Lease &amp; EV vs Petrol Verdict (${years} Years)</h2>
          <p class="section-sub">What each option actually costs out of your take-home pay, including fuel, rego, servicing, tax savings, and end-of-lease residual.</p>
        </div>
        <span class="comp-pill ${res.evEligibleFbtExempt ? 'comp-low' : 'comp-mod'}">
          ${res.evEligibleFbtExempt ? '100% FBT-Exempt EV Eligible' : 'Standard ECM Tax Rules'}
        </span>
      </div>

      <div class="card hero-card">
        <div class="take-home-spotlight" style="padding-top:4px;">
          <div class="spotlight-label">Real Weekly Cost Out of Your Take-Home Pay (EV Novated Lease)</div>
          <div class="hero-net-value net-col">
            ${fmt(ev.weeklyNetCost)} <span class="hero-period-unit">per week</span>
            <span class="hero-period-unit">(${fmt(ev.monthlyNetCost)}/month all-inclusive)</span>
          </div>
          <p class="plain-english-summary">
            Because ${res.evEligibleFbtExempt ? `electric cars under ${fmt(res.auLctThreshold)} are exempt from Fringe Benefits Tax (FBT)` : 'pre-tax salary packaging reduces your taxable income'}, your lease payment AND all running costs (charging, insurance, rego, servicing, tyres) come out before tax — saving you <strong>${fmt(ev.totalTaxAndGstSaved)}</strong> in income tax &amp; GST over ${years} years.
            Compared to a <strong>${fmt(decState.car.petrolPrice)} petrol car</strong>, the EV novated lease leaves you <strong>${evVsPetSavings >= 0 ? `${fmt(evVsPetSavings)} ahead` : `${fmt(Math.abs(evVsPetSavings))} behind`}</strong> vs a petrol novated lease, and <strong>${fmt(Math.abs(evVsLoanSavings))} ${evVsLoanSavings >= 0 ? 'ahead' : 'behind'}</strong> vs a post-tax car loan.
          </p>
        </div>

        <!-- 4-Way Comparison Cards -->
        <div class="car-options-grid">
          <div class="reality-metric highlight">
            <div class="reality-label">1. ${escapeHtml(ev.title)}</div>
            <div class="reality-big net-col">${fmt(ev.weeklyNetCost)}<span class="unit">/wk net</span></div>
            <div class="reality-sub"><strong>${fmt(ev.monthlyNetCost)}/mo</strong> out of take-home pay</div>
            <div class="reality-sub">Tax &amp; GST saved: <strong class="net-col">+${fmt(ev.totalTaxAndGstSaved)}</strong></div>
            <div class="reality-sub">End balloon (${years}y): <strong>${fmt(ev.residualBuyout)}</strong></div>
            <div class="reality-sub" style="margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">
              Total ${years}-yr cost to own: <strong>${fmt(ev.totalCostToOwnAfterTerm)}</strong>
            </div>
          </div>

          <div class="reality-metric">
            <div class="reality-label">2. ${escapeHtml(pet.title)}</div>
            <div class="reality-big">${fmt(pet.weeklyNetCost)}<span class="unit">/wk net</span></div>
            <div class="reality-sub"><strong>${fmt(pet.monthlyNetCost)}/mo</strong> out of take-home pay</div>
            <div class="reality-sub">Tax &amp; GST saved: <strong>+${fmt(pet.totalTaxAndGstSaved)}</strong></div>
            <div class="reality-sub">End balloon (${years}y): <strong>${fmt(pet.residualBuyout)}</strong></div>
            <div class="reality-sub" style="margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">
              Total ${years}-yr cost to own: <strong>${fmt(pet.totalCostToOwnAfterTerm)}</strong>
            </div>
          </div>

          <div class="reality-metric">
            <div class="reality-label">3. ${escapeHtml(loan.title)}</div>
            <div class="reality-big">${fmt(loan.weeklyNetCost)}<span class="unit">/wk net</span></div>
            <div class="reality-sub"><strong>${fmt(loan.monthlyNetCost)}/mo</strong> from post-tax pay</div>
            <div class="reality-sub">Tax &amp; GST saved: <strong>${fmt(0)}</strong></div>
            <div class="reality-sub">End balloon: <strong>${fmt(0)} (paid off)</strong></div>
            <div class="reality-sub" style="margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">
              Total ${years}-yr cost to own: <strong>${fmt(loan.totalCostToOwnAfterTerm)}</strong>
            </div>
          </div>

          <div class="reality-metric">
            <div class="reality-label">4. ${escapeHtml(cash.title)}</div>
            <div class="reality-big">${fmt(cash.weeklyNetCost)}<span class="unit">/wk running</span></div>
            <div class="reality-sub">Upfront cash: <strong>${fmt(decState.car.evPrice)}</strong></div>
            <div class="reality-sub">Lost offset interest: <strong class="tax-color">−${fmt(cash.lostOffsetInterestOverTerm)}</strong></div>
            <div class="reality-sub">End balloon: <strong>${fmt(0)} (owned)</strong></div>
            <div class="reality-sub" style="margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">
              Total ${years}-yr cost (incl. lost offset): <strong>${fmt(cash.totalCostToOwnAfterTerm)}</strong>
            </div>
          </div>
        </div>

        <!-- Fuel vs Home Electricity Savings Strip -->
        <div class="driver-note" style="margin-top:18px;">
          <strong>⚡ EV Charging vs Petrol Fuel (${res.annualKm.toLocaleString()} km/yr):</strong>
          Home EV charging costs roughly <strong>${fmt(energyComparison.evEnergyAnnual)}/yr</strong> vs <strong>${fmt(energyComparison.petrolFuelAnnual)}/yr</strong> for petrol — saving you <strong>${fmt(energyComparison.annualFuelSavings)}/yr</strong> (<strong>${fmt(energyComparison.termFuelSavings)}</strong> over ${years} years) in energy alone, before counting lower EV servicing costs.
        </div>

        ${
          res.extraHecsFromRfba > 0
            ? `
          <div class="reassure-note" style="margin-top:14px;">
            <strong>🎓 Important HECS-HELP Note (Already factored into your numbers above!):</strong>
            Even though an eligible EV novated lease is exempt from FBT, the ATO still records a <em>Reportable Fringe Benefits Amount</em> on your income statement, which adds <strong>${fmt(res.extraHecsFromRfba)}/yr</strong> to your HECS-HELP repayment. We’ve already subtracted that above so there are no surprises at tax time.
          </div>
        `
            : ''
        }
      </div>
    </section>
  `;
}

function renderRentBuyResults() {
  const res = calculateRentVsBuy(decState);
  const { country, holdingYears, timeline } = res;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);
  const buyerWins = res.netDifference >= 0;

  els.resultsRoot.innerHTML = `
    <!-- SECTION 02: RENT VS BUY VERDICT -->
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">02</span>
        <div class="section-divider-text">
          <h2 class="section-heading">Rent vs Buy Verdict (Over ${holdingYears} Years)</h2>
          <p class="section-sub">Comparing your net home equity (0% Main Residence CGT) against investing your deposit and monthly cash difference into index ETFs.</p>
        </div>
        <span class="comp-pill comp-low">
          ${res.breakevenYear ? `Buying breaks even in Year ${res.breakevenYear}` : `Rent + Invest leads through Year ${holdingYears}`}
        </span>
      </div>

      <div class="card hero-card">
        <div class="take-home-spotlight" style="padding-top:4px;">
          <div class="spotlight-label">${buyerWins ? 'Buying Comes Out Ahead After' : 'Renting + Investing in ETFs Comes Out Ahead After'} ${holdingYears} Years</div>
          <div class="hero-net-value net-col">
            +${fmt(Math.abs(res.netDifference))} <span class="hero-period-unit">net wealth advantage</span>
          </div>
          <p class="plain-english-summary">
            In Year 1, buying costs <strong>${fmt(res.year1BuyerMonthlyOutflow)}/month</strong> (mortgage + rates/strata/upkeep) plus <strong>${fmt(res.stampDuty)}</strong> in upfront stamp duty/buying costs, while renting costs <strong>${fmt(res.year1RenterMonthlyRent)}/month</strong>.
            If the renter invests the saved deposit, stamp duty, and monthly cashflow difference into index ETFs at <strong>${decState.rentBuy.etfReturnPct}%/yr</strong>, after ${holdingYears} years the homeowner has <strong>${fmt(res.finalBuyerNetWealth)}</strong> in tax-free home equity vs <strong>${fmt(res.finalRenterNetWealth)}</strong> in the renter’s ETF portfolio (after Capital Gains Tax).
          </p>
        </div>

        <div class="pay-comparison-boxes" style="margin-top:10px;">
          <div class="pay-mode-box">
            <div class="pay-mode-tag">Path A · Buy the Home</div>
            <div class="pay-mode-main">${fmt(res.finalBuyerNetWealth)} <span class="unit">net equity (Yr ${holdingYears})</span></div>
            <div class="pay-mode-takehome">Year-1 monthly outlay: <strong>${fmt(res.year1BuyerMonthlyOutflow)}/mo</strong> (Mortgage: ${fmt(res.monthlyMortgage)}/mo)</div>
            <div class="pay-mode-range">Tax treatment on exit: <strong>0% Capital Gains Tax (Main Residence Exemption)</strong></div>
          </div>

          <div class="pay-mode-box contractor-box">
            <div class="pay-mode-tag">Path B · Rent &amp; Invest Difference in ETFs</div>
            <div class="pay-mode-main">${fmt(res.finalRenterNetWealth)} <span class="unit">net ETF portfolio (Yr ${holdingYears})</span></div>
            <div class="pay-mode-takehome">Year-1 monthly rent: <strong>${fmt(res.year1RenterMonthlyRent)}/mo</strong> (+ invests ${fmt(Math.max(0, res.year1BuyerMonthlyOutflow - res.year1RenterMonthlyRent))}/mo difference)</div>
            <div class="pay-mode-range">Starts with <strong>${fmt(decState.rentBuy.depositSaved + res.stampDuty)}</strong> (deposit + saved stamp duty) compounding in ETFs</div>
          </div>
        </div>

        <h3 class="mini-section-title" style="margin-top:24px;">Year-by-Year Net Wealth Comparison (Homeowner Equity vs Renter ETF Portfolio)</h3>
        <div class="table-scroll">
          <table class="freq-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Home Value</th>
                <th>Remaining Mortgage</th>
                <th>Buyer Net Equity (0% CGT)</th>
                <th>Renter ETF Portfolio (After CGT)</th>
                <th>Net Winner</th>
              </tr>
            </thead>
            <tbody>
              ${timeline
                .map(
                  (row) => `
                <tr>
                  <td><strong>Year ${row.year}</strong></td>
                  <td>${fmt(row.homeValue)}</td>
                  <td>${fmt(row.remainingLoan)}</td>
                  <td class="${row.advantageBuyer >= 0 ? 'net-col' : ''}"><strong>${fmt(row.buyerNetEquity)}</strong></td>
                  <td class="${row.advantageBuyer < 0 ? 'net-col' : ''}"><strong>${fmt(row.renterNetWealthAfterCgt)}</strong></td>
                  <td>${row.advantageBuyer >= 0 ? `Buy (+${fmt(row.advantageBuyer)})` : `Rent+ETF (+${fmt(Math.abs(row.advantageBuyer))})`}</td>
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

function renderWhatIfResults() {
  const res = calculateWhatIfScenarios(decState);
  const { country, surplusAllocation: sa, partTimeCushion } = res;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);

  const fourDay = partTimeCushion[1]; // 4 days/week

  els.resultsRoot.innerHTML = `
    <!-- SECTION 02: WHERE SHOULD MY EXTRA MONTHLY SAVINGS GO? -->
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">02</span>
        <div class="section-divider-text">
          <h2 class="section-heading">Playbook A — Where Should Your Extra ${fmt(sa.monthlySurplus)}/Month Go?</h2>
          <p class="section-sub">Comparing 3 ways to put the exact same ${fmt(sa.monthlySurplus)}/month of take-home pay to work over ${sa.years} years.</p>
        </div>
      </div>

      <div class="card hero-card">
        <p class="plain-english-summary" style="margin-top:0; margin-bottom:20px;">
          If you commit <strong>${fmt(sa.monthlySurplus)}/month</strong> out of your take-home pocket (${fmt(sa.totalOutOfPocketContributed)} total over ${sa.years} years), your tax bracket creates three very different outcomes:
        </p>

        <div class="reality-grid">
          <div class="reality-metric">
            <div class="reality-label">1. Mortgage Offset Account (${decState.whatIf.mortgageOffsetRatePct}%)</div>
            <div class="reality-big">${fmt(sa.offset.finalValue)}</div>
            <div class="reality-sub">Tax-free interest saved: <strong class="net-col">+${fmt(sa.offset.netGain)}</strong></div>
            <div class="reality-sub">Because offset savings aren’t taxed, ${decState.whatIf.mortgageOffsetRatePct}% equals earning <strong>${sa.offset.preTaxEquivalentRatePct}% pre-tax</strong> in a savings account, with 100% instant access to your cash.</div>
          </div>

          <div class="reality-metric highlight">
            <div class="reality-label">2. Pre-Tax ${escapeHtml(country.retirementLabel)} Sacrifice</div>
            <div class="reality-big net-col">${fmt(sa.superSacrifice.finalValue)}</div>
            <div class="reality-sub">Net wealth gain over pocket cost: <strong class="net-col">+${fmt(sa.superSacrifice.netGain)}</strong></div>
            <div class="reality-sub">Giving up ${fmt(sa.monthlySurplus)}/mo of take-home lets you put <strong>${fmt(sa.superSacrifice.annualIntoFundAfterTax / 12)}/mo</strong> straight into ${escapeHtml(country.retirementLabel)} thanks to upfront tax savings (locked until retirement age).</div>
          </div>

          <div class="reality-metric">
            <div class="reality-label">3. Index ETF Portfolio (${decState.whatIf.etfReturnPct}%/yr)</div>
            <div class="reality-big">${fmt(sa.etf.finalValue)}</div>
            <div class="reality-sub">After-CGT gain: <strong class="net-col">+${fmt(sa.etf.netGain)}</strong></div>
            <div class="reality-sub">Invested from post-tax pay with long-term capital gains discount and full flexibility to sell whenever you want before retirement.</div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION 03: 4-DAY WORK WEEK & PART-TIME PROGRESSIVE TAX CUSHION -->
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">03</span>
        <div class="section-divider-text">
          <h2 class="section-heading">Playbook B — What If You Switch to a 4-Day Work Week?</h2>
          <p class="section-sub">Because progressive tax takes the biggest bite out of your last day of the week, working 20% less costs much less than 20% of your take-home pay.</p>
        </div>
      </div>

      <div class="card">
        <p class="plain-english-summary" style="margin-top:0; margin-bottom:20px;">
          On a <strong>${fmt(decState.salary)}</strong> full-time salary, dropping from <strong>5 days to 4 days a week</strong> cuts your working hours by <strong>20%</strong>, but you still keep <strong>${fourDay.netRatioPct}% of your take-home pay</strong> (${fmt(fourDay.netMonthly)}/month — a drop of ${fmt(fourDay.monthlyDrop)}/month for 52 extra three-day weekends a year).
        </p>

        <div class="table-scroll">
          <table class="freq-table">
            <thead>
              <tr>
                <th>Work Schedule</th>
                <th>Work Time</th>
                <th>Gross Salary</th>
                <th>Overall Tax Rate</th>
                <th>Monthly Take-Home</th>
                <th>Share of Full-Time Take-Home Kept</th>
              </tr>
            </thead>
            <tbody>
              ${partTimeCushion
                .map(
                  (row) => `
                <tr class="${row.days === 4 ? 'active-row' : ''}">
                  <td><strong>${row.days} Days / Week (${row.days === 5 ? 'Full-Time' : `${row.fteRatio.toFixed(1)} FTE`})</strong></td>
                  <td>${row.grossRatioPct}%</td>
                  <td>${fmt(row.grossAnnual)}/yr</td>
                  <td>${(row.effectiveTaxRate * 100).toFixed(1)}%</td>
                  <td class="net-col"><strong>${fmt(row.netMonthly)}/mo</strong></td>
                  <td><strong>${row.netRatioPct}% kept</strong> ${row.days < 5 ? `(−${fmt(row.monthlyDrop)}/mo)` : ''}</td>
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

function bindEvents() {
  els.themeBtn?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });

  els.aiForm.addEventListener('submit', (e) => {
    e.preventDefault();
    parseDecisionPrompt(els.aiInput.value);
  });

  els.aiChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-example-idx]');
    if (!btn) return;
    const ex = EXAMPLE_PROMPTS[Number(btn.dataset.exampleIdx)];
    if (!ex) return;
    els.aiInput.value = ex.prompt;
    parseDecisionPrompt(ex.prompt);
  });

  els.aiFeedback.addEventListener('click', (e) => {
    if (e.target.closest('#dismiss-dec-feedback')) {
      decState.lastParsed = null;
      renderAiFeedback();
    }
  });

  els.formRoot.addEventListener('click', (e) => {
    const toolBtn = e.target.closest('[data-tool]');
    if (toolBtn) {
      decState.activeTool = toolBtn.dataset.tool;
      renderAll();
      return;
    }

    const countryBtn = e.target.closest('[data-country]');
    if (countryBtn) {
      const newCode = countryBtn.dataset.country;
      if (COUNTRIES[newCode] && newCode !== decState.country) {
        const prevTool = decState.activeTool;
        decState = {
          ...defaultDecisionsState(newCode),
          activeTool: prevTool,
        };
        renderAll();
      }
    }
  });

  els.formRoot.addEventListener('input', (e) => {
    const t = e.target;
    const val = Math.max(0, Number(t.value) || 0);
    if (t.id === 'dec-salary-input') decState.salary = val;
    else if (t.id === 'car-evprice-input') decState.car.evPrice = val;
    else if (t.id === 'car-petrolprice-input') decState.car.petrolPrice = val;
    else if (t.id === 'car-km-input') decState.car.annualKm = val;
    else if (t.id === 'car-rate-input') decState.car.financeRatePct = Number(t.value) || 0;
    else if (t.id === 'car-petrolcost-input') decState.car.petrolCostPerLiter = Number(t.value) || 0;
    else if (t.id === 'car-eleccost-input') decState.car.electricityCostPerKwh = Number(t.value) || 0;
    else if (t.id === 'rb-homeprice-input') decState.rentBuy.homePrice = val;
    else if (t.id === 'rb-deposit-input') decState.rentBuy.depositSaved = val;
    else if (t.id === 'rb-rate-input') decState.rentBuy.mortgageRatePct = Number(t.value) || 0;
    else if (t.id === 'rb-rent-input') decState.rentBuy.weeklyRent = val;
    else if (t.id === 'rb-homegrowth-input') decState.rentBuy.homeGrowthPct = Number(t.value) || 0;
    else if (t.id === 'rb-etfreturn-input') decState.rentBuy.etfReturnPct = Number(t.value) || 0;
    else if (t.id === 'wi-surplus-input') decState.whatIf.monthlySurplus = val;
    else if (t.id === 'wi-offset-input') decState.whatIf.mortgageOffsetRatePct = Number(t.value) || 0;
    else if (t.id === 'wi-etf-input') decState.whatIf.etfReturnPct = Number(t.value) || 0;
    else if (t.id === 'wi-super-input') decState.whatIf.superReturnPct = Number(t.value) || 0;
    else if (t.id === 'wi-years-input') decState.whatIf.horizonYears = Math.max(1, val || 10);
    renderResultsOnly();
  });

  els.formRoot.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'car-years-select') {
      decState.car.leaseYears = Number(t.value) || 4;
      renderResultsOnly();
    } else if (t.id === 'car-hecs-checkbox') {
      decState.car.hasHecs = t.checked;
      renderResultsOnly();
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
