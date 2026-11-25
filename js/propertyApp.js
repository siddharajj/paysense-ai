/**
 * PaySense — Property Address Intelligence, Suburb Matchmaker, Negative Gearing,
 * DIY Depreciation Schedule & 10-Year CGT Forecaster (property.html)
 */

import { COUNTRIES } from './tax/countries.js';
import { formatCurrency, formatPercent } from './tax/brackets.js';
import { defaultPropertyState, calculatePropertyImpact } from './tax/propertyEngine.js';
import {
  loadAreaShard,
  autocompleteAddress,
  enrichPropertyByAddress,
  getBackendWorkerUrl,
  setBackendWorkerUrl,
} from './data/propertyIntelClient.js';
import {
  initGlobalHeader,
  getGlobalCountry,
  setGlobalCountry,
  openPopupModal,
} from './ui/globalHeader.js';

const SAMPLE_ADDRESSES_BY_COUNTRY = {
  AU: [
    { label: '🏢 14/42 Hassall St, Parramatta NSW (2-Bed Unit)', address: '14/42 Hassall St, Parramatta NSW 2150', type: 'unit', beds: 2 },
    { label: '🏡 19 Kildare Rd, Blacktown NSW (4-Bed House)', address: '19 Kildare Rd, Blacktown NSW 2148', type: 'house', beds: 4 },
    { label: '🏢 204/88 Albert St, Brunswick VIC (2-Bed Unit)', address: '204/88 Albert St, Brunswick VIC 3056', type: 'unit', beds: 2 },
    { label: '🏡 24 View St, Chermside QLD (3-Bed House)', address: '24 View St, Chermside QLD 4032', type: 'house', beds: 3 },
    { label: '🏡 15 King William St, Bayswater WA (3-Bed House)', address: '15 King William St, Bayswater WA 6053', type: 'house', beds: 3 },
  ],
  UK: [
    { label: '🏢 14 Clippers Quay, Salford Manchester M5', address: '14 Clippers Quay, Manchester M5', type: 'unit', beds: 2 },
    { label: '🏡 28 Hoe St, Walthamstow London E17', address: '28 Hoe St, Walthamstow E17', type: 'house', beds: 3 },
  ],
  US: [
    { label: '🏡 412 Maynard Rd, Cary Raleigh NC 27513', address: '412 Maynard Rd, Raleigh NC 27513', type: 'house', beds: 3 },
    { label: '🏡 11804 Burnet Rd, Austin TX 78758', address: '11804 Burnet Rd, Austin TX 78758', type: 'house', beds: 3 },
  ],
  SG: [
    { label: '🏢 Blk 402 Tampines St 41, Singapore', address: '402 Tampines Street 41, Tampines 520402', type: 'unit', beds: 3 },
    { label: '🏢 88 Dawson Rd, Queenstown, Singapore', address: '88 Dawson Road, Queenstown 140088', type: 'unit', beds: 2 },
  ],
  NZ: [
    { label: '🏡 45 Dominion Rd, Mount Eden, Auckland', address: '45 Dominion Rd, Mount Eden 1024', type: 'house', beds: 3 },
    { label: '🏢 18 Lincoln Rd, Addington, Christchurch', address: '18 Lincoln Rd, Addington 8024', type: 'unit', beds: 2 },
  ],
  CA: [
    { label: '🏢 1020 12 Ave SW, Beltline, Calgary AB', address: '1020 12 Ave SW, Calgary T2R', type: 'unit', beds: 2 },
    { label: '🏡 48 Boulton Ave, Leslieville, Toronto ON', address: '48 Boulton Ave, Toronto M4M', type: 'house', beds: 3 },
  ],
  IN: [
    { label: '🏢 ITPL Main Rd, Whitefield, Bengaluru', address: 'ITPL Main Rd, Whitefield 560066', type: 'unit', beds: 3 },
    { label: '🏢 Financial District, Gachibowli, Hyderabad', address: 'Gachibowli 500032', type: 'unit', beds: 3 },
  ],
};

