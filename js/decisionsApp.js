/**
 * PaySense — Car & Novated Lease (EV vs Petrol) Controller (decisions.html)
 * Uses Global Country Header + Compact Split Stage + Pop-Up Running Costs Modal.
 */

import { COUNTRIES } from './tax/countries.js';
import { formatCurrency } from './tax/brackets.js';
import { defaultDecisionsState, calculateCarDecision } from './tax/decisionsEngine.js';
import {
  initGlobalHeader,
  getGlobalCountry,
  setGlobalCountry,
  openPopupModal,
} from './ui/globalHeader.js';

const EXAMPLE_PROMPTS = [
  {
    label: '🚗 AU $145k salary · $62k EV lease vs $54k petrol',
    prompt: 'AU $145k salary, $62k EV novated lease over 4 years, 15000 km vs $54k petrol car',
  },
  {
    label: '🚗 AU $120k with HECS · $58k BYD EV 5-yr lease',
    prompt: 'AU $120k salary with HECS, $58k EV novated lease over 5 years, 18000 km vs $46k petrol',
  },
  {
    label: '🚗 UK £85k salary · £48k EV salary sacrifice (3% BiK)',
    prompt: 'UK £85k salary, £48k EV novated lease over 3 years vs £40k petrol',
  },
];

let decState = {
  ...defaultDecisionsState(getGlobalCountry()),
  lastParsed: null,
};

const els = {
  formRoot: document.getElementById('dec-form-root'),
  resultsRoot: document.getElementById('dec-results-root'),
  aiForm: document.getElementById('dec-ai-form'),
  aiInput: document.getElementById('dec-ai-input'),
  aiChips: document.getElementById('dec-example-chips'),
  aiFeedback: document.getElementById('dec-ai-feedback'),
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
  if (!COUNTRIES[newCode] || newCode === decState.country) return;
  setGlobalCountry(newCode);
  decState = {
    ...defaultDecisionsState(newCode),
    lastParsed: null,
  };
  renderAll();
}

function parseCarPrompt(rawText) {
  const text = (rawText || '').trim();
  if (!text) return;

  const tags = [];
  let newCountry = decState.country;

  const countryPatterns = [
    ['AU', /\b(australia|au|aud|sydney|melbourne|brisbane|ato|fbt|hecs)\b/i],
    ['US', /\b(united states|usa|us|usd|california|texas)\b/i],
    ['UK', /\b(uk|united kingdom|gbp|britain|london|bik|£)\b/i],
    ['CA', /\b(canada|ca|cad|toronto|vancouver)\b/i],
    ['IN', /\b(india|in|inr|₹|lakh|lpa|cr)\b/i],
    ['NZ', /\b(new zealand|nz|nzd|auckland)\b/i],
    ['SG', /\b(singapore|sg|sgd|s\$)\b/i],
  ];

  for (const [code, re] of countryPatterns) {
    if (re.test(text)) {
      newCountry = code;
      break;
    }
  }

  if (newCountry !== decState.country) {
    setGlobalCountry(newCountry);
    decState = defaultDecisionsState(newCountry);
  }

  const c = COUNTRIES[decState.country];
  const fmt = (n) => formatCurrency(n, c.currency, c.locale);
  tags.push(`${c.flag} ${c.name}`);

  const salMatch = text.match(/(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lakh|lpa|cr)?\s*(?:salary|income|pay)/i);
  if (salMatch) {
    const val = parseMoney(salMatch[1], salMatch[2]);
    if (val && val > 10000) {
      decState.salary = val;
      tags.push(`Salary: ${fmt(val)}`);
    }
  }

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
    tags.push(decState.car.hasHecs ? 'With HECS' : 'No HECS');
  }

  const res = calculateCarDecision(decState);
  const diff = res.options.petrolNovated.totalCostToOwnAfterTerm - res.options.evNovated.totalCostToOwnAfterTerm;
  decState.lastParsed = {
    tags,
    summary: `An EV on a ${res.years}-year novated lease costs ${fmt(res.options.evNovated.weeklyNetCost)}/wk out of your take-home pay (saving ${fmt(res.options.evNovated.totalTaxAndGstSaved)} in tax & GST) — beating a petrol novated lease by ${fmt(Math.abs(diff))}.`,
  };

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
    <div class="ai-feedback-inner animate-stage">
      <div class="ai-feedback-top">
        <span class="ai-source-badge">Updated Car Comparison</span>
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
  renderCarForm();
  renderCarResults();
  renderAiFeedback();
}

