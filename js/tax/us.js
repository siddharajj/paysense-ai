/**
 * United States Tax & Pay Engine — 2025 Tax Year
 * Supports W-2 Employee & 1099 Independent Contractor modes.
 */

import { calculateProgressiveTax, clamp } from './brackets.js';

const STANDARD_DEDUCTION = {
  single: 15000,
  married: 30000,
  hoh: 22500,
};

const FED_BRACKETS = {
  single: [
    { min: 0, max: 11925, rate: 0.10, label: '$0 – $11.9k (10%)' },
    { min: 11925, max: 48475, rate: 0.12, label: '$11.9k – $48.5k (12%)' },
    { min: 48475, max: 103350, rate: 0.22, label: '$48.5k – $103.4k (22%)' },
    { min: 103350, max: 197300, rate: 0.24, label: '$103.4k – $197.3k (24%)' },
    { min: 197300, max: 250525, rate: 0.32, label: '$197.3k – $250.5k (32%)' },
    { min: 250525, max: 626350, rate: 0.35, label: '$250.5k – $626.4k (35%)' },
    { min: 626350, max: Infinity, rate: 0.37, label: '$626.4k+ (37%)' },
  ],
  married: [
    { min: 0, max: 23850, rate: 0.10, label: '$0 – $23.9k (10%)' },
    { min: 23850, max: 96950, rate: 0.12, label: '$23.9k – $97.0k (12%)' },
    { min: 96950, max: 206700, rate: 0.22, label: '$97.0k – $206.7k (22%)' },
    { min: 206700, max: 394600, rate: 0.24, label: '$206.7k – $394.6k (24%)' },
    { min: 394600, max: 501050, rate: 0.32, label: '$394.6k – $501.1k (32%)' },
    { min: 501050, max: 751600, rate: 0.35, label: '$501.1k – $751.6k (35%)' },
    { min: 751600, max: Infinity, rate: 0.37, label: '$751.6k+ (37%)' },
  ],
  hoh: [
    { min: 0, max: 17000, rate: 0.10, label: '$0 – $17.0k (10%)' },
    { min: 17000, max: 64850, rate: 0.12, label: '$17.0k – $64.9k (12%)' },
    { min: 64850, max: 103350, rate: 0.22, label: '$64.9k – $103.4k (22%)' },
    { min: 103350, max: 197300, rate: 0.24, label: '$103.4k – $197.3k (24%)' },
    { min: 197300, max: 250500, rate: 0.32, label: '$197.3k – $250.5k (32%)' },
    { min: 250500, max: 626350, rate: 0.35, label: '$250.5k – $626.4k (35%)' },
    { min: 626350, max: Infinity, rate: 0.37, label: '$626.4k+ (37%)' },
  ],
};

// Effective/progressive approximations for top US states
export const US_STATES = {
  TX: { name: 'Texas (0%)', type: 'flat', rate: 0 },
  FL: { name: 'Florida (0%)', type: 'flat', rate: 0 },
  WA: { name: 'Washington (0%)', type: 'flat', rate: 0 },
  NV: { name: 'Nevada (0%)', type: 'flat', rate: 0 },
  CA: {
    name: 'California',
    type: 'progressive',
    stdDed: 5540,
    brackets: [
      { min: 0, max: 10756, rate: 0.01 },
      { min: 10756, max: 25499, rate: 0.02 },
      { min: 25499, max: 40245, rate: 0.04 },
      { min: 40245, max: 55866, rate: 0.06 },
      { min: 55866, max: 70606, rate: 0.08 },
      { min: 70606, max: 360659, rate: 0.093 },
      { min: 360659, max: 432787, rate: 0.103 },
      { min: 432787, max: 721314, rate: 0.113 },
      { min: 721314, max: Infinity, rate: 0.123 },
    ],
  },
  NY: {
    name: 'New York (State)',
    type: 'progressive',
    stdDed: 8000,
    brackets: [
      { min: 0, max: 8500, rate: 0.04 },
      { min: 8500, max: 11700, rate: 0.045 },
      { min: 11700, max: 13900, rate: 0.0525 },
      { min: 13900, max: 80650, rate: 0.055 },
      { min: 80650, max: 215400, rate: 0.06 },
      { min: 215400, max: 1077550, rate: 0.0685 },
      { min: 1077550, max: Infinity, rate: 0.0965 },
    ],
  },
  NYC: {
    name: 'New York City (State + City)',
    type: 'progressive',
    stdDed: 8000,
    brackets: [
      { min: 0, max: 12000, rate: 0.072 },
      { min: 12000, max: 50000, rate: 0.091 },
      { min: 50000, max: 80650, rate: 0.0937 },
      { min: 80650, max: 215400, rate: 0.0988 },
      { min: 215400, max: Infinity, rate: 0.1073 },
    ],
  },
  IL: { name: 'Illinois (4.95%)', type: 'flat', rate: 0.0495 },
  MA: { name: 'Massachusetts (5.0%)', type: 'flat', rate: 0.05 },
  CO: { name: 'Colorado (4.4%)', type: 'flat', rate: 0.044 },
  NC: { name: 'North Carolina (4.25%)', type: 'flat', rate: 0.0425 },
  PA: { name: 'Pennsylvania (3.07%)', type: 'flat', rate: 0.0307 },
  GA: { name: 'Georgia (5.39%)', type: 'flat', rate: 0.0539 },
  VA: { name: 'Virginia (~5.4%)', type: 'flat', rate: 0.054 },
  NJ: { name: 'New Jersey (~6.0%)', type: 'flat', rate: 0.06 },
  AZ: { name: 'Arizona (2.5%)', type: 'flat', rate: 0.025 },
  OR: { name: 'Oregon (~8.5%)', type: 'flat', rate: 0.085 },
};

