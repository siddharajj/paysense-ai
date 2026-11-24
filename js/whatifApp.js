/**
 * PaySense — Home (Rent vs Buy) & Smart What-If Playbooks Controller (whatif.html)
 * Uses Global Country Header + Compact Split Stage + Pop-Up Year-by-Year Table Modal.
 */

import { COUNTRIES } from './tax/countries.js';
import { formatCurrency } from './tax/brackets.js';
import {
  defaultDecisionsState,
  calculateRentVsBuy,
  calculateWhatIfScenarios,
} from './tax/decisionsEngine.js';
import {
  initGlobalHeader,
  getGlobalCountry,
  setGlobalCountry,
  openPopupModal,
} from './ui/globalHeader.js';

const EXAMPLE_PROMPTS = [
  {
    label: '🏡 Rent $720/wk vs Buy $850k home ($170k deposit)',
    prompt: 'Should I buy a $850k home with $170k deposit at 6.1% or rent for $720/wk over 10 years?',
  },
  {
    label: '💰 Extra $1,200/mo: Offset at 6.2% vs Super vs ETFs',
    prompt: 'I have an extra $1200/month on $150k salary — mortgage offset at 6.2% vs super vs ETFs over 10 years?',
  },
  {
    label: '⏳ Switch to a 4-day work week on $140k salary',
    prompt: 'What if I switch to a 4-day work week on $140k salary?',
  },
];

let wiState = {
  ...defaultDecisionsState(getGlobalCountry()),
  stageView: 'rentbuy', // 'rentbuy' | 'surplus' | 'fourday'
  lastParsed: null,
};

