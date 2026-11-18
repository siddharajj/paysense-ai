/**
 * United Kingdom Tax & Pay Engine — 2025/26 Tax Year
 * Supports Employee (PAYE) & Contractor (Sole Trader / Inside IR35 / Outside IR35 Ltd est.).
 */

import { calculateProgressiveTax, clamp } from './brackets.js';

const UK_ENGLAND_BANDS = [
  { min: 0, max: 37700, rate: 0.20, label: 'Basic Rate (20%)' },
  { min: 37700, max: 125140, rate: 0.40, label: 'Higher Rate (40%)' },
  { min: 125140, max: Infinity, rate: 0.45, label: 'Additional Rate (45%)' },
];

const UK_SCOTLAND_BANDS = [
  { min: 0, max: 2827, rate: 0.19, label: 'Starter (19%)' },
  { min: 2827, max: 14921, rate: 0.20, label: 'Basic (20%)' },
  { min: 14921, max: 31092, rate: 0.21, label: 'Intermediate (21%)' },
  { min: 31092, max: 62430, rate: 0.42, label: 'Higher (42%)' },
  { min: 62430, max: 125140, rate: 0.45, label: 'Advanced (45%)' },
  { min: 125140, max: Infinity, rate: 0.48, label: 'Top (48%)' },
];

const STUDENT_LOAN_PLANS = {
  none: { threshold: Infinity, rate: 0, label: 'None' },
  plan1: { threshold: 26065, rate: 0.09, label: 'Plan 1' },
  plan2: { threshold: 28470, rate: 0.09, label: 'Plan 2' },
  plan4: { threshold: 32745, rate: 0.09, label: 'Plan 4 (Scotland)' },
  plan5: { threshold: 25000, rate: 0.09, label: 'Plan 5' },
  postgrad: { threshold: 21000, rate: 0.06, label: 'Postgraduate' },
};

export function defaultOptions() {
  return {
    region: 'england', // 'england' | 'scotland'
    pensionPct: 5,
    employerPensionPct: 5,
    studentLoan: 'none', // 'none' | 'plan1' | 'plan2' | 'plan4' | 'plan5' | 'postgrad'
    contractorType: 'sole-trader', // 'sole-trader' | 'outside-ir35' | 'inside-ir35'
    vatRegistered: true, // 20% VAT invoicing display
  };
}

function calcEmployeeNI(earnings) {
  if (earnings <= 12570) return 0;
  const main = Math.min(earnings, 50270) - 12570;
  const upper = Math.max(0, earnings - 50270);
  return main * 0.08 + upper * 0.02;
}

function calcClass4NI(profits) {
  if (profits <= 12570) return 0;
  const main = Math.min(profits, 50270) - 12570;
  const upper = Math.max(0, profits - 50270);
  return main * 0.06 + upper * 0.02;
}

function calcCorporationTax(profit) {
  if (profit <= 0) return 0;
  if (profit <= 50000) return profit * 0.19;
  if (profit >= 250000) return profit * 0.25;
  // Marginal relief between £50k and £250k (effective marginal ~26.5%)
  return profit * 0.25 - (250000 - profit) * (3 / 200);
}