function renderCarForm() {
  const c = COUNTRIES[decState.country] || COUNTRIES.AU;
  const car = decState.car;

  els.formRoot.innerHTML = `
    <div class="card compact-form-card">
      <div class="compact-form-header">
        <span class="section-num">01</span>
        <div>
          <h2 class="compact-form-title">Car &amp; Lease Setup</h2>
          <div class="muted" style="font-size:0.78rem;" id="global-tax-year-badge">${c.flag} ${escapeHtml(c.name)} · ${escapeHtml(c.taxYear)}</div>
        </div>
      </div>

      <div class="setup-block">
        <label class="sub-label" for="dec-salary-input">Your Annual Gross Salary</label>
        <div class="input-combo compact">
          <span class="input-prefix">${escapeHtml(c.symbol)}</span>
          <input type="number" id="dec-salary-input" class="num-input" min="0" step="2000" value="${decState.salary}" />
          <span class="input-suffix">/ yr</span>
        </div>
      </div>

      <div class="two-col-fields">
        <div class="sub-field">
          <label class="sub-label" for="car-evprice-input">EV Price</label>
          <div class="input-combo compact">
            <span class="input-prefix">${escapeHtml(c.symbol)}</span>
            <input type="number" id="car-evprice-input" class="num-input" min="5000" step="1000" value="${car.evPrice}" />
          </div>
        </div>
        <div class="sub-field">
          <label class="sub-label" for="car-petrolprice-input">Petrol Car Price</label>
          <div class="input-combo compact">
            <span class="input-prefix">${escapeHtml(c.symbol)}</span>
            <input type="number" id="car-petrolprice-input" class="num-input" min="5000" step="1000" value="${car.petrolPrice}" />
          </div>
        </div>
      </div>

      <div class="two-col-fields">
        <div class="sub-field">
          <label class="sub-label" for="car-years-select">Lease / Loan Term</label>
          <select id="car-years-select" class="select-input">
            ${[1, 2, 3, 4, 5]
              .map((y) => `<option value="${y}" ${Number(car.leaseYears) === y ? 'selected' : ''}>${y} ${y === 1 ? 'Year' : 'Years'}</option>`)
              .join('')}
          </select>
        </div>
        <div class="sub-field">
          <label class="sub-label" for="car-km-input">Annual Distance (km)</label>
          <input type="number" id="car-km-input" class="text-input" min="2000" max="80000" step="1000" value="${car.annualKm}" />
        </div>
      </div>

      ${
        c.code === 'AU'
          ? `
        <label class="toggle-row" style="font-size:0.84rem;">
          <input type="checkbox" id="car-hecs-checkbox" ${car.hasHecs ? 'checked' : ''} />
          <span>I have a HECS-HELP loan (RFBA check)</span>
        </label>
      `
          : ''
      }

      <button type="button" class="btn-ghost btn-sm full-width-btn" id="open-car-rates-popup">
        ⚙️ Fine-Tune Interest, Fuel &amp; Charging Rates
      </button>
    </div>
  `;
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

  els.resultsRoot.innerHTML = `
    <div class="stage-nav-bar">
      <div class="stage-tabs">
        <span class="stage-tab active">02 · 4-Way Car &amp; Novated Lease Comparison (${years} Years)</span>
      </div>
      <span class="comp-pill ${res.evEligibleFbtExempt ? 'comp-low' : 'comp-mod'}">
        ${res.evEligibleFbtExempt ? '100% FBT-Exempt EV Eligible' : 'Standard ECM Lease Rules'}
      </span>
    </div>

    <div class="card stage-card animate-stage">
      <div class="take-home-spotlight" style="padding-top:0;">
        <div class="spotlight-label">Real Weekly Cost Out of Your Take-Home Pay (EV Novated Lease)</div>
        <div class="hero-net-value net-col">
          ${fmt(ev.weeklyNetCost)} <span class="hero-period-unit">per week</span>
          <span class="hero-period-unit">(${fmt(ev.monthlyNetCost)}/month all-inclusive)</span>
        </div>
        <p class="plain-english-summary">
          Your lease payment and all running costs (charging, insurance, rego, servicing, tyres) come out before tax — saving you <strong>${fmt(ev.totalTaxAndGstSaved)}</strong> in income tax &amp; GST over ${years} years and leaving you <strong>${evVsPetSavings >= 0 ? `${fmt(evVsPetSavings)} ahead` : `${fmt(Math.abs(evVsPetSavings))} behind`}</strong> vs a ${fmt(decState.car.petrolPrice)} petrol novated lease.
        </p>
      </div>

      <div class="car-options-grid">
        <div class="reality-metric highlight">
          <div class="reality-label">1. ${escapeHtml(ev.title)}</div>
          <div class="reality-big net-col">${fmt(ev.weeklyNetCost)}<span class="unit">/wk</span></div>
          <div class="reality-sub"><strong>${fmt(ev.monthlyNetCost)}/mo</strong> net take-home impact</div>
          <div class="reality-sub">Tax &amp; GST saved: <strong class="net-col">+${fmt(ev.totalTaxAndGstSaved)}</strong></div>
          <div class="reality-sub">End balloon (${years}y): <strong>${fmt(ev.residualBuyout)}</strong></div>
          <div class="reality-sub" style="margin-top:6px; padding-top:6px; border-top:1px solid var(--border);">
            Total ${years}-yr cost to own: <strong>${fmt(ev.totalCostToOwnAfterTerm)}</strong>
          </div>
        </div>

        <div class="reality-metric">
          <div class="reality-label">2. ${escapeHtml(pet.title)}</div>
          <div class="reality-big">${fmt(pet.weeklyNetCost)}<span class="unit">/wk</span></div>
          <div class="reality-sub"><strong>${fmt(pet.monthlyNetCost)}/mo</strong> net take-home impact</div>
          <div class="reality-sub">Tax &amp; GST saved: <strong>+${fmt(pet.totalTaxAndGstSaved)}</strong></div>
          <div class="reality-sub">End balloon (${years}y): <strong>${fmt(pet.residualBuyout)}</strong></div>
          <div class="reality-sub" style="margin-top:6px; padding-top:6px; border-top:1px solid var(--border);">
            Total ${years}-yr cost to own: <strong>${fmt(pet.totalCostToOwnAfterTerm)}</strong>
          </div>
        </div>

        <div class="reality-metric">
          <div class="reality-label">3. ${escapeHtml(loan.title)}</div>
          <div class="reality-big">${fmt(loan.weeklyNetCost)}<span class="unit">/wk</span></div>
          <div class="reality-sub"><strong>${fmt(loan.monthlyNetCost)}/mo</strong> post-tax</div>
          <div class="reality-sub">Tax &amp; GST saved: <strong>${fmt(0)}</strong></div>
          <div class="reality-sub">End balloon: <strong>${fmt(0)} (paid off)</strong></div>
          <div class="reality-sub" style="margin-top:6px; padding-top:6px; border-top:1px solid var(--border);">
            Total ${years}-yr cost to own: <strong>${fmt(loan.totalCostToOwnAfterTerm)}</strong>
          </div>
        </div>

        <div class="reality-metric">
          <div class="reality-label">4. ${escapeHtml(cash.title)}</div>
          <div class="reality-big">${fmt(cash.weeklyNetCost)}<span class="unit">/wk</span></div>
          <div class="reality-sub">Upfront cash: <strong>${fmt(decState.car.evPrice)}</strong></div>
          <div class="reality-sub">Lost offset interest: <strong class="tax-color">−${fmt(cash.lostOffsetInterestOverTerm)}</strong></div>
          <div class="reality-sub">End balloon: <strong>${fmt(0)} (owned)</strong></div>
          <div class="reality-sub" style="margin-top:6px; padding-top:6px; border-top:1px solid var(--border);">
            Total ${years}-yr cost: <strong>${fmt(cash.totalCostToOwnAfterTerm)}</strong>
          </div>
        </div>
      </div>

      <div class="driver-note" style="margin-top:16px;">
        <strong>⚡ Home EV Charging vs Petrol Fuel (${res.annualKm.toLocaleString()} km/yr):</strong>
        Charging costs ~<strong>${fmt(energyComparison.evEnergyAnnual)}/yr</strong> vs <strong>${fmt(energyComparison.petrolFuelAnnual)}/yr</strong> for petrol — saving <strong>${fmt(energyComparison.annualFuelSavings)}/yr</strong> (<strong>${fmt(energyComparison.termFuelSavings)}</strong> over ${years} years) in energy alone.
      </div>

      ${
        res.extraHecsFromRfba > 0
          ? `
        <div class="reassure-note" style="margin-top:12px; margin-bottom:0;">
          <strong>🎓 HECS-HELP Reportable Fringe Benefit Included:</strong>
          The ATO adds a grossed-up Reportable Fringe Benefits Amount for FBT-exempt EV leases when calculating HECS repayments (+${fmt(res.extraHecsFromRfba)}/yr, already factored into your weekly net cost above).
        </div>
      `
          : ''
      }
    </div>
  `;
}

