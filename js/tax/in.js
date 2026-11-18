/**
 * India Tax & Pay Engine — FY 2025–26 (AY 2026–27)
 * Includes Budget 2025 New Tax Regime (₹12L 87A rebate + ₹75k std deduction),
 * Old Tax Regime, and Contractor Section 44ADA (50% presumptive profit).
 */

import { calculateProgressiveTax, clamp } from './brackets.js';

const IN_NEW_BRACKETS = [
  { min: 0, max: 400000, rate: 0, label: '₹0 – ₹4L (0%)' },
  { min: 400000, max: 800000, rate: 0.05, label: '₹4L – ₹8L (5%)' },
  { min: 800000, max: 1200000, rate: 0.10, label: '₹8L – ₹12L (10%)' },
  { min: 1200000, max: 1600000, rate: 0.15, label: '₹12L – ₹16L (15%)' },
  { min: 1600000, max: 2000000, rate: 0.20, label: '₹16L – ₹20L (20%)' },
  { min: 2000000, max: 2400000, rate: 0.25, label: '₹20L – ₹24L (25%)' },
  { min: 2400000, max: Infinity, rate: 0.30, label: '₹24L+ (30%)' },
];

const IN_OLD_BRACKETS = [
  { min: 0, max: 250000, rate: 0, label: '₹0 – ₹2.5L (0%)' },
  { min: 250000, max: 500000, rate: 0.05, label: '₹2.5L – ₹5L (5%)' },
  { min: 500000, max: 1000000, rate: 0.20, label: '₹5L – ₹10L (20%)' },
  { min: 1000000, max: Infinity, rate: 0.30, label: '₹10L+ (30%)' },
];

export function defaultOptions() {
  return {
    regime: 'new', // 'new' | 'old'
    use44ADA: true, // Contractor Section 44ADA 50% presumptive tax (up to ₹75L)
    epfAnnual: 21600, // Standard ₹1,800/mo employee EPF (employee mode)
    oldRegimeDeductions: 200000, // 80C + 80D + HRA (when Old Regime selected)
    gstType: 'export', // 'export' (0% LUT) | 'domestic' (18%) | 'none'
  };
}

function calcSurcharge(taxableIncome, baseTax, regime) {
  if (taxableIncome <= 5000000) return 0;
  let rate = 0;
  if (taxableIncome <= 10000000) rate = 0.10;
  else if (taxableIncome <= 20000000) rate = 0.15;
  else if (taxableIncome <= 50000000) rate = 0.25;
  else rate = regime === 'new' ? 0.25 : 0.37;
  return baseTax * rate;
}