let propState = {
  ...defaultPropertyState(getGlobalCountry()),
  stageView: 'insights', // 'insights' | 'matchmaker' | 'impact' | 'depreciation' | 'forecast'
  addressIntel: null,
  areaShard: null,
  matchFilterType: 'unit', // 'unit' | 'house'
  matchFilterCity: 'All',
  lastParsed: null,
};

let currentImpact = calculatePropertyImpact(propState);
let autocompleteItems = [];
let selectedCandidate = null;

const els = {
  formRoot: document.getElementById('prop-form-root'),
  resultsRoot: document.getElementById('prop-results-root'),
  lookupForm: document.getElementById('address-lookup-form'),
  lookupInput: document.getElementById('address-lookup-input'),
  lookupBtn: document.getElementById('address-lookup-btn'),
  lookupType: document.getElementById('lookup-prop-type'),
  lookupBeds: document.getElementById('lookup-beds'),
  autocompleteBox: document.getElementById('address-autocomplete-list'),
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

async function switchCountry(newCode) {
  if (!COUNTRIES[newCode] || newCode === propState.country) return;
  setGlobalCountry(newCode);
  propState = {
    ...defaultPropertyState(newCode),
    stageView: propState.stageView,
    addressIntel: null,
    areaShard: null,
    matchFilterType: 'unit',
    matchFilterCity: 'All',
  };
  renderSampleChips();
  await loadCountryAreasAndDefaultLookup();
}

function renderSampleChips() {
  const samples = SAMPLE_ADDRESSES_BY_COUNTRY[propState.country] || SAMPLE_ADDRESSES_BY_COUNTRY.AU;
  els.aiChips.innerHTML = samples
    .map((s, idx) => `<button type="button" class="prompt-chip" data-sample-idx="${idx}">${escapeHtml(s.label)}</button>`)
    .join('');
}

async function loadCountryAreasAndDefaultLookup() {
  try {
    propState.areaShard = await loadAreaShard(propState.country);
  } catch {
    propState.areaShard = { areas: [] };
  }
  const samples = SAMPLE_ADDRESSES_BY_COUNTRY[propState.country] || SAMPLE_ADDRESSES_BY_COUNTRY.AU;
  if (samples[0]) {
    els.lookupInput.value = samples[0].address;
    els.lookupType.value = samples[0].type;
    els.lookupBeds.value = String(samples[0].beds);
    await runAddressLookup(samples[0].address, samples[0].type, samples[0].beds, null, true);
  } else {
    renderAll();
  }
}

async function runAddressLookup(addressText, propType, beds, candidate = null, silent = false) {
  const addr = (addressText || '').trim();
  if (!addr) return;

  els.lookupBtn.disabled = true;
  els.lookupBtn.textContent = 'Scanning…';
  els.autocompleteBox.hidden = true;

  try {
    const intel = await enrichPropertyByAddress({
      address: addr,
      country: propState.country,
      propertyType: propType,
      bedrooms: Number(beds) || 2,
      selectedCandidate: candidate,
    });

    propState.addressIntel = intel;
    // Auto-populate the Property Tax, Negative Gearing & Depreciation model!
    propState.propertyValue = intel.estimatedValue;
    propState.loanAmount = Math.round(intel.estimatedValue * 0.8);
    propState.weeklyRent = intel.estimatedWeeklyRent;
    propState.buildingStructureCost = intel.estimatedBuildingValue;
    propState.plantAndEquipmentValue = intel.estimatedFixturesValue;
    propState.newUpgradesInstalled = Math.round(intel.estimatedFixturesValue * 0.35);
    propState.buildYear = intel.typicalBuildYear;
    propState.isBrandNewBuild = intel.typicalBuildYear >= 2024;
    propState.annualExpenses = Math.round(
      intel.estimatedValue * (propType === 'unit' ? 0.0105 : 0.0075)
    );
    // Calibrate realistic annual capital growth from suburb 5-yr history
    const impliedAnnualGrowth = (Math.pow(1 + intel.growth5yrPct / 100, 1 / 5) - 1) * 100;
    propState.capitalGrowthPct = Number(Math.min(8.5, Math.max(3.0, impliedAnnualGrowth)).toFixed(1));

    if (!silent) {
      propState.stageView = 'insights';
      showToast(`Loaded blended insights & tax model for ${intel.area.suburb}!`);
    }
    renderAll();
  } catch (err) {
    if (!silent) showToast(`Could not enrich address: ${err.message}`);
    renderAll();
  } finally {
    els.lookupBtn.disabled = false;
    els.lookupBtn.textContent = 'Inspect Address';
  }
}

function renderAll() {
  currentImpact = calculatePropertyImpact(propState);
  renderPropertyForm();
  renderPropertyResults();
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
          <h2 class="compact-form-title">Your Pay &amp; Property</h2>
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
        <label class="sub-label" for="prop-value-input">Property Price / Est. Value</label>
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
          <label class="sub-label" for="prop-rate-input">Interest (%)</label>
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
          <label class="sub-label" for="prop-expenses-input">Costs / Yr</label>
          <div class="input-combo compact">
            <span class="input-prefix">${escapeHtml(c.symbol)}</span>
            <input type="number" id="prop-expenses-input" class="num-input" min="0" step="500" value="${propState.annualExpenses}" />
          </div>
        </div>
      </div>

      <div class="setup-block">
        <label class="sub-label" for="prop-build-type">Build Era &amp; Depreciation Basis</label>
        <select id="prop-build-type" class="select-input">
          <option value="established" ${!propState.isBrandNewBuild ? 'selected' : ''}>Established (${propState.buildYear})</option>
          <option value="new" ${propState.isBrandNewBuild ? 'selected' : ''}>Brand-New Build (${propState.buildYear})</option>
        </select>
      </div>

      <button type="button" class="btn-ghost btn-sm full-width-btn" id="open-prop-settings-popup">
        ⚙️ Building Cost, Growth &amp; DB Settings
      </button>
    </div>
  `;
}

function renderPropertyResults() {
  const { country, year1, withoutPropertyCalc, depSchedule, exitCgt } = currentImpact;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);
  const stageView = propState.stageView || 'insights';

  const isRefund = year1.taxSavedOrPaid >= 0;
  const isPositiveAfterTax = year1.afterTaxPropertyCashflow >= 0;

  els.resultsRoot.innerHTML = `
    <div class="stage-nav-bar">
      <div class="stage-tabs" role="tablist">
        <button type="button" class="stage-tab ${stageView === 'insights' ? 'active' : ''}" data-stage-view="insights">
          01 · Address &amp; Area Insights
        </button>
        <button type="button" class="stage-tab ${stageView === 'matchmaker' ? 'active' : ''}" data-stage-view="matchmaker">
          02 · Suburb Matchmaker
        </button>
        <button type="button" class="stage-tab ${stageView === 'impact' ? 'active' : ''}" data-stage-view="impact">
          03 · Pay &amp; Negative Gearing
        </button>
        <button type="button" class="stage-tab ${stageView === 'depreciation' ? 'active' : ''}" data-stage-view="depreciation">
          04 · Depreciation Schedule
        </button>
        <button type="button" class="stage-tab ${stageView === 'forecast' ? 'active' : ''}" data-stage-view="forecast">
          05 · ${exitCgt.holdingYears}-Yr CGT Forecast
        </button>
      </div>
    </div>

    <div class="card stage-card animate-stage">
      ${stageView === 'insights' ? renderAddressInsightsStage(fmt, year1, withoutPropertyCalc) : ''}
      ${stageView === 'matchmaker' ? renderSuburbMatchmakerStage(fmt) : ''}
      ${stageView === 'impact' ? renderImpactStage(year1, withoutPropertyCalc, fmt, isRefund, isPositiveAfterTax) : ''}
      ${stageView === 'depreciation' ? renderDepreciationStage(country, year1, depSchedule, withoutPropertyCalc, fmt) : ''}
      ${stageView === 'forecast' ? renderForecastStage(country, exitCgt, fmt) : ''}
    </div>
  `;
}

/**
 * STAGE 01: BLENDED ADDRESS INSIGHTS, HISTORICAL GROWTH SVG CHART & LIVE 1KM WALKABILITY
 */
function renderAddressInsightsStage(fmt, year1, withoutPropertyCalc) {
  const intel = propState.addressIntel;
  if (!intel) {
    return `<p class="muted">Enter any street address or click a sample address above to inspect property metadata, suburb fundamentals, and historical growth.</p>`;
  }

  const { area, amenities } = intel;
  const weeklyCost = year1.weeklyAfterTaxImpact;
  const isPos = weeklyCost >= 0;
  const netWeeklySalary = withoutPropertyCalc.netIncome / 52;
  const pocketSharePct = netWeeklySalary > 0 ? Math.abs(weeklyCost / netWeeklySalary) * 100 : 0;

  return `
    <!-- Top Resolved Address & Blended Score Header -->
    <div class="intel-header-row">
      <div>
        <div class="hero-eyebrow">
          <span>📍 ${escapeHtml(intel.matchKind)}</span>
          <span class="dot-sep">·</span>
          <span>${escapeHtml(area.city)}, ${escapeHtml(area.state)} ${escapeHtml(area.postcode)}</span>
          <span class="dot-sep">·</span>
          <span>${intel.bedrooms}-Bed ${intel.propertyType === 'house' ? 'House / Townhouse' : 'Unit / Apartment'}</span>
        </div>
        <h3 class="intel-address-title">${escapeHtml(intel.resolvedAddress)}</h3>
        <p class="muted" style="margin:4px 0 0; font-size:0.88rem;">${escapeHtml(area.highlights)}</p>
      </div>

      <div class="intel-score-badge" title="Blended 5-pillar score: Growth, Yield, Tenant Affordability, Owner-Occupier Stability & Transit">
        <div class="score-num">${intel.totalScore}<span>/100</span></div>
        <div class="score-lbl">Area Quality</div>
      </div>
    </div>

    <!-- Personal Salary Fit Verdict Banner -->
    <div class="personal-fit-banner">
      <div>
        <div class="fit-eyebrow">Your Personal Pay Fit (on ${fmt(propState.salary)}/yr salary)</div>
        <div class="fit-headline">
          ${
            isPos
              ? `Adds <strong>+${fmt(weeklyCost)}/week</strong> after tax to your pocket`
              : `Costs <strong>${fmt(Math.abs(weeklyCost))}/week</strong> out-of-pocket after your <strong>${fmt(Math.max(0, year1.taxSavedOrPaid))}/yr</strong> tax refund`
          }
          <span class="muted">(${pocketSharePct.toFixed(1)}% of your take-home pay — ${pocketSharePct <= 8 || isPos ? 'Comfortable' : pocketSharePct <= 15 ? 'Moderate stretch' : 'High commitment'})</span>
        </div>
      </div>
      <button type="button" class="btn-primary btn-xs" data-stage-view="impact">See Full Tax Breakdown →</button>
    </div>

    <!-- 4 Blended Property & Land Metadata Tiles -->
    <div class="kpi-grid" style="margin-top:16px;">
      <div class="kpi-tile">
        <div class="kpi-label">Est. Market Value</div>
        <div class="kpi-val">${fmt(intel.estimatedValue)}</div>
        <div class="kpi-meta">Range: ${fmt(intel.estimatedLow)} – ${fmt(intel.estimatedHigh)}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Est. Rent &amp; Gross Yield</div>
        <div class="kpi-val net-col">${fmt(intel.estimatedWeeklyRent)}<span class="unit">/wk</span></div>
        <div class="kpi-meta">${intel.grossYieldPct}% yield · ${area.vacancyPct}% suburb vacancy</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Land vs Building Split</div>
        <div class="kpi-val retire-color">${Math.round((intel.estimatedBuildingValue / intel.estimatedValue) * 100)}% <span class="unit">bldg</span></div>
        <div class="kpi-meta">Land ~${fmt(intel.estimatedLandValue)} · Bldg ~${fmt(intel.estimatedBuildingValue)}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Suburb Tenant Health</div>
        <div class="kpi-val">${area.rentToIncomePct}% <span class="unit">rent/inc</span></div>
        <div class="kpi-meta">${area.ownerOccupierPct}% owner-occupied · Inc ${fmt(area.medianHouseholdIncome)}</div>
      </div>
    </div>

    <!-- Two-Column: 10-Yr Historical Growth SVG Chart + Live 1km Walkability & Risk Flags -->
    <div class="two-col-cards" style="margin-top:18px;">
      <div class="sub-panel-box">
        <div class="card-title-row" style="margin-bottom:8px;">
          <h4 class="mini-section-title" style="margin:0;">10-Year Price Trajectory vs ${escapeHtml(area.city)}</h4>
          <span class="comp-pill comp-low">+${intel.growth5yrPct}% (5-Yr)</span>
        </div>
        ${renderGrowthTimelineSvg(intel.historySeries, intel.cityHistorySeries, fmt, area.suburb, area.city)}
        ${
          intel.recentSales.length
            ? `
          <div class="recent-sales-mini">
            <div class="sub-label" style="margin-bottom:4px;">Recorded Area &amp; Comparable Sales:</div>
            ${intel.recentSales
              .slice(0, 2)
              .map(
                (s) => `
              <div class="sale-mini-row">
                <span>${escapeHtml(s.address)} <span class="muted">(${escapeHtml(s.type)})</span></span>
                <strong>${fmt(s.soldPrice)} <span class="muted">${escapeHtml(s.soldDate)}</span></strong>
              </div>
            `
              )
              .join('')}
          </div>
        `
            : ''
        }
      </div>

      <div class="sub-panel-box">
        <div class="card-title-row" style="margin-bottom:8px;">
          <h4 class="mini-section-title" style="margin:0;">1km Walkability &amp; Due-Diligence Risks</h4>
          <span class="tax-year-pill">${amenities.isLive ? '🟢 Live OSM Scan' : 'Suburb Baseline'}</span>
        </div>

        <div class="amenity-pills-grid">
          <div class="amenity-pill">🚆 <strong>${amenities.transit}</strong> Transit stops</div>
          <div class="amenity-pill">🏫 <strong>${amenities.schools}</strong> Schools</div>
          <div class="amenity-pill">🛒 <strong>${amenities.supermarkets}</strong> Supermarkets</div>
          <div class="amenity-pill">🌳 <strong>${amenities.parks}</strong> Parks &amp; reserves</div>
        </div>

        ${
          amenities.namedHighlights?.length
            ? `<div class="muted" style="font-size:0.78rem; margin-top:8px;">Nearby: ${amenities.namedHighlights.map(escapeHtml).join(' · ')}</div>`
            : ''
        }

        <div class="risk-flags-list">
          <div class="sub-label" style="margin:10px 0 4px;">Zoning (${escapeHtml(area.zoning)}) &amp; Local Checks:</div>
          ${(area.riskFlags || [])
            .map((rf) => `<div class="risk-flag-item">⚠️ ${escapeHtml(rf)}</div>`)
            .join('')}
        </div>
      </div>
    </div>

    <div class="sources-footer-strip">
      <span><strong>Blended Sources:</strong> ${intel.sourcesUsed.map(escapeHtml).join(' · ')}</span>
    </div>
  `;
}

function renderGrowthTimelineSvg(suburbSeries = [], citySeries = [], fmt, suburbName, cityName) {
  if (!suburbSeries.length) return '';
  const w = 420;
  const h = 148;
  const padL = 12;
  const padR = 12;
  const padT = 16;
  const padB = 26;

  const allVals = [...suburbSeries.map((d) => d.price), ...(citySeries || []).map((d) => d.price)];
  const minV = Math.min(...allVals) * 0.92;
  const maxV = Math.max(...allVals) * 1.05;
  const span = Math.max(1, maxV - minV);

  const toX = (i, total) => padL + (i / Math.max(1, total - 1)) * (w - padL - padR);
  const toY = (val) => padT + (1 - (val - minV) / span) * (h - padT - padB);

  const subPts = suburbSeries.map((d, i) => `${toX(i, suburbSeries.length).toFixed(1)},${toY(d.price).toFixed(1)}`).join(' ');
  const cityPts = (citySeries || [])
    .map((d, i) => `${toX(i, citySeries.length).toFixed(1)},${toY(d.price).toFixed(1)}`)
    .join(' ');

  const dots = suburbSeries
    .map((d, i) => {
      const cx = toX(i, suburbSeries.length).toFixed(1);
      const cy = toY(d.price).toFixed(1);
      return `<circle cx="${cx}" cy="${cy}" r="3.5" fill="var(--primary)"><title>${d.year}: ${fmt(d.price)}</title></circle>`;
    })
    .join('');

  const yearLabels = suburbSeries
    .filter((_, i) => i === 0 || i === 3 || i === suburbSeries.length - 1)
    .map((d) => {
      const idx = suburbSeries.indexOf(d);
      const x = toX(idx, suburbSeries.length).toFixed(1);
      return `<text x="${x}" y="${h - 6}" font-size="10" fill="var(--text-muted)" text-anchor="${idx === 0 ? 'start' : idx === suburbSeries.length - 1 ? 'end' : 'middle'}">${d.year} (${fmt(d.price)})</text>`;
    })
    .join('');

  return `
    <svg viewBox="0 0 ${w} ${h}" class="growth-svg" role="img" aria-label="10-year historical price trend">
      ${cityPts ? `<polyline fill="none" stroke="var(--border)" stroke-width="2" stroke-dasharray="4 3" points="${cityPts}" />` : ''}
      <polyline fill="none" stroke="var(--primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${suburbPts}" />
      ${dots}
      ${yearLabels}
    </svg>
    <div class="svg-legend-mini">
      <span><span class="legend-dot" style="display:inline-block;background:var(--primary)"></span> ${escapeHtml(suburbName)}</span>
      <span class="muted">--- ${escapeHtml(cityName)} Benchmark</span>
    </div>
  `;
}

/**
 * STAGE 02: SUBURB MATCHMAKER (RANKS AREAS BY WEEKLY AFTER-TAX COST ON USER'S SALARY!)
 */
function renderSuburbMatchmakerStage(fmt) {
  const areas = propState.areaShard?.areas || [];
  if (!areas.length) {
    return `<p class="muted">Loading suburb profiles…</p>`;
  }

  const cities = ['All', ...new Set(areas.map((a) => a.city))];
  const isHouse = propState.matchFilterType === 'house';

  const ranked = areas
    .filter((a) => propState.matchFilterCity === 'All' || a.city === propState.matchFilterCity)
    .map((a) => {
      const price = isHouse ? a.houseMedian : a.unitMedian;
      const rentWk = isHouse ? a.houseRentWk : a.unitRentWk;
      const yieldPct = isHouse ? a.houseYieldPct : a.unitYieldPct;
      const growth5y = isHouse ? a.growth5yrPct : a.unitGrowth5yrPct;
      const landShare = isHouse ? a.landShareHouse : a.landShareUnit;

      // Compute exact Year-1 weekly after-tax holding cost for THIS user's salary!
      const sim = calculatePropertyImpact({
        ...propState,
        propertyValue: price,
        loanAmount: Math.round(price * 0.8),
        weeklyRent: rentWk,
        buildingStructureCost: Math.round(price * (1 - landShare) * 0.88),
        plantAndEquipmentValue: Math.round(price * 0.04),
        newUpgradesInstalled: Math.round(price * 0.015),
        buildYear: a.typicalBuildYear || 2016,
        annualExpenses: Math.round(price * (isHouse ? 0.0075 : 0.0105)),
      });

      return {
        area: a,
        price,
        rentWk,
        yieldPct,
        growth5y,
        weeklyAfterTax: Math.round(sim.year1.weeklyAfterTaxImpact),
        annualTaxRefund: Math.round(sim.year1.taxSavedOrPaid),
      };
    })
    .sort((x, y) => y.weeklyAfterTax - x.weeklyAfterTax); // Best cashflow / lowest weekly cost first!

  return `
    <div class="dep-controls-bar">
      <div>
        <h3 class="mini-section-title" style="margin:0;">Suburb Matchmaker (Ranked for Your ${fmt(propState.salary)} Salary)</h3>
        <div class="muted" style="font-size:0.82rem;">Ranked from best weekly after-tax cashflow (assuming 20% deposit at ${propState.interestRatePct}% interest).</div>
      </div>

      <div class="matchmaker-filters">
        <select id="mm-city-select" class="lookup-inline-select">
          ${cities
            .map((ct) => `<option value="${escapeHtml(ct)}" ${ct === propState.matchFilterCity ? 'selected' : ''}>${ct === 'All' ? 'All Cities' : escapeHtml(ct)}</option>`)
            .join('')}
        </select>
        <div class="segmented-control" style="min-width:190px;">
          <button type="button" class="seg-btn ${!isHouse ? 'active' : ''}" data-mm-type="unit">Units</button>
          <button type="button" class="seg-btn ${isHouse ? 'active' : ''}" data-mm-type="house">Houses</button>
        </div>
      </div>
    </div>

    <div class="table-scroll" style="margin-top:12px;">
      <table class="freq-table">
        <thead>
          <tr>
            <th>Suburb / Area</th>
            <th>Median Price</th>
            <th>Rent (Gross Yield)</th>
            <th>5-Yr Growth</th>
            <th>Your Tax Refund</th>
            <th>Your Weekly Net Cost</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${ranked
            .map(
              (r) => `
            <tr>
              <td>
                <strong>${escapeHtml(r.area.suburb)}</strong>
                <div class="pin-meta">${escapeHtml(r.area.city)}, ${escapeHtml(r.area.state)} · ${r.area.vacancyPct}% vac · ${r.area.ownerOccupierPct}% owner</div>
              </td>
              <td><strong>${fmt(r.price)}</strong></td>
              <td>${fmt(r.rentWk)}/wk <span class="muted">(${r.yieldPct}%)</span></td>
              <td class="net-col">+${r.growth5y}%</td>
              <td class="${r.annualTaxRefund >= 0 ? 'net-col' : 'tax-color'}">${r.annualTaxRefund >= 0 ? '+' : '−'}${fmt(Math.abs(r.annualTaxRefund))}/yr</td>
              <td class="${r.weeklyAfterTax >= 0 ? 'net-col' : ''}">
                <strong>${r.weeklyAfterTax >= 0 ? '+' : '−'}${fmt(Math.abs(r.weeklyAfterTax))}/wk</strong>
              </td>
              <td>
                <button type="button" class="btn-primary btn-xs load-suburb-btn" data-suburb="${escapeHtml(r.area.suburb)}" data-postcode="${escapeHtml(r.area.postcode)}">
                  Model →
                </button>
              </td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
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
  const workerUrl = getBackendWorkerUrl();
  const modal = openPopupModal({
    title: 'Building Depreciation, Growth & Edge DB Settings',
    subtitle: 'Fine-tune construction cost, growth rates, or connect your optional Cloudflare Worker + D1 property database.',
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

        <div class="sub-field" style="padding-top:10px; border-top:1px solid var(--border-subtle);">
          <label class="sub-label" for="prop-worker-url">Optional Cloudflare Worker + D1 API Endpoint</label>
          <input type="url" id="prop-worker-url" class="text-input" placeholder="https://paysense-property-api.<your-subdomain>.workers.dev" value="${escapeHtml(workerUrl)}" />
          <div class="field-hint">Leave blank to use built-in sharded suburb data + live OpenStreetMap / HDB APIs. Deploy <code>backend/cloudflare-worker/</code> for millions of cached D1 sales records.</div>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-primary" id="save-prop-modal-btn" data-close-popup>Save &amp; Close</button>
        </div>
      </div>
    `,
  });

  modal.querySelector('#prop-modal-controls')?.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'prop-worker-url') {
      setBackendWorkerUrl(t.value);
      return;
    }
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
    ['Address', propState.addressIntel?.resolvedAddress || 'Custom Property'],
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
  // Debounced live street-address autocomplete
  let acTimer = null;
  els.lookupInput.addEventListener('input', () => {
    selectedCandidate = null;
    clearTimeout(acTimer);
    const val = els.lookupInput.value.trim();
    if (val.length < 2) {
      els.autocompleteBox.hidden = true;
      return;
    }
    acTimer = setTimeout(async () => {
      autocompleteItems = await autocompleteAddress(val, propState.country);
      if (!autocompleteItems.length) {
        els.autocompleteBox.hidden = true;
        return;
      }
      els.autocompleteBox.innerHTML = autocompleteItems
        .map(
          (item, i) => `
          <button type="button" class="ac-option" data-ac-idx="${i}">
            <span class="ac-label">📍 ${escapeHtml(item.label)}</span>
            <span class="ac-source">${escapeHtml(item.source)}</span>
          </button>
        `
        )
        .join('');
      els.autocompleteBox.hidden = false;
    }, 240);
  });

  els.autocompleteBox.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ac-idx]');
    if (!btn) return;
    const picked = autocompleteItems[Number(btn.dataset.acIdx)];
    if (!picked) return;
    selectedCandidate = picked;
    els.lookupInput.value = picked.label;
    els.autocompleteBox.hidden = true;
    runAddressLookup(picked.label, els.lookupType.value, els.lookupBeds.value, picked);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.address-input-wrap')) {
      els.autocompleteBox.hidden = true;
    }
  });

  els.lookupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    runAddressLookup(els.lookupInput.value, els.lookupType.value, els.lookupBeds.value, selectedCandidate);
  });

  els.lookupType.addEventListener('change', () => {
    if (els.lookupInput.value.trim()) {
      runAddressLookup(els.lookupInput.value, els.lookupType.value, els.lookupBeds.value, selectedCandidate);
    }
  });

  els.lookupBeds.addEventListener('change', () => {
    if (els.lookupInput.value.trim()) {
      runAddressLookup(els.lookupInput.value, els.lookupType.value, els.lookupBeds.value, selectedCandidate);
    }
  });

  els.aiChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sample-idx]');
    if (!btn) return;
    const samples = SAMPLE_ADDRESSES_BY_COUNTRY[propState.country] || SAMPLE_ADDRESSES_BY_COUNTRY.AU;
    const s = samples[Number(btn.dataset.sampleIdx)];
    if (!s) return;
    els.lookupInput.value = s.address;
    els.lookupType.value = s.type;
    els.lookupBeds.value = String(s.beds);
    runAddressLookup(s.address, s.type, s.beds, null);
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
    const mmTypeBtn = e.target.closest('[data-mm-type]');
    if (mmTypeBtn) {
      propState.matchFilterType = mmTypeBtn.dataset.mmType;
      renderResultsOnly();
      return;
    }
    const loadSubBtn = e.target.closest('.load-suburb-btn');
    if (loadSubBtn) {
      const sub = loadSubBtn.dataset.suburb;
      const pc = loadSubBtn.dataset.postcode;
      const t = propState.matchFilterType;
      const b = t === 'house' ? 3 : 2;
      els.lookupInput.value = `12 Main St, ${sub} ${pc}`;
      els.lookupType.value = t;
      els.lookupBeds.value = String(b);
      runAddressLookup(`12 Main St, ${sub} ${pc}`, t, b, null);
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

  els.resultsRoot.addEventListener('change', (e) => {
    if (e.target.id === 'mm-city-select') {
      propState.matchFilterCity = e.target.value;
      renderResultsOnly();
    }
  });
}

async function init() {
  initGlobalHeader({
    activePage: 'property',
    onCountryChange: (newCode) => switchCountry(newCode),
  });
  renderSampleChips();
  bindEvents();
  await loadCountryAreasAndDefaultLookup();
}

init();