function openCarRatesPopup() {
  const c = COUNTRIES[decState.country];
  const car = decState.car;
  const modal = openPopupModal({
    title: 'Fine-Tune Finance, Fuel & Electricity Rates',
    subtitle: 'Customize interest rates and fuel vs home charging assumptions.',
    wide: false,
    bodyHtml: `
      <div id="car-modal-controls" class="modal-form">
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="car-rate-input">Lease / Loan Interest Rate (%)</label>
            <input type="number" id="car-rate-input" class="text-input" min="0" max="20" step="0.2" value="${car.financeRatePct}" />
          </div>
          <div class="sub-field">
            <label class="sub-label" for="car-opp-input">Cash Mortgage Offset Rate (%)</label>
            <input type="number" id="car-opp-input" class="text-input" min="0" max="15" step="0.2" value="${car.cashOpportunityRatePct}" />
          </div>
        </div>
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="car-petrolcost-input">Petrol Price (${escapeHtml(c.symbol)}/Litre)</label>
            <input type="number" id="car-petrolcost-input" class="text-input" min="0.5" max="250" step="0.05" value="${car.petrolCostPerLiter}" />
          </div>
          <div class="sub-field">
            <label class="sub-label" for="car-eleccost-input">Home Electricity (${escapeHtml(c.symbol)}/kWh)</label>
            <input type="number" id="car-eleccost-input" class="text-input" min="0.05" max="50" step="0.02" value="${car.electricityCostPerKwh}" />
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-primary" data-close-popup>Done</button>
        </div>
      </div>
    `,
  });

  modal.querySelector('#car-modal-controls')?.addEventListener('input', (e) => {
    const t = e.target;
    const val = Number(t.value) || 0;
    if (t.id === 'car-rate-input') decState.car.financeRatePct = val;
    else if (t.id === 'car-opp-input') decState.car.cashOpportunityRatePct = val;
    else if (t.id === 'car-petrolcost-input') decState.car.petrolCostPerLiter = val;
    else if (t.id === 'car-eleccost-input') decState.car.electricityCostPerKwh = val;
    renderCarResults();
  });
}