export function calculate(annualGross, mode, rawOptions = {}) {
  const opts = { ...defaultOptions(), ...rawOptions };
  const isContractor = mode === 'contractor';
  const isNew = opts.regime !== 'old';
  const businessExpenses = isContractor ? Math.max(0, Number(opts.businessExpenses) || 0) : 0;

  let taxableIncome = 0;
  let presumptive44ADAApplied = false;
  let standardDeduction = 0;
  let chapter6ADeductions = 0;
  let employeeEpf = 0;
  let employerEpf = 0;

  if (isContractor) {
    if (opts.use44ADA && annualGross <= 7500000) {
      // Section 44ADA: 50% of gross professional receipts deemed as taxable profit!
      presumptive44ADAApplied = true;
      taxableIncome = annualGross * 0.5;
    } else {
      taxableIncome = Math.max(0, annualGross - businessExpenses);
    }
    if (!isNew) {
      chapter6ADeductions = Math.min(taxableIncome, Math.max(0, Number(opts.oldRegimeDeductions) || 0));
      taxableIncome = Math.max(0, taxableIncome - chapter6ADeductions);
    }
  } else {
    employeeEpf = Math.min(annualGross * 0.12, Math.max(0, Number(opts.epfAnnual) || 0));
    employerEpf = employeeEpf;
    standardDeduction = isNew ? 75000 : 50000;
    chapter6ADeductions = isNew ? 0 : Math.max(0, Number(opts.oldRegimeDeductions) || 0);
    taxableIncome = Math.max(0, annualGross - standardDeduction - chapter6ADeductions);
  }

  const brackets = isNew ? IN_NEW_BRACKETS : IN_OLD_BRACKETS;
  const taxRes = calculateProgressiveTax(taxableIncome, brackets);
  let baseTax = taxRes.totalTax;

  // Section 87A Rebate (FY 2025-26 New Regime: full rebate up to ₹12L taxable + marginal relief)
  let rebate87A = 0;
  if (isNew) {
    if (taxableIncome <= 1200000) {
      rebate87A = baseTax;
      baseTax = 0;
    } else if (taxableIncome <= 1275000) {
      // Marginal relief: tax cannot exceed income over ₹12,00,000
      const excess = taxableIncome - 1200000;
      if (baseTax > excess) {
        rebate87A = baseTax - excess;
        baseTax = excess;
      }
    }
  } else if (taxableIncome <= 500000) {
    rebate87A = Math.min(baseTax, 12500);
    baseTax = Math.max(0, baseTax - rebate87A);
  }

  const surcharge = calcSurcharge(taxableIncome, baseTax, opts.regime);
  const cess = (baseTax + surcharge) * 0.04;
  const totalTax = baseTax + surcharge + cess;
  const profTax = isContractor ? 0 : Math.min(2400, annualGross > 250000 ? 2400 : 0);

  const indirectTaxInvoice = isContractor && opts.gstType === 'domestic' ? annualGross * 0.18 : 0;
  const netIncome = Math.max(0, annualGross - businessExpenses - employeeEpf - totalTax - profTax);
  const totalPackage = annualGross + employerEpf;

  const effectiveTaxRate = (totalTax + profTax) / Math.max(1, annualGross - businessExpenses);
  const marginalRate =
    (presumptive44ADAApplied ? 0.5 : 1) * taxRes.marginalRate * 1.04;

  const lineItems = [
    { label: isContractor ? 'Gross Professional Receipts' : 'Gross Annual Salary', amount: annualGross, kind: 'income' },
  ];
  if (presumptive44ADAApplied) {
    lineItems.push({
      label: 'Section 44ADA Deemed Expenses (50%)',
      amount: -(annualGross * 0.5),
      kind: 'info',
      note: 'Only 50% of receipts are taxed (up to ₹75L limit)',
    });
  } else if (businessExpenses > 0) {
    lineItems.push({ label: 'Actual Business Expenses', amount: -businessExpenses, kind: 'deduction' });
  }
  if (standardDeduction > 0) {
    lineItems.push({ label: 'Standard Deduction', amount: standardDeduction, kind: 'info' });
  }
  if (employeeEpf > 0) {
    lineItems.push({ label: 'Employee EPF Contribution', amount: -employeeEpf, kind: 'retirement' });
  }
  lineItems.push({
    label: `Income Tax (${isNew ? 'New Regime FY25–26' : 'Old Regime'})`,
    amount: -(baseTax + surcharge),
    kind: 'tax',
    note: rebate87A > 0 ? `Includes ₹${Math.round(rebate87A).toLocaleString('en-IN')} Sec 87A rebate` : undefined,
  });
  if (cess > 0) {
    lineItems.push({ label: 'Health & Education Cess (4%)', amount: -cess, kind: 'levy' });
  }
  if (profTax > 0) {
    lineItems.push({ label: 'Professional Tax (Est.)', amount: -profTax, kind: 'levy' });
  }
  lineItems.push({ label: 'Net Take-Home Pay', amount: netIncome, kind: 'net' });
  if (employerEpf > 0) {
    lineItems.push({ label: 'Employer EPF Contribution', amount: employerEpf, kind: 'info' });
  }
  if (indirectTaxInvoice > 0) {
    lineItems.push({ label: 'GST Collected (18% Domestic)', amount: indirectTaxInvoice, kind: 'info', note: 'Pass-through to Govt' });
  } else if (isContractor && opts.gstType === 'export') {
    lineItems.push({ label: 'Export of Services under LUT', amount: 0, kind: 'info', note: '0% GST on foreign client invoices' });
  }

  return {
    grossIncome: annualGross,
    headlineInput: annualGross,
    taxableIncome,
    incomeTax: baseTax + surcharge,
    leviesAndSocial: cess + profTax,
    studentLoan: 0,
    employeeRetirement: employeeEpf,
    employerRetirement: employerEpf,
    totalRetirement: employeeEpf + employerEpf,
    businessExpenses,
    indirectTaxInvoice,
    netIncome,
    totalPackage,
    marginalRate: clamp(marginalRate, 0, 0.5),
    effectiveTaxRate,
    brackets: taxRes.breakdown,
    lineItems,
    taxVaultAnnual: totalTax + indirectTaxInvoice,
    extras: { presumptive44ADAApplied, rebate87A, cess, surcharge },
  };
}
