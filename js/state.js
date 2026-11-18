/**
 * Reactive state store with localStorage persistence & zero-backend URL hash sharing.
 */

import { COUNTRIES } from './tax/countries.js';
import { getCountryDefaultOptions } from './tax/calculator.js';

const PINS_STORAGE_KEY = 'paysense_pinned_scenarios_v1';
const THEME_STORAGE_KEY = 'paysense_theme_v1';

export function createInitialState() {
  const countryOptions = {};
  for (const code of Object.keys(COUNTRIES)) {
    countryOptions[code] = getCountryDefaultOptions(code);
  }

  return {
    country: 'AU',
    mode: 'contractor', // start showcasing contractor or employee cleanly — let's default to AU contractor/employee friendly! Actually let's start in AU Employee or AU Contractor? Let's start with AU Employee ($135k) OR AU Contractor ($900/day) — both are 1 click! Starting in 'contractor' ($900/day, 220 days) immediately shows off contractor + FTE comparison!
    amount: 900,
    ratePeriod: 'daily', // 'annual' | 'monthly' | 'fortnightly' | 'weekly' | 'daily' | 'hourly'
    bonus: 0,
    billableDays: 220,
    hoursPerDay: 8,
    hoursPerWeek: 38,
    businessExpenses: 5000,
    compareSalary: 165000,
    compareDayRate: 900,
    displayPeriod: 'monthly', // KPI hero highlight period
    reverseGoalActive: false,
    targetNetDisplay: 10000,
    targetNetPeriod: 'monthly',
    countryOptions,
    lastAiResult: null, // { rawText, tags, reply, source: 'local'|'llm' }
    pinnedScenarios: loadPinnedScenarios(),
    comparisonCurrency: 'USD',
  };
}

export function loadPinnedScenarios() {
  try {
    const raw = localStorage.getItem(PINS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 4) : [];
  } catch {
    return [];
  }
}

export function savePinnedScenarios(list) {
  try {
    localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify(list.slice(0, 4)));
  } catch {
    // ignore
  }
}

export function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // ignore
  }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

/**
 * Encode active calculator scenario into a compact URL hash (#s=...) for free sharing.
 */
export function encodeStateToHash(state) {
  const minimal = {
    c: state.country,
    m: state.mode,
    a: state.amount,
    p: state.ratePeriod,
    b: state.bonus,
    d: state.billableDays,
    hd: state.hoursPerDay,
    hw: state.hoursPerWeek,
    e: state.businessExpenses,
    cs: state.compareSalary,
    cd: state.compareDayRate,
    dp: state.displayPeriod,
    o: state.countryOptions?.[state.country] || {},
  };
  try {
    const json = JSON.stringify(minimal);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return `#s=${b64}`;
  } catch {
    return '';
  }
}

export function decodeStateFromHash(hashStr, baseState) {
  if (!hashStr || !hashStr.startsWith('#s=')) return baseState;
  try {
    const b64 = hashStr.slice(3);
    const json = decodeURIComponent(escape(atob(b64)));
    const d = JSON.parse(json);
    if (!d || !COUNTRIES[d.c]) return baseState;
    const merged = {
      ...baseState,
      country: d.c,
      mode: d.m === 'contractor' ? 'contractor' : 'employee',
      amount: Number(d.a) || baseState.amount,
      ratePeriod: d.p || baseState.ratePeriod,
      bonus: Number(d.b) || 0,
      billableDays: Number(d.d) || COUNTRIES[d.c].defaultBillableDays,
      hoursPerDay: Number(d.hd) || COUNTRIES[d.c].standardHoursPerDay,
      hoursPerWeek: Number(d.hw) || COUNTRIES[d.c].standardHoursPerWeek,
      businessExpenses: Number(d.e) || 0,
      compareSalary: Number(d.cs) || 0,
      compareDayRate: Number(d.cd) || 0,
      displayPeriod: d.dp || 'monthly',
      countryOptions: {
        ...baseState.countryOptions,
        [d.c]: {
          ...baseState.countryOptions[d.c],
          ...(d.o || {}),
        },
      },
    };
    return merged;
  } catch {
    return baseState;
  }
}