function bindEvents() {
  els.aiForm.addEventListener('submit', (e) => {
    e.preventDefault();
    parseCarPrompt(els.aiInput.value);
  });

  els.aiChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-example-idx]');
    if (!btn) return;
    const ex = EXAMPLE_PROMPTS[Number(btn.dataset.exampleIdx)];
    if (!ex) return;
    els.aiInput.value = ex.prompt;
    parseCarPrompt(ex.prompt);
  });

  els.aiFeedback.addEventListener('click', (e) => {
    if (e.target.closest('#dismiss-dec-feedback')) {
      decState.lastParsed = null;
      renderAiFeedback();
    }
  });

  els.formRoot.addEventListener('click', (e) => {
    if (e.target.closest('#open-car-rates-popup')) {
      openCarRatesPopup();
    }
  });

  els.formRoot.addEventListener('input', (e) => {
    const t = e.target;
    const val = Math.max(0, Number(t.value) || 0);
    if (t.id === 'dec-salary-input') decState.salary = val;
    else if (t.id === 'car-evprice-input') decState.car.evPrice = val;
    else if (t.id === 'car-petrolprice-input') decState.car.petrolPrice = val;
    else if (t.id === 'car-km-input') decState.car.annualKm = val;
    renderCarResults();
  });

  els.formRoot.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'car-years-select') {
      decState.car.leaseYears = Number(t.value) || 4;
      renderCarResults();
    } else if (t.id === 'car-hecs-checkbox') {
      decState.car.hasHecs = t.checked;
      renderCarResults();
    }
  });
}

function init() {
  initGlobalHeader({
    activePage: 'car',
    onCountryChange: (newCode) => switchCountry(newCode),
  });
  renderExampleChips();
  renderAll();
  bindEvents();
}

init();