const els = {
  formRoot: document.getElementById('wi-form-root'),
  resultsRoot: document.getElementById('wi-results-root'),
  aiForm: document.getElementById('wi-ai-form'),
  aiInput: document.getElementById('wi-ai-input'),
  aiChips: document.getElementById('wi-example-chips'),
  aiFeedback: document.getElementById('wi-ai-feedback'),
  toast: document.getElementById('toast'),
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function switchCountry(newCode) {
  if (!COUNTRIES[newCode] || newCode === wiState.country) return;
  setGlobalCountry(newCode);
  const prevView = wiState.stageView;
  wiState = {
    ...defaultDecisionsState(newCode),
    stageView: prevView,
    lastParsed: null,
  };
  renderAll();
}

function parseWhatIfPrompt(rawText) {
  const text = (rawText || '').trim();
  if (!text) return;

  const tags = [];
  const c = COUNTRIES[wiState.country];
  const fmt = (n) => formatCurrency(n, c.currency, c.locale);
  tags.push(`${c.flag} ${c.name}`);

  if (/\b(4[- ]?day|part[- ]?time|days?\s+a\s+week)\b/i.test(text)) {
    wiState.stageView = 'fourday';
    tags.push('4-Day Work Week');
  } else if (/\b(extra|surplus|offset|super|401k|etf)\b/i.test(text) && !/\b(rent|buy|home|house|deposit)\b/i.test(text)) {
    wiState.stageView = 'surplus';
    tags.push('Extra Monthly Savings');
  } else {
    wiState.stageView = 'rentbuy';
    tags.push('Rent vs Buy Home');
  }

  const salMatch = text.match(/(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lakh|lpa|cr)?\s*(?:salary|income|pay)|(?:on|earning)\s+(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lakh|lpa|cr)\b/i);
  if (salMatch) {
    const val = parseMoney(salMatch[1] || salMatch[3], salMatch[2] || salMatch[4]);
    if (val && val > 10000) {
      wiState.salary = val;
      tags.push(`Salary: ${fmt(val)}`);
    }
  }

  const homeMatch = text.match(/(?:buy\s+a?\s*)?(?:[$£₹]|s\$)\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|cr)?\s*(?:home|house|apartment|unit|property)/i);
  if (homeMatch) {
    const val = parseMoney(homeMatch[1], homeMatch[2]);
    if (val && val > 50000) {
      wiState.rentBuy.homePrice = val;
      tags.push(`Home: ${fmt(val)}`);
    }
  }

  const depMatch = text.match(/(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|cr)?\s*deposit/i);
  if (depMatch) {
    const val = parseMoney(depMatch[1], depMatch[2]);
    if (val !== null) {
      wiState.rentBuy.depositSaved = val;
      tags.push(`Deposit: ${fmt(val)}`);
    }
  }

  const rentMatch = text.match(/rent\s+(?:for\s+)?(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:\/\s*|per\s+)?(wk|week|mo|month)?/i);
  if (rentMatch) {
    const val = parseMoney(rentMatch[1], rentMatch[2]);
    const unit = (rentMatch[3] || 'wk').toLowerCase();
    if (val && val > 0) {
      wiState.rentBuy.weeklyRent = unit.startsWith('m') ? Math.round((val * 12) / 52) : Math.round(val);
      tags.push(`Rent: ${fmt(wiState.rentBuy.weeklyRent)}/wk`);
    }
  }

  const surMatch = text.match(/(?:extra|surplus|save|invest)\s+(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:\/\s*|per\s+)?(?:mo|month)?/i);
  if (surMatch) {
    const val = parseMoney(surMatch[1], surMatch[2]);
    if (val && val > 0) {
      wiState.whatIf.monthlySurplus = val;
      tags.push(`Extra: ${fmt(val)}/mo`);
    }
  }

  if (wiState.stageView === 'rentbuy') {
    const res = calculateRentVsBuy(wiState);
    const buyerWins = res.netDifference >= 0;
    wiState.lastParsed = {
      tags,
      summary: `Over ${res.holdingYears} years, ${buyerWins ? 'Buying the home' : 'Renting & investing in ETFs'} leads by ${fmt(Math.abs(res.netDifference))}.`,
    };
  } else {
    const res = calculateWhatIfScenarios(wiState);
    const fourDay = res.partTimeCushion[1];
    wiState.lastParsed = {
      tags,
      summary: `A 4-day week (80% hours) keeps ${fourDay.netRatioPct}% of your take-home pay (${fmt(fourDay.netMonthly)}/mo).`,
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
  if (!wiState.lastParsed) {
    els.aiFeedback.hidden = true;
    els.aiFeedback.innerHTML = '';
    return;
  }
  const { tags, summary } = wiState.lastParsed;
  els.aiFeedback.hidden = false;
  els.aiFeedback.innerHTML = `
    <div class="ai-feedback-inner animate-stage">
      <div class="ai-feedback-top">
        <span class="ai-source-badge">Updated Scenario</span>
        <div class="parsed-tags-wrap">
          ${tags.map((t) => `<span class="parsed-tag">${escapeHtml(t)}</span>`).join('')}
        </div>
        <button type="button" class="icon-btn" id="dismiss-wi-feedback" title="Dismiss">✕</button>
      </div>
      <div class="ai-reply-text">${escapeHtml(summary)}</div>
    </div>
  `;
}

function renderAll() {
  renderForm();
  renderResults();
  renderAiFeedback();
}

function renderForm() {
  const c = COUNTRIES[wiState.country] || COUNTRIES.AU;
  const view = wiState.stageView;
  const rb = wiState.rentBuy;
  const wi = wiState.whatIf;

  els.formRoot.innerHTML = `
    <div class="card compact-form-card">
      <div class="compact-form-header">
        <span class="section-num">01</span>
        <div>
          <h2 class="compact-form-title">Scenario Setup</h2>
          <div class="muted" style="font-size:0.78rem;" id="global-tax-year-badge">${c.flag} ${escapeHtml(c.name)} · ${escapeHtml(c.taxYear)}</div>
        </div>
      </div>

      <div class="setup-block">
        <label class="sub-label" for="wi-salary-input">Your Annual Gross Salary</label>
        <div class="input-combo compact">
          <span class="input-prefix">${escapeHtml(c.symbol)}</span>
          <input type="number" id="wi-salary-input" class="num-input" min="0" step="2000" value="${wiState.salary}" />
          <span class="input-suffix">/ yr</span>
        </div>
      </div>

      ${
        view === 'rentbuy'
          ? `
        <div class="setup-block">
          <label class="sub-label" for="rb-homeprice-input">Home Price to Buy</label>
          <div class="input-combo compact">
            <span class="input-prefix">${escapeHtml(c.symbol)}</span>
            <input type="number" id="rb-homeprice-input" class="num-input" min="50000" step="10000" value="${rb.homePrice}" />
          </div>
        </div>
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="rb-deposit-input">Saved Deposit</label>
            <div class="input-combo compact">
              <span class="input-prefix">${escapeHtml(c.symbol)}</span>
              <input type="number" id="rb-deposit-input" class="num-input" min="0" step="5000" value="${rb.depositSaved}" />
            </div>
          </div>
          <div class="sub-field">
            <label class="sub-label" for="rb-rent-input">Weekly Rent</label>
            <div class="input-combo compact">
              <span class="input-prefix">${escapeHtml(c.symbol)}</span>
              <input type="number" id="rb-rent-input" class="num-input" min="50" step="20" value="${rb.weeklyRent}" />
            </div>
          </div>
        </div>
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="rb-rate-input">Mortgage Rate (%)</label>
            <input type="number" id="rb-rate-input" class="text-input" min="0.5" max="18" step="0.1" value="${rb.mortgageRatePct}" />
          </div>
          <div class="sub-field">
            <label class="sub-label" for="rb-etfreturn-input">ETF Return (%/yr)</label>
            <input type="number" id="rb-etfreturn-input" class="text-input" min="0" max="18" step="0.2" value="${rb.etfReturnPct}" />
          </div>
        </div>
      `
          : `
        <div class="setup-block">
          <label class="sub-label" for="wi-surplus-input">Extra Monthly Savings</label>
          <div class="input-combo compact">
            <span class="input-prefix">${escapeHtml(c.symbol)}</span>
            <input type="number" id="wi-surplus-input" class="num-input" min="50" step="100" value="${wi.monthlySurplus}" />
            <span class="input-suffix">/ mo</span>
          </div>
        </div>
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="wi-offset-input">Offset Rate (%)</label>
            <input type="number" id="wi-offset-input" class="text-input" min="0" max="15" step="0.1" value="${wi.mortgageOffsetRatePct}" />
          </div>
          <div class="sub-field">
            <label class="sub-label" for="wi-etf-input">ETF Return (%)</label>
            <input type="number" id="wi-etf-input" class="text-input" min="0" max="18" step="0.2" value="${wi.etfReturnPct}" />
          </div>
        </div>
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="wi-super-input">${escapeHtml(c.retirementLabel)} Return (%)</label>
            <input type="number" id="wi-super-input" class="text-input" min="0" max="18" step="0.2" value="${wi.superReturnPct}" />
          </div>
          <div class="sub-field">
            <label class="sub-label" for="wi-years-input">Horizon (Years)</label>
            <input type="number" id="wi-years-input" class="text-input" min="1" max="30" step="1" value="${wi.horizonYears}" />
          </div>
        </div>
      `
      }
    </div>
  `;
}

function renderResults() {
  const view = wiState.stageView;
  els.resultsRoot.innerHTML = `
    <div class="stage-nav-bar">
      <div class="stage-tabs" role="tablist">
        <button type="button" class="stage-tab ${view === 'rentbuy' ? 'active' : ''}" data-stage-view="rentbuy">
          02 · Home: Rent vs Buy
        </button>
        <button type="button" class="stage-tab ${view === 'surplus' ? 'active' : ''}" data-stage-view="surplus">
          03 · Extra Savings: Offset vs Super vs ETF
        </button>
        <button type="button" class="stage-tab ${view === 'fourday' ? 'active' : ''}" data-stage-view="fourday">
          04 · 4-Day Work Week Cushion
        </button>
      </div>
    </div>

    <div class="card stage-card animate-stage">
      ${view === 'rentbuy' ? renderRentBuyStage() : ''}
      ${view === 'surplus' ? renderSurplusStage() : ''}
      ${view === 'fourday' ? renderFourDayStage() : ''}
    </div>
  `;
}

function renderRentBuyStage() {
  const res = calculateRentVsBuy(wiState);
  const { country, holdingYears } = res;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);
  const buyerWins = res.netDifference >= 0;

  return `
    <div class="take-home-spotlight" style="padding-top:0;">
      <div class="spotlight-label">${buyerWins ? 'Buying the Home Leads After' : 'Renting + Investing in ETFs Leads After'} ${holdingYears} Years</div>
      <div class="hero-net-value net-col">
        +${fmt(Math.abs(res.netDifference))} <span class="hero-period-unit">net wealth difference</span>
      </div>
      <p class="plain-english-summary">
        In Year 1, buying costs <strong>${fmt(res.year1BuyerMonthlyOutflow)}/mo</strong> (mortgage + rates/upkeep) plus <strong>${fmt(res.stampDuty)}</strong> upfront stamp duty, while renting costs <strong>${fmt(res.year1RenterMonthlyRent)}/mo</strong>.
        If the renter invests the saved deposit, stamp duty, and monthly difference into index ETFs at <strong>${wiState.rentBuy.etfReturnPct}%/yr</strong>, after ${holdingYears} years the homeowner has <strong>${fmt(res.finalBuyerNetWealth)}</strong> in tax-free equity vs <strong>${fmt(res.finalRenterNetWealth)}</strong> in ETFs (after CGT).
      </p>
    </div>

    <div class="pay-comparison-boxes" style="margin-top:8px;">
      <div class="pay-mode-box">
        <div class="pay-mode-tag">Path A · Buy the Home</div>
        <div class="pay-mode-main">${fmt(res.finalBuyerNetWealth)} <span class="unit">net equity (Yr ${holdingYears})</span></div>
        <div class="pay-mode-takehome">Year-1 outlay: <strong>${fmt(res.year1BuyerMonthlyOutflow)}/mo</strong> (Mortgage: ${fmt(res.monthlyMortgage)}/mo)</div>
        <div class="pay-mode-range">Exit tax: <strong>0% Capital Gains Tax (Main Residence)</strong></div>
      </div>

      <div class="pay-mode-box contractor-box">
        <div class="pay-mode-tag">Path B · Rent &amp; Invest in ETFs</div>
        <div class="pay-mode-main">${fmt(res.finalRenterNetWealth)} <span class="unit">ETF portfolio (Yr ${holdingYears})</span></div>
        <div class="pay-mode-takehome">Year-1 rent: <strong>${fmt(res.year1RenterMonthlyRent)}/mo</strong> (+ invests monthly cash difference)</div>
        <div class="pay-mode-range">Starts with <strong>${fmt(wiState.rentBuy.depositSaved + res.stampDuty)}</strong> compounding in ETFs</div>
      </div>
    </div>

    <div class="popup-action-bar">
      <button type="button" class="btn-primary btn-sm" id="open-rentbuy-table-popup">
        📊 Open Year-by-Year ${holdingYears}-Year Rent vs Buy Table (Pop-Up)
      </button>
    </div>
  `;
}

function renderSurplusStage() {
  const res = calculateWhatIfScenarios(wiState);
  const { country, surplusAllocation: sa } = res;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);

  return `
    <h3 class="mini-section-title" style="margin-top:0;">Where Should Your Extra ${fmt(sa.monthlySurplus)}/Month Go Over ${sa.years} Years?</h3>
    <p class="plain-english-summary" style="margin-top:0; margin-bottom:18px;">
      Committing <strong>${fmt(sa.monthlySurplus)}/month</strong> out of your take-home pocket (${fmt(sa.totalOutOfPocketContributed)} total over ${sa.years} years) produces three different outcomes depending on how it’s taxed:
    </p>

    <div class="reality-grid">
      <div class="reality-metric">
        <div class="reality-label">1. Mortgage Offset (${wiState.whatIf.mortgageOffsetRatePct}%)</div>
        <div class="reality-big">${fmt(sa.offset.finalValue)}</div>
        <div class="reality-sub">Tax-free interest saved: <strong class="net-col">+${fmt(sa.offset.netGain)}</strong></div>
        <div class="reality-sub">Equals earning <strong>${sa.offset.preTaxEquivalentRatePct}% pre-tax</strong> in a bank account, with instant cash access anytime.</div>
      </div>

      <div class="reality-metric highlight">
        <div class="reality-label">2. Pre-Tax ${escapeHtml(country.retirementLabel)} Sacrifice</div>
        <div class="reality-big net-col">${fmt(sa.superSacrifice.finalValue)}</div>
        <div class="reality-sub">Net gain over pocket cost: <strong class="net-col">+${fmt(sa.superSacrifice.netGain)}</strong></div>
        <div class="reality-sub">Giving up ${fmt(sa.monthlySurplus)}/mo of take-home puts <strong>${fmt(sa.superSacrifice.annualIntoFundAfterTax / 12)}/mo</strong> into ${escapeHtml(country.retirementLabel)} thanks to upfront tax relief.</div>
      </div>

      <div class="reality-metric">
        <div class="reality-label">3. Index ETF Portfolio (${wiState.whatIf.etfReturnPct}%/yr)</div>
        <div class="reality-big">${fmt(sa.etf.finalValue)}</div>
        <div class="reality-sub">After-CGT gain: <strong class="net-col">+${fmt(sa.etf.netGain)}</strong></div>
        <div class="reality-sub">Invested from post-tax pay with discounted long-term capital gains and full liquidity before retirement.</div>
      </div>
    </div>
  `;
}