export function calculate(annualGross, mode, rawOptions = {}) {
  const opts = { ...defaultOptions(), ...rawOptions };
  const isContractor = mode === 'contractor';
  const businessExpenses = isContractor ? Math.max(0, Number(opts.businessExpenses) || 0) : 0;
  const pensionPct = clamp(Number(opts.pensionPct) || 0, 0, 60) / 100;
  const empPensionPct = isContractor ? 0 : clamp(Number(opts.employerPensionPct) || 0, 0, 25) / 100;

  const indirectTaxInvoice = isContractor && opts.vatRegistered ? annualGross * 0.20 : 0;
  const loanSpec = STUDENT_LOAN_PLANS[opts.studentLoan] || STUDENT_LOAN_PLANS.none;

  // Special path: Outside IR35 Limited Company (salary £12,570 + dividends + Corp Tax)
  if (isContractor && opts.contractorType === 'outside-ir35') {
    const companyRevenue = annualGross;
    const companyPension = Math.min(companyRevenue * pensionPct, 60000);
    const directorSalary = Math.min(12570, Math.max(0, companyRevenue - businessExpenses - companyPension));
    // Employer NI on salary above £5,000 (2025/26 Secondary Threshold £5,000 at 15%)
    const employerNI = Math.max(0, directorSalary - 5000) * 0.15;
    const companyProfit = Math.max(0, companyRevenue - businessExpenses - companyPension - directorSalary - employerNI);
    const corpTax = calcCorporationTax(companyProfit);
    const distributableDividends = Math.max(0, companyProfit - corpTax);

    // Personal income = directorSalary + dividends
    const totalPersonal = directorSalary + distributableDividends;
    const paReduction = totalPersonal > 100000 ? Math.min(12570, (totalPersonal - 100000) / 2) : 0;
    const personalAllowance = Math.max(0, 12570 - paReduction);
    const taxableDividends = Math.max(0, totalPersonal - personalAllowance);

    // Dividend tax bands (2025/26: £500 allowance, 8.75% basic, 33.75% higher, 39.35% additional)
    const divBrackets = [
      { min: 0, max: 500, rate: 0, label: 'Dividend Allowance (£500 · 0%)' },
      { min: 500, max: 37700, rate: 0.0875, label: 'Basic Dividend (8.75%)' },
      { min: 37700, max: 125140, rate: 0.3375, label: 'Higher Dividend (33.75%)' },
      { min: 125140, max: Infinity, rate: 0.3935, label: 'Additional Dividend (39.35%)' },
    ];
    const divRes = calculateProgressiveTax(taxableDividends, divBrackets);
    const studentLoan = Math.max(0, totalPersonal - loanSpec.threshold) * loanSpec.rate;

    const totalTax = corpTax + divRes.totalTax;
    const netIncome = Math.max(0, totalPersonal - divRes.totalTax - studentLoan);
    const effectiveTaxRate = (totalTax + employerNI + studentLoan) / Math.max(1, companyRevenue - businessExpenses);

    const lineItems = [
      { label: 'Ltd Company Revenue (ex VAT)', amount: companyRevenue, kind: 'income' },
      ...(businessExpenses > 0 ? [{ label: 'Allowable Business Expenses', amount: -businessExpenses, kind: 'deduction' }] : []),
      ...(companyPension > 0 ? [{ label: `Company Pension (${opts.pensionPct}%)`, amount: -companyPension, kind: 'retirement' }] : []),
      { label: 'Corporation Tax (19%–25%)', amount: -corpTax, kind: 'tax' },
      ...(employerNI > 0 ? [{ label: 'Employer NI on Director Salary', amount: -employerNI, kind: 'levy' }] : []),
      { label: 'Personal Dividend Tax', amount: -divRes.totalTax, kind: 'tax' },
      ...(studentLoan > 0 ? [{ label: `Student Loan (${loanSpec.label})`, amount: -studentLoan, kind: 'levy' }] : []),
      { label: 'Net Take-Home Pay', amount: netIncome, kind: 'net' },
      ...(indirectTaxInvoice > 0
        ? [{ label: 'VAT Collected (20%)', amount: indirectTaxInvoice, kind: 'info', note: 'Pass-through to HMRC' }]
        : []),
    ];

    return {
      grossIncome: companyRevenue,
      headlineInput: annualGross,
      taxableIncome: taxableDividends,
      incomeTax: totalTax,
      leviesAndSocial: employerNI,
      studentLoan,
      employeeRetirement: companyPension,
      employerRetirement: 0,
      totalRetirement: companyPension,
      businessExpenses,
      indirectTaxInvoice,
      netIncome,
      totalPackage: companyRevenue,
      marginalRate: divRes.marginalRate + 0.19 * (1 - divRes.marginalRate),
      effectiveTaxRate,
      brackets: divRes.breakdown,
      lineItems,
      taxVaultAnnual: totalTax + employerNI + studentLoan + indirectTaxInvoice,
      extras: { corpTax, dividendTax: divRes.totalTax, personalAllowance, in100kTrap: totalPersonal > 100000 && totalPersonal < 125140 },
    };
  }

  // Employee (PAYE), Inside IR35, or Sole Trader
  const profitBeforePension = Math.max(0, annualGross - businessExpenses);
  const employeePension = Math.min(profitBeforePension * pensionPct, 60000);
  const employerPension = annualGross * empPensionPct;

  const adjustedNetIncome = Math.max(0, profitBeforePension - employeePension);
  const paReduction = adjustedNetIncome > 100000 ? Math.min(12570, (adjustedNetIncome - 100000) / 2) : 0;
  const personalAllowance = Math.max(0, 12570 - paReduction);
  const taxableIncome = Math.max(0, adjustedNetIncome - personalAllowance);

  const bands = opts.region === 'scotland' ? UK_SCOTLAND_BANDS : UK_ENGLAND_BANDS;
  const taxRes = calculateProgressiveTax(taxableIncome, bands);

  const ni =
    isContractor && opts.contractorType === 'sole-trader'
      ? calcClass4NI(profitBeforePension)
      : calcEmployeeNI(annualGross);

  const studentLoan = Math.max(0, adjustedNetIncome - loanSpec.threshold) * loanSpec.rate;
  const netIncome = Math.max(0, profitBeforePension - employeePension - taxRes.totalTax - ni - studentLoan);
  const totalPackage = annualGross + employerPension;

  // Check £100k–£125,140 60% personal allowance taper trap!
  const in100kTrap = adjustedNetIncome > 100000 && adjustedNetIncome < 125140;
  const niMarginal =
    adjustedNetIncome <= 12570
      ? 0
      : adjustedNetIncome <= 50270
        ? isContractor && opts.contractorType === 'sole-trader'
          ? 0.06
          : 0.08
        : 0.02;
  const trapExtra = in100kTrap ? taxRes.marginalRate * 0.5 : 0;
  const marginalRate = taxRes.marginalRate + trapExtra + niMarginal + (adjustedNetIncome > loanSpec.threshold ? loanSpec.rate : 0);
  const effectiveTaxRate = (taxRes.totalTax + ni + studentLoan) / Math.max(1, profitBeforePension);

  const lineItems = [
    { label: isContractor ? 'Gross Contracting Revenue (ex VAT)' : 'Gross Annual Salary', amount: annualGross, kind: 'income' },
  ];
  if (businessExpenses > 0) {
    lineItems.push({ label: 'Allowable Business Expenses', amount: -businessExpenses, kind: 'deduction' });
  }
  if (employeePension > 0) {
    lineItems.push({ label: `Pension Contribution (${opts.pensionPct}%)`, amount: -employeePension, kind: 'retirement' });
  }
  lineItems.push({
    label: `Income Tax (${opts.region === 'scotland' ? 'Scotland' : 'England/Wales/NI'})`,
    amount: -taxRes.totalTax,
    kind: 'tax',
    note: paReduction > 0 ? `Personal Allowance reduced to £${Math.round(personalAllowance).toLocaleString()}` : undefined,
  });
  lineItems.push({
    label: isContractor && opts.contractorType === 'sole-trader' ? 'National Insurance (Class 4)' : 'National Insurance (Class 1)',
    amount: -ni,
    kind: 'levy',
  });
  if (studentLoan > 0) {
    lineItems.push({ label: `Student Loan (${loanSpec.label})`, amount: -studentLoan, kind: 'levy' });
  }
  lineItems.push({ label: 'Net Take-Home Pay', amount: netIncome, kind: 'net' });
  if (employerPension > 0) {
    lineItems.push({ label: `Employer Pension (${opts.employerPensionPct}%)`, amount: employerPension, kind: 'info' });
  }
  if (indirectTaxInvoice > 0) {
    lineItems.push({ label: 'VAT Collected (20%)', amount: indirectTaxInvoice, kind: 'info', note: 'Pass-through to HMRC' });
  }

  return {
    grossIncome: annualGross,
    headlineInput: annualGross,
    taxableIncome,
    incomeTax: taxRes.totalTax,
    leviesAndSocial: ni,
    studentLoan,
    employeeRetirement: employeePension,
    employerRetirement: employerPension,
    totalRetirement: employeePension + employerPension,
    businessExpenses,
    indirectTaxInvoice,
    netIncome,
    totalPackage,
    marginalRate,
    effectiveTaxRate,
    brackets: [
      { label: `Personal Allowance (0%)`, min: 0, max: personalAllowance, rate: 0, taxableAmount: Math.min(adjustedNetIncome, personalAllowance), tax: 0 },
      ...taxRes.breakdown,
    ],
    lineItems,
    taxVaultAnnual: taxRes.totalTax + ni + studentLoan + indirectTaxInvoice,
    extras: { personalAllowance, in100kTrap, ni },
  };
}
