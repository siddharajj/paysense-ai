/**
 * New Zealand Tax & Pay Engine — 2025/26 Tax Year
 * Supports PAYE Employee & Contractor (GST / ACC) modes.
 */

import { calculateProgressiveTax, clamp } from './brackets.js';

const NZ_BRACKETS = [
  { min: 0, max: 15600, rate: 0.105, label: '$0 – $15.6k (10.5%)' },
  { min: 15600, max: 53500, rate: 0.175, label: '$15.6k – $53.5k (17.5%)' },
  { min: 53500, max: 78100, rate: 0.30, label: '$53.5k – $78.1k (30%)' },
  { min: 78100, max: 180000, rate: 0.33, label: '$78.1k – $180k (33%)' },
  { min: 180000, max: Infinity, rate: 0.39, label: '$180k+ (39%)' },
];

export function defaultOptions() {
  return {
    kiwisaverPct: 3, // 0, 3, 4, 6, 8, 10
    hasStudentLoan: false,
    gstRegistered: true,
  };
}

export function calculate(annualGross, mode, rawOptions = {}) {
  const opts = { ...defaultOptions(), ...rawOptions };
  const isContractor = mode === 'contractor';
  const businessExpenses = isContractor ? Math.max(0, Number(opts.businessExpenses) || 0) : 0;
  const taxableIncome = Math.max(0, annualGross - businessExpenses);

  const taxRes = calculateProgressiveTax(taxableIncome, NZ_BRACKETS);
  // ACC Earners' Levy 2025/26: 1.67% capped at $152,790 (+ ~0.8% work levy est. for contractors)
  const accRate = isContractor ? 0.022 : 0.0167;
  const acc = Math.min(taxableIncome, 152790) * accRate;

  const ksRate = clamp(Number(opts.kiwisaverPct) || 0, 0, 10) / 100;
  const employeeKs = isContractor ? 0 : annualGross * ksRate;
  const employerKs = isContractor || ksRate === 0 ? 0 : annualGross * 0.03;

  const studentLoan = opts.hasStudentLoan ? Math.max(0, taxableIncome - 24128) * 0.12 : 0;
  const indirectTaxInvoice = isContractor && opts.gstRegistered ? annualGross * 0.15 : 0;

  const netIncome = Math.max(0, taxableIncome - taxRes.totalTax - acc - employeeKs - studentLoan);
  const totalPackage = annualGross + employerKs;
  const marginalRate =
    taxRes.marginalRate +
    (taxableIncome < 152790 ? accRate : 0) +
    (opts.hasStudentLoan && taxableIncome > 24128 ? 0.12 : 0);
  const effectiveTaxRate = (taxRes.totalTax + acc + studentLoan) / Math.max(1, taxableIncome);

  const lineItems = [
    { label: isContractor ? 'Gross Contracting Revenue (ex GST)' : 'Gross Annual Salary', amount: annualGross, kind: 'income' },
  ];
  if (businessExpenses > 0) {
    lineItems.push({ label: 'Deductible Business Expenses', amount: -businessExpenses, kind: 'deduction' });
  }
  lineItems.push({ label: 'PAYE / Income Tax', amount: -taxRes.totalTax, kind: 'tax' });
  lineItems.push({
    label: isContractor ? 'ACC Levies (Earners + Work est.)' : 'ACC Earners’ Levy (1.67%)',
    amount: -acc,
    kind: 'levy',
  });
  if (employeeKs > 0) {
    lineItems.push({ label: `KiwiSaver Employee (${opts.kiwisaverPct}%)`, amount: -employeeKs, kind: 'retirement' });
  }
  if (studentLoan > 0) {
    lineItems.push({ label: 'Student Loan Repayment (12%)', amount: -studentLoan, kind: 'levy' });
  }
  lineItems.push({ label: 'Net Take-Home Pay', amount: netIncome, kind: 'net' });
  if (employerKs > 0) {
    lineItems.push({ label: 'Employer KiwiSaver (3%)', amount: employerKs, kind: 'info' });
  }
  if (indirectTaxInvoice > 0) {
    lineItems.push({ label: 'GST Collected (15%)', amount: indirectTaxInvoice, kind: 'info', note: 'Pass-through to IRD' });
  }

  return {
    grossIncome: annualGross,
    headlineInput: annualGross,
    taxableIncome,
    incomeTax: taxRes.totalTax,
    leviesAndSocial: acc,
    studentLoan,
    employeeRetirement: employeeKs,
    employerRetirement: employerKs,
    totalRetirement: employeeKs + employerKs,
    businessExpenses,
    indirectTaxInvoice,
    netIncome,
    totalPackage,
    marginalRate,
    effectiveTaxRate,
    brackets: taxRes.breakdown,
    lineItems,
    taxVaultAnnual: taxRes.totalTax + acc + studentLoan + indirectTaxInvoice,
    extras: { acc },
  };
}
