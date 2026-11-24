/**
 * PaySense — Main Application Bootstrap & Event Orchestration (index.html)
 * Uses Global Country Selector in top header + Compact Animated Stage + Pop-Up Tax Options Modal.
 */

import { COUNTRIES } from './tax/countries.js';
import { calculatePay, solveGrossForTargetNet } from './tax/calculator.js';
import { formatCurrency } from './tax/brackets.js';
import { parseNaturalLanguage } from './ai/nlParser.js';
import { loadLlmConfig, saveLlmConfig, isExternalLlmActive, parseAndAdviseWithLlm } from './ai/llmClient.js';
import {
  createInitialState,
  decodeStateFromHash,
  encodeStateToHash,
  savePinnedScenarios,
} from './state.js';
import { renderCalculatorForm, renderTaxOptionsModalHtml } from './ui/formRenderer.js';
import { renderResultsDashboard } from './ui/resultsRenderer.js';
import {
  initGlobalHeader,
  getGlobalCountry,
  setGlobalCountry,
  openPopupModal,
} from './ui/globalHeader.js';

const EXAMPLE_PROMPTS = [
  {
    label: '🇦🇺 $950/day contractor vs $165k FTE',
    prompt: 'AU contractor $950/day, 220 days, incl super, compare with $165k FTE',
  },
  {
    label: '🇺🇸 $150k California, married, 6% 401k',
    prompt: 'US $150k salary in California, married, 6% 401k',
  },
  {
    label: '🇬🇧 £600/day Outside IR35',
    prompt: 'UK £600/day contractor outside IR35, 220 days, 10% pension',
  },
  {
    label: '🇮🇳 ₹36L freelancer 44ADA',
    prompt: 'India 36L freelancer under 44ADA vs 32L salary',
  },
  {
    label: '🎯 Target $10k/mo take-home',
    prompt: 'How much do I need to earn to take home $10,000/month?',
  },
];

let baseInit = createInitialState();
baseInit.country = getGlobalCountry();
let state = decodeStateFromHash(window.location.hash, baseInit);
setGlobalCountry(state.country);

let llmConfig = loadLlmConfig();
let currentCalc = calculatePay(state);

const els = {
  formRoot: document.getElementById('form-root'),
  resultsRoot: document.getElementById('results-root'),
  aiForm: document.getElementById('ai-prompt-form'),
  aiInput: document.getElementById('ai-prompt-input'),
  aiSubmitBtn: document.getElementById('ai-submit-btn'),
  aiChips: document.getElementById('ai-example-chips'),
  aiFeedback: document.getElementById('ai-feedback'),
  settingsModal: document.getElementById('ai-settings-modal'),
  settingsCloseBtn: document.getElementById('close-settings-btn'),
  settingsForm: document.getElementById('ai-settings-form'),
  toast: document.getElementById('toast'),
};

function init() {
  initGlobalHeader({
    activePage: 'pay',
    onCountryChange: (newCode) => switchCountry(newCode),
    extraActionHtml: `<button type="button" class="ai-mode-pill" id="ai-mode-pill" title="Optional free AI key settings"></button>`,
  });
  els.aiModePill = document.getElementById('ai-mode-pill');
  els.themeToggleBtn = document.getElementById('theme-toggle-btn');

  // If country in state didn't come from URL hash, sync defaults to global country
  if (!window.location.hash && state.country !== 'AU') {
    const c = COUNTRIES[state.country];
    state.amount = state.mode === 'contractor' ? c.defaultDayRate : c.defaultSalary;
    state.compareSalary = Math.round(c.defaultSalary * 1.15);
    state.compareDayRate = c.defaultDayRate;
  }

  renderExampleChips();
  updateAiModeBadge();
  renderAll();
  bindGlobalEvents();
}