function renderFourDayStage() {
  const res = calculateWhatIfScenarios(wiState);
  const { country, partTimeCushion } = res;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);
  const fourDay = partTimeCushion[1];

  return `
    <h3 class="mini-section-title" style="margin-top:0;">The 4-Day Work Week Progressive Tax Cushion</h3>
    <p class="plain-english-summary" style="margin-top:0; margin-bottom:18px;">
      On a <strong>${fmt(wiState.salary)}</strong> full-time salary, dropping from <strong>5 days to 4 days a week</strong> cuts your hours by <strong>20%</strong>, yet you still keep <strong>${fourDay.netRatioPct}% of your take-home pay</strong> (${fmt(fourDay.netMonthly)}/mo — costing just ${fmt(fourDay.monthlyDrop)}/mo for 52 three-day weekends a year).
    </p>

    <div class="table-scroll">
      <table class="freq-table">
        <thead>
          <tr>
            <th>Schedule</th>
            <th>Work Time</th>
            <th>Gross Pay</th>
            <th>Overall Tax Rate</th>
            <th>Monthly Take-Home</th>
            <th>Take-Home Kept</th>
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
  `;
}

function openRentBuyTablePopup() {
  const res = calculateRentVsBuy(wiState);
  const { country, holdingYears, timeline } = res;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);
  openPopupModal({
    title: `${holdingYears}-Year Rent vs Buy Wealth Comparison (${country.name})`,
    subtitle: `Comparing tax-free primary residence equity against an after-CGT ETF portfolio.`,
    bodyHtml: `
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
    `,
  });
}

