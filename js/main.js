/**
 * PaySense AI — Main Application Bootstrap & Event Orchestration
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
  loadTheme,
  saveTheme,
  savePinnedScenarios,
} from './state.js';
import { renderCalculatorForm } from './ui/formRenderer.js';
import { renderResultsDashboard } from './ui/resultsRenderer.js';

const EXAMPLE_PROMPTS = [
  {
    label: '🇦🇺 AU $950/day contractor vs $165k FTE',
    prompt: 'AU contractor $950/day, 220 days, incl super, compare with $165k FTE',
  },
  {
    label: '🇺🇸 US $150k CA, married, 6% 401k',
    prompt: 'US $150k salary in California, married, 6% 401k',
  },
  {
    label: '🇬🇧 UK £600/day Outside IR35',
    prompt: 'UK £600/day contractor outside IR35, 220 days, 10% pension',
  },
  {
    label: '🇮🇳 India ₹36L freelancer 44ADA',
    prompt: 'India 36L freelancer under 44ADA vs 32L salary',
  },
  {
    label: '🎯 Target $10k/mo take-home in AU',
    prompt: 'How much do I need to earn in Australia to take home $10,000/month?',
  },
];

let state = decodeStateFromHash(window.location.hash, createInitialState());
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
  aiModePill: document.getElementById('ai-mode-pill'),
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  settingsModal: document.getElementById('ai-settings-modal'),
  settingsCloseBtn: document.getElementById('close-settings-btn'),
  settingsForm: document.getElementById('ai-settings-form'),
  toast: document.getElementById('toast'),
};

function init() {
  applyTheme(loadTheme());
  renderExampleChips();
  updateAiModeBadge();
  renderAll();
  bindGlobalEvents();
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  saveTheme(theme);
  if (els.themeToggleBtn) {
    els.themeToggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
    els.themeToggleBtn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }
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
    const label = llmConfig.provider === 'gemini' ? 'Gemini API (BYOK)' : 'Custom LLM (BYOK)';
    els.aiModePill.innerHTML = `<span class="status-dot live"></span> ${label}`;
  } else {
    els.aiModePill.innerHTML = `<span class="status-dot local"></span> Local AI · $0`;
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
    <div class="ai-feedback-inner">
      <div class="ai-feedback-top">
        <span class="ai-source-badge">${res.source === 'llm' ? '✨ Live AI' : '⚡ Instant Local AI'}</span>
        <div class="parsed-tags-wrap">${tagsHtml || '<span class="muted">Scenario updated</span>'}</div>
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
      // ignore sandbox history restriction
    }
  }
}

function switchCountry(newCode) {
  if (!COUNTRIES[newCode] || newCode === state.country) return;
  const c = COUNTRIES[newCode];
  state.country = newCode;
  state.hoursPerDay = c.standardHoursPerDay;
  state.hoursPerWeek = c.standardHoursPerWeek;
  state.billableDays = c.defaultBillableDays;
  state.amount = state.mode === 'contractor'
    ? (state.ratePeriod === 'hourly' ? c.defaultHourlyRate : state.ratePeriod === 'daily' ? c.defaultDayRate : c.defaultSalary)
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

  // Always run instant local parser first (zero latency, $0, 100% reliable)
  const localParsed = parseNaturalLanguage(text, state);
  let appliedSource = 'local';
  let llmReply = '';
  let patch = localParsed?.patch || {};
  let countryOptionPatch = localParsed?.countryOptionPatch || {};
  let targetNetAnnual = localParsed?.targetNetAnnual || null;
  let tags = localParsed?.tags || [];

  // Optional BYOK live LLM upgrade if user explicitly configured a free key
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
      els.aiSubmitBtn.textContent = 'Apply AI';
    }
  }

  const targetCountry = patch.country && COUNTRIES[patch.country] ? patch.country : state.country;
  const countryChanged = targetCountry !== state.country;
  const countryMeta = COUNTRIES[targetCountry];

  if (countryChanged) {
    state.country = targetCountry;
    state.hoursPerDay = countryMeta.standardHoursPerDay;
    state.hoursPerWeek = countryMeta.standardHoursPerWeek;
    state.billableDays = patch.billableDays ?? countryMeta.defaultBillableDays;
    // Reset default amount if prompt switched country without stating a new amount or target net
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

  // Apply country-specific option patches
  if (Object.keys(countryOptionPatch).length > 0) {
    state.countryOptions[state.country] = {
      ...state.countryOptions[state.country],
      ...countryOptionPatch,
    };
  }

  // Handle reverse goal calculation ("How much to earn to take home $10k/month?")
  if (targetNetAnnual && targetNetAnnual > 0) {
    const solved = solveGrossForTargetNet(targetNetAnnual, state);
    state.amount = Math.round(solved);
    const fmt = (n) => formatCurrency(n, countryMeta.currency, countryMeta.locale);
    const periodLabel = state.ratePeriod === 'daily' ? '/day' : state.ratePeriod === 'hourly' ? '/hr' : state.ratePeriod === 'monthly' ? '/mo' : '/yr';
    if (!llmReply) {
      llmReply = `To take home ${fmt(targetNetAnnual / 12)}/month (${fmt(targetNetAnnual)}/yr) in ${countryMeta.name}, you need a gross ${state.mode === 'contractor' ? 'rate' : 'salary'} of roughly ${fmt(state.amount)}${periodLabel}.`;
    }
  } else if (!localParsed?.matched && !llmReply) {
    llmReply = `Try including a country, rate, or tweak — e.g. "US $145k in Texas, 6% 401k", "drop to 200 days", or "15% raise".`;
  } else if (!llmReply) {
    // Generate crisp automatic summary from updated calc
    const previewCalc = calculatePay(state);
    const fmt = (n) => formatCurrency(n, countryMeta.currency, countryMeta.locale);
    llmReply = `Updated to ${countryMeta.name} (${state.mode === 'contractor' ? 'Contractor' : 'Full-Time'}): estimated take-home is ${fmt(previewCalc.periods.net.monthly)}/mo (${fmt(previewCalc.netIncome)}/yr) with a ${(previewCalc.effectiveTaxRate * 100).toFixed(1)}% effective tax rate.`;
  }

  state.lastAiResult = {
    rawText: text,
    tags,
    reply: llmReply,
    source: appliedSource,
  };

  renderAll();
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
  savePinnedScenarios(state.pinnedScenarios);
  renderResultsOnly();
  showToast('Scenario pinned for comparison!');
}

function exportCsv() {
  const c = currentCalc.country;
  const rows = [
    ['PaySense AI Pay Breakdown'],
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
  showToast('CSV exported!');
}

function bindGlobalEvents() {
  // AI prompt submit
  els.aiForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleAiPrompt(els.aiInput.value);
  });

  // Example prompt chips
  els.aiChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-example-idx]');
    if (!btn) return;
    const ex = EXAMPLE_PROMPTS[Number(btn.dataset.exampleIdx)];
    if (!ex) return;
    els.aiInput.value = ex.prompt;
    handleAiPrompt(ex.prompt);
  });

  // Dismiss AI feedback
  els.aiFeedback.addEventListener('click', (e) => {
    if (e.target.closest('#dismiss-ai-feedback')) {
      state.lastAiResult = null;
      renderAiFeedback();
    }
  });

  // Keyboard shortcut Cmd/Ctrl + K to focus AI bar
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      els.aiInput.focus();
      els.aiInput.select();
    }
    if (e.key === 'Escape' && !els.settingsModal.hidden) {
      els.settingsModal.hidden = true;
    }
  });

  // Theme toggle
  els.themeToggleBtn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });

  // Open / close BYOK AI settings modal
  els.aiModePill.addEventListener('click', () => {
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

  els.settingsCloseBtn.addEventListener('click', () => {
    els.settingsModal.hidden = true;
  });

  els.settingsModal.addEventListener('click', (e) => {
    if (e.target === els.settingsModal) els.settingsModal.hidden = true;
  });

  const providerSel = document.getElementById('llm-provider-select');
  providerSel?.addEventListener('change', toggleSettingsFields);

  els.settingsForm.addEventListener('submit', (e) => {
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
    showToast(isExternalLlmActive(llmConfig) ? 'BYOK AI enabled (stored locally in browser)' : 'Switched to built-in $0 Local AI');
  });

  // Delegated Form Events (keeps cursor focus smooth!)
  els.formRoot.addEventListener('click', (e) => {
    const countryBtn = e.target.closest('[data-country]');
    if (countryBtn) {
      switchCountry(countryBtn.dataset.country);
      return;
    }
    const modeBtn = e.target.closest('[data-mode]');
    if (modeBtn) {
      switchMode(modeBtn.dataset.mode);
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
      showToast(`Solved! Required gross: ${formatCurrency(state.amount, c.currency, c.locale)}`);
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
      if (badge) badge.textContent = `${state.billableDays}d`;
      renderResultsOnly();
    } else if (target.id === 'expenses-input') {
      state.businessExpenses = Math.max(0, Number(target.value) || 0);
      renderResultsOnly();
    } else if (target.id === 'bonus-input') {
      state.bonus = Math.max(0, Number(target.value) || 0);
      renderResultsOnly();
    } else if (target.id === 'hours-week-input') {
      state.hoursPerWeek = Math.max(1, Number(target.value) || 38);
      renderResultsOnly();
    } else if (target.id === 'hours-day-input') {
      state.hoursPerDay = Math.max(1, Number(target.value) || 8);
      renderResultsOnly();
    } else if (target.id === 'compare-input') {
      const val = Math.max(0, Number(target.value) || 0);
      if (state.mode === 'contractor') state.compareSalary = val;
      else state.compareDayRate = val;
      renderResultsOnly();
    } else if (target.dataset.opt && target.type === 'number') {
      state.countryOptions[state.country][target.dataset.opt] = Math.max(0, Number(target.value) || 0);
      renderResultsOnly();
    }
  });

  els.formRoot.addEventListener('change', (e) => {
    const target = e.target;
    if (target.id === 'rate-period-select') {
      state.ratePeriod = target.value;
      // Re-render form so hourly shows hours/day field cleanly
      renderAll();
      return;
    }
    if (target.dataset.opt) {
      const key = target.dataset.opt;
      if (target.dataset.type === 'boolean') {
        state.countryOptions[state.country][key] = target.checked;
      } else if (target.dataset.type === 'number') {
        state.countryOptions[state.country][key] = Number(target.value) || 0;
      } else {
        state.countryOptions[state.country][key] = target.value;
      }
      // India regime switch toggles extra Old Regime deductions input
      if (state.country === 'IN' && key === 'regime') {
        renderAll();
      } else {
        renderResultsOnly();
      }
    }
  });

  // Delegated Results Dashboard Events
  els.resultsRoot.addEventListener('click', (e) => {
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
        navigator.clipboard.writeText(shareUrl).then(() => showToast('Share link copied to clipboard!')).catch(() => showToast('URL updated — copy from address bar!'));
      } else {
        showToast('URL updated — copy from address bar!');
      }
      return;
    }
    if (e.target.closest('#export-csv-btn')) {
      exportCsv();
      return;
    }
    if (e.target.closest('#clear-pins-btn')) {
      state.pinnedScenarios = [];
      savePinnedScenarios([]);
      renderResultsOnly();
      return;
    }
    const rmBtn = e.target.closest('.remove-pin-btn');
    if (rmBtn) {
      const idx = Number(rmBtn.dataset.pinIdx);
      state.pinnedScenarios.splice(idx, 1);
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
  const modelInput = document.getElementById('llm-model-input');
  if (keyGroup) keyGroup.hidden = provider === 'local';
  if (urlGroup) urlGroup.hidden = provider !== 'openai-compatible';
  if (modelInput && provider === 'gemini' && !modelInput.value) {
    modelInput.value = 'gemini-2.5-flash';
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