function showToast(msg) {
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.classList.add('visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove('visible'), 2600);
}

function renderExampleChips() {
  if (!els.aiChips) return;
  els.aiChips.innerHTML = EXAMPLE_PROMPTS.map(
    (ex, i) => `<button type="button" class="prompt-chip" data-example-idx="${i}">${ex.label}</button>`
  ).join('');
}

function updateAiModeBadge() {
  if (!els.aiModePill) return;
  if (isExternalLlmActive(llmConfig)) {
    const label = llmConfig.provider === 'gemini' ? 'Gemini AI' : 'Custom AI';
    els.aiModePill.innerHTML = `<span class="status-dot live"></span> ${label}`;
  } else {
    els.aiModePill.innerHTML = `<span class="status-dot local"></span> Local AI`;
  }
}

function renderAiFeedback() {
  if (!els.aiFeedback) return;
  const res = state.lastAiResult;
  if (!res) {
    els.aiFeedback.hidden = true;
    els.aiFeedback.innerHTML = '';
    return;
  }

  const tagsHtml = (res.tags || [])
    .map((t) => `<span class="parsed-tag tag-${t.kind || 'option'}">${escapeHtml(t.label)}</span>`)
    .join('');

  els.aiFeedback.hidden = false;
  els.aiFeedback.innerHTML = `
    <div class="ai-feedback-inner animate-stage">
      <div class="ai-feedback-top">
        <span class="ai-source-badge">${res.source === 'llm' ? 'Live AI' : 'Instant Helper'}</span>
        <div class="parsed-tags-wrap">${tagsHtml || '<span class="muted">Updated</span>'}</div>
        <button type="button" class="icon-btn" id="dismiss-ai-feedback" title="Dismiss">✕</button>
      </div>
      ${res.reply ? `<div class="ai-reply-text">${escapeHtml(res.reply)}</div>` : ''}
    </div>
  `;
}

function renderAll() {
  currentCalc = calculatePay(state);
  renderCalculatorForm(els.formRoot, state);
  renderResultsDashboard(els.resultsRoot, state, currentCalc);
  renderAiFeedback();
  syncUrlHash();
}

function renderResultsOnly() {
  currentCalc = calculatePay(state);
  renderResultsDashboard(els.resultsRoot, state, currentCalc);
  syncUrlHash();
}

function syncUrlHash() {
  const hash = encodeStateToHash(state);
  if (hash && window.location.hash !== hash) {
    try {
      history.replaceState(null, '', hash);
    } catch {
      // ignore
    }
  }
}

function switchCountry(newCode) {
  if (!COUNTRIES[newCode] || newCode === state.country) return;
  const c = COUNTRIES[newCode];
  state.country = newCode;
  setGlobalCountry(newCode);
  state.hoursPerDay = c.standardHoursPerDay;
  state.hoursPerWeek = c.standardHoursPerWeek;
  state.billableDays = c.defaultBillableDays;
  state.amount =
    state.mode === 'contractor'
      ? state.ratePeriod === 'hourly'
        ? c.defaultHourlyRate
        : state.ratePeriod === 'daily'
          ? c.defaultDayRate
          : c.defaultSalary
      : c.defaultSalary;
  if (state.mode === 'employee') state.ratePeriod = 'annual';
  state.businessExpenses = state.mode === 'contractor' ? Math.round(c.defaultSalary * 0.04) : 0;
  state.compareSalary = Math.round(c.defaultSalary * 1.15);
  state.compareDayRate = c.defaultDayRate;
  renderAll();
}

function switchMode(newMode) {
  if (newMode === state.mode) return;
  const c = COUNTRIES[state.country];
  state.mode = newMode;
  if (newMode === 'contractor') {
    state.ratePeriod = 'daily';
    state.amount = c.defaultDayRate;
    state.billableDays = c.defaultBillableDays;
    state.businessExpenses = Math.round(c.defaultSalary * 0.04);
    state.compareSalary = Math.round(c.defaultSalary * 1.15);
  } else {
    state.ratePeriod = 'annual';
    state.amount = c.defaultSalary;
    state.bonus = 0;
    state.compareDayRate = c.defaultDayRate;
  }
  renderAll();
}

async function handleAiPrompt(rawText) {
  const text = (rawText || '').trim();
  if (!text) return;

  const localParsed = parseNaturalLanguage(text, state);
  let appliedSource = 'local';
  let llmReply = '';
  let patch = localParsed?.patch || {};
  let countryOptionPatch = localParsed?.countryOptionPatch || {};
  let targetNetAnnual = localParsed?.targetNetAnnual || null;
  let tags = localParsed?.tags || [];

  if (isExternalLlmActive(llmConfig)) {
    els.aiSubmitBtn.disabled = true;
    els.aiSubmitBtn.textContent = 'Thinking…';
    try {
      const llmRes = await parseAndAdviseWithLlm(text, state, currentCalc, llmConfig);
      if (llmRes) {
        appliedSource = 'llm';
        patch = { ...patch, ...(llmRes.patch || {}) };
        countryOptionPatch = { ...countryOptionPatch, ...(llmRes.countryOptionPatch || {}) };
        if (llmRes.targetNetAnnual) targetNetAnnual = llmRes.targetNetAnnual;
        llmReply = llmRes.reply || '';
      }
    } catch (err) {
      showToast(err.message || 'External LLM unavailable — used built-in Local AI.');
    } finally {
      els.aiSubmitBtn.disabled = false;
      els.aiSubmitBtn.textContent = 'Work It Out';
    }
  }

  const targetCountry = patch.country && COUNTRIES[patch.country] ? patch.country : state.country;
  const countryChanged = targetCountry !== state.country;
  const countryMeta = COUNTRIES[targetCountry];

  if (countryChanged) {
    state.country = targetCountry;
    setGlobalCountry(targetCountry);
    state.hoursPerDay = countryMeta.standardHoursPerDay;
    state.hoursPerWeek = countryMeta.standardHoursPerWeek;
    state.billableDays = patch.billableDays ?? countryMeta.defaultBillableDays;
    if (patch.amount === undefined && !targetNetAnnual) {
      const nextMode = patch.mode || state.mode;
      state.amount = nextMode === 'contractor' ? countryMeta.defaultDayRate : countryMeta.defaultSalary;
      state.ratePeriod = nextMode === 'contractor' ? 'daily' : 'annual';
    }
    state.compareSalary = 0;
    state.compareDayRate = 0;
    if (patch.businessExpenses === undefined) state.businessExpenses = 0;
    state.bonus = 0;
  }

  if (patch.mode) state.mode = patch.mode;
  if (patch.ratePeriod) state.ratePeriod = patch.ratePeriod;
  if (patch.amount !== undefined) state.amount = patch.amount;
  if (patch.billableDays !== undefined) state.billableDays = patch.billableDays;
  if (patch.businessExpenses !== undefined) state.businessExpenses = patch.businessExpenses;
  if (patch.compareSalary !== undefined) state.compareSalary = patch.compareSalary;
  if (patch.compareDayRate !== undefined) state.compareDayRate = patch.compareDayRate;

  if (Object.keys(countryOptionPatch).length > 0) {
    state.countryOptions[state.country] = {
      ...state.countryOptions[state.country],
      ...countryOptionPatch,
    };
  }

  if (targetNetAnnual && targetNetAnnual > 0) {
    const solved = solveGrossForTargetNet(targetNetAnnual, state);
    state.amount = Math.round(solved);
    const fmt = (n) => formatCurrency(n, countryMeta.currency, countryMeta.locale);
    const periodLabel = state.ratePeriod === 'daily' ? '/day' : state.ratePeriod === 'hourly' ? '/hr' : state.ratePeriod === 'monthly' ? '/mo' : '/yr';
    if (!llmReply) {
      llmReply = `To take home ${fmt(targetNetAnnual / 12)}/month (${fmt(targetNetAnnual)}/yr) in ${countryMeta.name}, you need a gross ${state.mode === 'contractor' ? 'rate' : 'salary'} of roughly ${fmt(state.amount)}${periodLabel}.`;
    }
  } else if (!localParsed?.matched && !llmReply) {
    llmReply = `Try including a rate or tweak — e.g. "US $145k in Texas, 6% 401k", "drop to 200 days", or "15% raise".`;
  } else if (!llmReply) {
    const previewCalc = calculatePay(state);
    const fmt = (n) => formatCurrency(n, countryMeta.currency, countryMeta.locale);
    llmReply = `Updated to ${countryMeta.name} (${state.mode === 'contractor' ? 'Contractor' : 'Full-Time'}): estimated take-home is ${fmt(previewCalc.periods.net.monthly)}/mo (${fmt(previewCalc.netIncome)}/yr) with a ${(previewCalc.effectiveTaxRate * 100).toFixed(1)}% overall tax rate.`;
  }

  state.lastAiResult = {
    rawText: text,
    tags,
    reply: llmReply,
    source: appliedSource,
  };

  renderAll();
}

function openTaxOptionsPopup() {
  const c = COUNTRIES[state.country];
  const modal = openPopupModal({
    title: `${c.flag} ${c.name} Tax & ${c.retirementLabel} Settings`,
    subtitle: `Customize residency, student loans, ${c.retirementLabel}, and deductions for ${c.taxYear}.`,
    bodyHtml: renderTaxOptionsModalHtml(state),
    wide: false,
  });

  const controls = modal.querySelector('#tax-modal-controls');
  controls?.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'bonus-input') {
      state.bonus = Math.max(0, Number(t.value) || 0);
      renderResultsOnly();
    } else if (t.id === 'hours-week-input') {
      state.hoursPerWeek = Math.max(1, Number(t.value) || 38);
      renderResultsOnly();
    } else if (t.dataset.opt && t.type === 'number') {
      state.countryOptions[state.country][t.dataset.opt] = Math.max(0, Number(t.value) || 0);
      renderResultsOnly();
    }
  });

  controls?.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.dataset.opt) return;
    const key = t.dataset.opt;
    if (t.dataset.type === 'boolean') {
      state.countryOptions[state.country][key] = t.checked;
    } else if (t.dataset.type === 'number') {
      state.countryOptions[state.country][key] = Number(t.value) || 0;
    } else {
      state.countryOptions[state.country][key] = t.value;
    }
    if (state.country === 'IN' && key === 'regime') {
      openTaxOptionsPopup();
    }
    renderResultsOnly();
  });
}