export function defaultOptions() {
  return {
    filingStatus: 'single', // 'single' | 'married' | 'hoh'
    state: 'CA',
    retirementPct: 6, // 401(k) or Solo 401(k) %
    employerMatchPct: 4, // employer 401(k) match (employee mode)
    hsaAnnual: 0, // pre-tax HSA / health premiums
    useQbiDeduction: true, // 1099 20% Section 199A QBI deduction
  };
}

function calcStateTax(agi, stateCode, filingStatus) {
  const st = US_STATES[stateCode] || US_STATES.CA;
  if (st.type === 'flat') {
    const taxable = Math.max(0, agi);
    return { tax: taxable * st.rate, marginal: st.rate, name: st.name };
  }
  const ded = (st.stdDed || 0) * (filingStatus === 'married' ? 2 : 1);
  const scale = filingStatus === 'married' ? 2 : 1;
  const scaledBrackets = st.brackets.map((b) => ({
    ...b,
    min: b.min * scale,
    max: Number.isFinite(b.max) ? b.max * scale : Infinity,
  }));
  const res = calculateProgressiveTax(Math.max(0, agi - ded), scaledBrackets);
  return { tax: res.totalTax, marginal: res.marginalRate, name: st.name };
}

export function calculate(annualGross, mode, rawOptions = {}) {
  const opts = { ...defaultOptions(), ...rawOptions };
  const isContractor = mode === 'contractor';
  const filing = FED_BRACKETS[opts.filingStatus] ? opts.filingStatus : 'single';
  const businessExpenses = isContractor ? Math.max(0, Number(opts.businessExpenses) || 0) : 0;

  const netBusinessOrWage = Math.max(0, annualGross - businessExpenses);
  const retirementPct = clamp(Number(opts.retirementPct) || 0, 0, 50) / 100;
  // 2025 401(k) elective deferral cap $23,500 (Solo 401k allows higher total, cap at $69k for contractors)
  const retirementCap = isContractor ? 69000 : 23500;
  const employeeRetirement = Math.min(netBusinessOrWage * retirementPct, retirementCap);
  const employerRetirement = isContractor
    ? 0
    : annualGross * (clamp(Number(opts.employerMatchPct) || 0, 0, 20) / 100);

  const hsaAnnual = Math.min(Math.max(0, Number(opts.hsaAnnual) || 0), 15000);

  // FICA (W-2) or Self-Employment Tax (1099)
  const SS_WAGE_BASE = 176100; // 2025 Social Security wage base
  const addlMedThreshold = filing === 'married' ? 250000 : 200000;
  let ssTax = 0;
  let medicareTax = 0;
  let seTaxDeduction = 0;

  if (isContractor) {
    const seBase = netBusinessOrWage * 0.9235;
    ssTax = Math.min(seBase, SS_WAGE_BASE) * 0.124;
    medicareTax = seBase * 0.029 + Math.max(0, seBase - addlMedThreshold) * 0.009;
    seTaxDeduction = (ssTax + medicareTax) * 0.5;
  } else {
    // FICA applies to wages even if contributed to 401(k) (HSA via cafeteria plan is exempt)
    const ficaBase = Math.max(0, annualGross - hsaAnnual);
    ssTax = Math.min(ficaBase, SS_WAGE_BASE) * 0.062;
    medicareTax = ficaBase * 0.0145 + Math.max(0, ficaBase - addlMedThreshold) * 0.009;
  }

  const agi = Math.max(0, netBusinessOrWage - employeeRetirement - hsaAnnual - seTaxDeduction);
  const stdDed = STANDARD_DEDUCTION[filing];

  // QBI Deduction (Section 199A): up to 20% of qualified business income (simplified phase-out check)
  let qbiDeduction = 0;
  if (isContractor && opts.useQbiDeduction) {
    const preQbiTaxable = Math.max(0, agi - stdDed);
    const qbiThreshold = filing === 'married' ? 394600 : 197300;
    if (preQbiTaxable <= qbiThreshold + 50000) {
      qbiDeduction = Math.min(netBusinessOrWage * 0.2, preQbiTaxable * 0.2);
    }
  }

  const federalTaxable = Math.max(0, agi - stdDed - qbiDeduction);
  const fedRes = calculateProgressiveTax(federalTaxable, FED_BRACKETS[filing]);
  const stateRes = calcStateTax(agi, opts.state, filing);

  const incomeTax = fedRes.totalTax + stateRes.tax;
  const leviesAndSocial = ssTax + medicareTax;
  const totalOut = incomeTax + leviesAndSocial + employeeRetirement + hsaAnnual + businessExpenses;
  const netIncome = Math.max(0, annualGross - totalOut);
  const totalPackage = annualGross + employerRetirement;

  const ficaMarginal = isContractor
    ? (netBusinessOrWage * 0.9235 < SS_WAGE_BASE ? 0.1413 : 0.0268)
    : (annualGross < SS_WAGE_BASE ? 0.0765 : 0.0145);
  const marginalRate = fedRes.marginalRate + stateRes.marginal + ficaMarginal;
  const effectiveTaxRate = (incomeTax + leviesAndSocial) / Math.max(1, netBusinessOrWage);

  const lineItems = [
    { label: isContractor ? 'Gross 1099 Revenue' : 'Gross Annual Salary', amount: annualGross, kind: 'income' },
  ];
  if (businessExpenses > 0) {
    lineItems.push({ label: 'Deductible Business Expenses', amount: -businessExpenses, kind: 'deduction' });
  }
  if (employeeRetirement > 0) {
    lineItems.push({
      label: isContractor ? `Solo 401(k) / SEP (${opts.retirementPct}%)` : `Pre-Tax 401(k) (${opts.retirementPct}%)`,
      amount: -employeeRetirement,
      kind: 'retirement',
    });
  }
  if (hsaAnnual > 0) {
    lineItems.push({ label: 'Pre-Tax HSA / Health', amount: -hsaAnnual, kind: 'deduction' });
  }
  lineItems.push({ label: 'Federal Income Tax', amount: -fedRes.totalTax, kind: 'tax' });
  if (stateRes.tax > 0) {
    lineItems.push({ label: `${stateRes.name} Tax`, amount: -stateRes.tax, kind: 'tax' });
  }
  lineItems.push({
    label: isContractor ? 'Self-Employment Tax (15.3%)' : 'FICA (Social Security + Medicare)',
    amount: -leviesAndSocial,
    kind: 'levy',
    note: isContractor ? 'Half deducted from AGI automatically' : 'SS capped at $176.1k wage base',
  });
  lineItems.push({ label: 'Net Take-Home Pay', amount: netIncome, kind: 'net' });

  if (qbiDeduction > 0) {
    lineItems.push({
      label: 'QBI 20% Deduction Applied',
      amount: qbiDeduction,
      kind: 'info',
      note: 'Reduces federal taxable income (Section 199A)',
    });
  }
  if (employerRetirement > 0) {
    lineItems.push({
      label: `Employer 401(k) Match (${opts.employerMatchPct}%)`,
      amount: employerRetirement,
      kind: 'info',
    });
  }

  return {
    grossIncome: annualGross,
    headlineInput: annualGross,
    taxableIncome: federalTaxable,
    incomeTax,
    leviesAndSocial,
    studentLoan: 0,
    employeeRetirement,
    employerRetirement,
    totalRetirement: employeeRetirement + employerRetirement,
    businessExpenses,
    indirectTaxInvoice: 0,
    netIncome,
    totalPackage,
    marginalRate,
    effectiveTaxRate,
    brackets: fedRes.breakdown,
    lineItems,
    taxVaultAnnual: incomeTax + leviesAndSocial,
    extras: { federalTax: fedRes.totalTax, stateTax: stateRes.tax, ssTax, medicareTax, qbiDeduction },
  };
}