function bindEvents() {
  els.aiForm.addEventListener('submit', (e) => {
    e.preventDefault();
    parseWhatIfPrompt(els.aiInput.value);
  });

  els.aiChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-example-idx]');
    if (!btn) return;
    const ex = EXAMPLE_PROMPTS[Number(btn.dataset.exampleIdx)];
    if (!ex) return;
    els.aiInput.value = ex.prompt;
    parseWhatIfPrompt(ex.prompt);
  });

  els.aiFeedback.addEventListener('click', (e) => {
    if (e.target.closest('#dismiss-wi-feedback')) {
      wiState.lastParsed = null;
      renderAiFeedback();
    }
  });

  els.formRoot.addEventListener('input', (e) => {
    const t = e.target;
    const val = Math.max(0, Number(t.value) || 0);
    if (t.id === 'wi-salary-input') wiState.salary = val;
    else if (t.id === 'rb-homeprice-input') wiState.rentBuy.homePrice = val;
    else if (t.id === 'rb-deposit-input') wiState.rentBuy.depositSaved = val;
    else if (t.id === 'rb-rate-input') wiState.rentBuy.mortgageRatePct = Number(t.value) || 0;
    else if (t.id === 'rb-rent-input') wiState.rentBuy.weeklyRent = val;
    else if (t.id === 'rb-etfreturn-input') wiState.rentBuy.etfReturnPct = Number(t.value) || 0;
    else if (t.id === 'wi-surplus-input') wiState.whatIf.monthlySurplus = val;
    else if (t.id === 'wi-offset-input') wiState.whatIf.mortgageOffsetRatePct = Number(t.value) || 0;
    else if (t.id === 'wi-etf-input') wiState.whatIf.etfReturnPct = Number(t.value) || 0;
    else if (t.id === 'wi-super-input') wiState.whatIf.superReturnPct = Number(t.value) || 0;
    else if (t.id === 'wi-years-input') wiState.whatIf.horizonYears = Math.max(1, val || 10);
    renderResults();
  });

  els.resultsRoot.addEventListener('click', (e) => {
    const stageBtn = e.target.closest('[data-stage-view]');
    if (stageBtn) {
      wiState.stageView = stageBtn.dataset.stageView;
      renderAll();
      return;
    }
    if (e.target.closest('#open-rentbuy-table-popup')) {
      openRentBuyTablePopup();
    }
  });
}

function init() {
  initGlobalHeader({
    activePage: 'whatif',
    onCountryChange: (newCode) => switchCountry(newCode),
  });
  renderExampleChips();
  renderAll();
  bindEvents();
}

init();