function pinCurrentScenario() {
  const c = COUNTRIES[state.country];
  const fmt = (n) => formatCurrency(n, c.currency, c.locale);
  const periodShort = { annual: '/yr', monthly: '/mo', fortnightly: '/fn', weekly: '/wk', daily: '/day', hourly: '/hr' }[state.ratePeriod] || '';
  const entry = {
    country: state.country,
    mode: state.mode,
    label: `${c.name} · ${fmt(state.amount)}${periodShort}`,
    subtitle: state.mode === 'contractor' ? `${state.billableDays}d/yr` : c.taxYear,
    netIncome: currentCalc.netIncome,
    totalRetirement: currentCalc.totalRetirement,
    effectiveTaxRate: currentCalc.effectiveTaxRate,
  };
  state.pinnedScenarios = [entry, ...(state.pinnedScenarios || [])].slice(0, 4);
  state.stageView = 'saved';
  savePinnedScenarios(state.pinnedScenarios);
  renderResultsOnly();
  showToast('Scenario saved to Saved tab!');
}

function exportCsv() {
  const c = currentCalc.country;
  const rows = [
    ['PaySense Pay Breakdown'],
    ['Country', `${c.name} (${c.taxYear})`],
    ['Mode', currentCalc.mode === 'contractor' ? 'Contractor' : 'Full-Time Employee'],
    ['Currency', c.currency],
    [],
    ['Line Item', 'Annual Amount', 'Monthly Amount', 'Note'],
    ...currentCalc.lineItems.map((item) => [
      item.label,
      item.amount.toFixed(2),
      (item.amount / 12).toFixed(2),
      item.note || '',
    ]),
  ];
  const csv = rows
    .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `paysense-${c.code.toLowerCase()}-${currentCalc.mode}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV downloaded!');
}

function bindGlobalEvents() {
  els.aiForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleAiPrompt(els.aiInput.value);
  });

  els.aiChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-example-idx]');
    if (!btn) return;
    const ex = EXAMPLE_PROMPTS[Number(btn.dataset.exampleIdx)];
    if (!ex) return;
    els.aiInput.value = ex.prompt;
    handleAiPrompt(ex.prompt);
  });

  els.aiFeedback.addEventListener('click', (e) => {
    if (e.target.closest('#dismiss-ai-feedback')) {
      state.lastAiResult = null;
      renderAiFeedback();
    }
  });

  els.aiModePill?.addEventListener('click', () => {
    const prov = document.getElementById('llm-provider-select');
    const key = document.getElementById('llm-api-key');
    const model = document.getElementById('llm-model-input');
    const baseUrl = document.getElementById('llm-base-url');
    if (prov) prov.value = llmConfig.provider;
    if (key) key.value = llmConfig.apiKey || '';
    if (model) model.value = llmConfig.model || 'gemini-2.5-flash';
    if (baseUrl) baseUrl.value = llmConfig.baseUrl || 'https://api.groq.com/openai/v1';
    toggleSettingsFields();
    els.settingsModal.hidden = false;
  });

  els.settingsCloseBtn?.addEventListener('click', () => {
    els.settingsModal.hidden = true;
  });

  els.settingsModal?.addEventListener('click', (e) => {
    if (e.target === els.settingsModal) els.settingsModal.hidden = true;
  });

  document.getElementById('llm-provider-select')?.addEventListener('change', toggleSettingsFields);

  els.settingsForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    llmConfig = {
      provider: document.getElementById('llm-provider-select').value,
      apiKey: document.getElementById('llm-api-key').value.trim(),
      model: document.getElementById('llm-model-input').value.trim() || 'gemini-2.5-flash',
      baseUrl: document.getElementById('llm-base-url').value.trim(),
    };
    saveLlmConfig(llmConfig);
    updateAiModeBadge();
    els.settingsModal.hidden = true;
    showToast(isExternalLlmActive(llmConfig) ? 'BYOK AI enabled' : 'Using built-in $0 Local AI');
  });

  els.formRoot.addEventListener('click', (e) => {
    const modeBtn = e.target.closest('[data-mode]');
    if (modeBtn) {
      switchMode(modeBtn.dataset.mode);
      return;
    }
    if (e.target.closest('#open-tax-options-popup')) {
      openTaxOptionsPopup();
      return;
    }
    if (e.target.closest('#toggle-reverse-btn')) {
      state.reverseGoalActive = !state.reverseGoalActive;
      state.targetNetDisplay = Math.round(currentCalc.periods.net[state.targetNetPeriod] || 10000);
      renderAll();
      return;
    }
    if (e.target.closest('#apply-reverse-btn')) {
      const targetVal = Math.max(0, Number(document.getElementById('target-net-input')?.value) || 0);
      const targetPer = document.getElementById('target-net-period')?.value || 'monthly';
      state.targetNetDisplay = targetVal;
      state.targetNetPeriod = targetPer;
      const mult = targetPer === 'monthly' ? 12 : targetPer === 'fortnightly' ? 26 : targetPer === 'weekly' ? 52 : 1;
      const solved = solveGrossForTargetNet(targetVal * mult, state);
      state.amount = Math.round(solved);
      state.reverseGoalActive = false;
      const c = COUNTRIES[state.country];
      showToast(`Required gross: ${formatCurrency(state.amount, c.currency, c.locale)}`);
      renderAll();
    }
  });

  els.formRoot.addEventListener('input', (e) => {
    const target = e.target;
    if (target.id === 'amount-input') {
      state.amount = Math.max(0, Number(target.value) || 0);
      renderResultsOnly();
    } else if (target.id === 'billable-days-slider') {
      state.billableDays = Number(target.value) || 220;
      const badge = document.getElementById('billable-days-val');
      if (badge) badge.textContent = `${state.billableDays} days`;
      renderResultsOnly();
    } else if (target.id === 'expenses-input') {
      state.businessExpenses = Math.max(0, Number(target.value) || 0);
      renderResultsOnly();
    } else if (target.id === 'compare-input') {
      const val = Math.max(0, Number(target.value) || 0);
      if (state.mode === 'contractor') state.compareSalary = val;
      else state.compareDayRate = val;
      renderResultsOnly();
    }
  });

  els.formRoot.addEventListener('change', (e) => {
    if (e.target.id === 'rate-period-select') {
      state.ratePeriod = e.target.value;
      renderAll();
    }
  });

  els.resultsRoot.addEventListener('click', (e) => {
    const stageBtn = e.target.closest('[data-stage-view]');
    if (stageBtn) {
      state.stageView = stageBtn.dataset.stageView;
      renderResultsOnly();
      return;
    }
    const periodBtn = e.target.closest('[data-display-period]');
    if (periodBtn) {
      state.displayPeriod = periodBtn.dataset.displayPeriod;
      renderResultsOnly();
      return;
    }
    if (e.target.closest('#pin-scenario-btn')) {
      pinCurrentScenario();
      return;
    }
    if (e.target.closest('#share-link-btn')) {
      syncUrlHash();
      const shareUrl = window.location.href;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(shareUrl).then(() => showToast('Link copied!')).catch(() => showToast('URL updated in address bar!'));
      } else {
        showToast('URL updated in address bar!');
      }
      return;
    }
    if (e.target.closest('#export-csv-btn')) {
      exportCsv();
      return;
    }
    if (e.target.closest('#clear-pins-btn')) {
      state.pinnedScenarios = [];
      state.stageView = 'overview';
      savePinnedScenarios([]);
      renderResultsOnly();
      return;
    }
    const rmBtn = e.target.closest('.remove-pin-btn');
    if (rmBtn) {
      const idx = Number(rmBtn.dataset.pinIdx);
      state.pinnedScenarios.splice(idx, 1);
      if (!state.pinnedScenarios.length) state.stageView = 'overview';
      savePinnedScenarios(state.pinnedScenarios);
      renderResultsOnly();
    }
  });

  els.resultsRoot.addEventListener('change', (e) => {
    if (e.target.id === 'compare-currency-select') {
      state.comparisonCurrency = e.target.value;
      renderResultsOnly();
    }
  });
}

function toggleSettingsFields() {
  const provider = document.getElementById('llm-provider-select')?.value;
  const keyGroup = document.getElementById('llm-key-group');
  const urlGroup = document.getElementById('llm-url-group');
  if (keyGroup) keyGroup.hidden = provider === 'local';
  if (urlGroup) urlGroup.hidden = provider !== 'openai-compatible';
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
