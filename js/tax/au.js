/**
 * Australia Tax & Pay Engine — FY 2025–26 (effective 1 July 2025)
 * Supports Employee (PAYG) & Contractor (ABN / Day-Rate / Hourly) modes.
 */

import { calculateProgressiveTax, clamp } from './brackets.js';

const AU_RESIDENT_BRACKETS = [
  { min: 0, max: 18200, rate: 0, label: '$0 – $18.2k (0%)' },
  { min: 18200, max: 45000, rate: 0.16, label: '$18.2k – $45k (16%)' },
  { min: 45000, max: 135000, rate: 0.30, label: '$45k – $135k (30%)' },
  { min: 135000, max: 190000, rate: 0.37, label: '$135k – $190k (37%)' },
  { min: 190000, max: Infinity, rate: 0.45, label: '$190k+ (45%)' },
];

const AU_NON_RESIDENT_BRACKETS = [
  { min: 0, max: 135000, rate: 0.30, label: '$0 – $135k (30%)' },
  { min: 135000, max: 190000, rate: 0.37, label: '$135k – $190k (37%)' },
  { min: 190000, max: Infinity, rate: 0.45, label: '$190k+ (45%)' },
];

const AU_WHM_BRACKETS = [
  { min: 0, max: 45000, rate: 0.15, label: '$0 – $45k (15%)' },
  { min: 45000, max: 135000, rate: 0.30, label: '$45k – $135k (30%)' },
  { min: 135000, max: 190000, rate: 0.37, label: '$135k – $190k (37%)' },
  { min: 190000, max: Infinity, rate: 0.45, label: '$190k+ (45%)' },
];

export function defaultOptions() {
  return {
    residency: 'resident', // 'resident' | 'non-resident' | 'whm'
    superRate: 12, // 12% SG from 1 July 2025
    includesSuper: false, // true = Total Package (Incl. Super)
    hasHecs: false,
    hasPrivateHealth: true, // avoids MLS above $101k
    salarySacrifice: 0, // annual pre-tax super / novated sacrifice
    gstRegistered: true, // contractor GST invoicing
  };
}

function calcMedicareLevy(taxableIncome, residency) {
  if (residency !== 'resident') return 0;
  // FY 2025–26 single low-income threshold ~$27,222, shade-in up to $34,027
  if (taxableIncome <= 27222) return 0;
  if (taxableIncome < 34027) return (taxableIncome - 27222) * 0.10;
  return taxableIncome * 0.02;
}

function calcMedicareLevySurcharge(repaymentIncome, residency, hasPrivateHealth) {
  if (residency !== 'resident' || hasPrivateHealth) return 0;
  if (repaymentIncome <= 101000) return 0;
  if (repaymentIncome <= 118000) return repaymentIncome * 0.01;
  if (repaymentIncome <= 158000) return repaymentIncome * 0.0125;
  return repaymentIncome * 0.015;
}

function calcHecsHelp(repaymentIncome) {
  // FY 2025–26 marginal HECS-HELP repayment thresholds
  if (repaymentIncome <= 67000) return 0;
  if (repaymentIncome <= 125000) return (repaymentIncome - 67000) * 0.15;
  if (repaymentIncome <= 179285) return 8700 + (repaymentIncome - 125000) * 0.17;
  return repaymentIncome * 0.10;
}

export function calculate(annualGross, mode, rawOptions = {}) {
  const opts = { ...defaultOptions(), ...rawOptions };
  const isContractor = mode === 'contractor';
  const superRate = clamp(Number(opts.superRate) || 0, 0, 40) / 100;
  const businessExpenses = isContractor ? Math.max(0, Number(opts.businessExpenses) || 0) : 0;
  const salarySacrifice = Math.max(0, Number(opts.salarySacrifice) || 0);

  // Split base vs super depending on inclusive/exclusive toggle
  let baseGross = annualGross;
  let employerSuper = 0;
  let contractorSuperContribution = 0;

  if (isContractor) {
    if (opts.includesSuper && superRate > 0) {
      // Contractor day rate is "inclusive of super" (e.g. agency PAYG or self-funded super)
      baseGross = annualGross / (1 + superRate);
      contractorSuperContribution = annualGross - baseGross;
    } else {
      // Contractor rate excludes super; voluntary super if salarySacrifice set, or track super separately
      baseGross = annualGross;
      contractorSuperContribution = 0;
    }
  } else {
    if (opts.includesSuper && superRate > 0) {
      baseGross = annualGross / (1 + superRate);
      employerSuper = annualGross - baseGross;
    } else {
      baseGross = annualGross;
      employerSuper = baseGross * superRate;
    }
  }

  // Taxable income after deductible business expenses and pre-tax sacrifice/voluntary super
  const concessionalSacrifice = Math.min(salarySacrifice, Math.max(0, baseGross - businessExpenses));
  const taxableIncome = Math.max(0, baseGross - businessExpenses - concessionalSacrifice);
  // ATO Repayment Income (for HECS & MLS) adds back reportable super contributions
  const repaymentIncome = taxableIncome + concessionalSacrifice;

  const brackets =
    opts.residency === 'non-resident'
      ? AU_NON_RESIDENT_BRACKETS
      : opts.residency === 'whm'
        ? AU_WHM_BRACKETS
        : AU_RESIDENT_BRACKETS;

  const taxRes = calculateProgressiveTax(taxableIncome, brackets);
  const incomeTax = taxRes.totalTax;
  const medicareLevy = calcMedicareLevy(taxableIncome, opts.residency);
  const mls = calcMedicareLevySurcharge(repaymentIncome, opts.residency, opts.hasPrivateHealth);
  const hecs = opts.hasHecs ? calcHecsHelp(repaymentIncome) : 0;

  // Super contributions tax (15% inside super fund on concessional salary sacrifice — informational)
  const totalSuperToFund = employerSuper + contractorSuperContribution + concessionalSacrifice;
  const indirectTaxInvoice = isContractor && opts.gstRegistered ? annualGross * 0.10 : 0;

  const leviesAndSocial = medicareLevy + mls;
  const totalDeductionsFromBase = incomeTax + leviesAndSocial + hecs + concessionalSacrifice + businessExpenses;
  const netIncome = Math.max(0, baseGross - totalDeductionsFromBase);
  const totalPackage = baseGross + employerSuper + contractorSuperContribution;

  // Combined marginal rate
  const medicareMarginal = opts.residency === 'resident' && taxableIncome > 34027 ? 0.02 : 0;
  const hecsMarginal =
    opts.hasHecs && repaymentIncome > 67000
      ? repaymentIncome <= 125000
        ? 0.15
        : repaymentIncome <= 179285
          ? 0.17
          : 0.10
      : 0;
  const marginalRate = taxRes.marginalRate + medicareMarginal + hecsMarginal;

  const effectiveBase = Math.max(1, baseGross - businessExpenses);
  const effectiveTaxRate = (incomeTax + leviesAndSocial + hecs) / effectiveBase;

  const lineItems = [
    {
      label: isContractor ? 'Gross Contracting Revenue (ex GST)' : opts.includesSuper ? 'Base Salary (ex Super)' : 'Gross Base Salary',
      amount: baseGross,
      kind: 'income',
    },
  ];
  if (isContractor && businessExpenses > 0) {
    lineItems.push({ label: 'Deductible Business Expenses', amount: -businessExpenses, kind: 'deduction' });
  }
  if (concessionalSacrifice > 0) {
    lineItems.push({
      label: isContractor ? 'Personal Deductible Super' : 'Pre-Tax Salary Sacrifice',
      amount: -concessionalSacrifice,
      kind: 'retirement',
      note: 'Taxed at 15% inside super fund (up to $30k cap)',
    });
  }
  lineItems.push({ label: 'Income Tax (ATO FY25–26)', amount: -incomeTax, kind: 'tax' });
  if (medicareLevy > 0) {
    lineItems.push({ label: 'Medicare Levy (2%)', amount: -medicareLevy, kind: 'levy' });
  }
  if (mls > 0) {
    lineItems.push({
      label: 'Medicare Levy Surcharge',
      amount: -mls,
      kind: 'levy',
      note: 'No private hospital cover above $101k',
    });
  }
  if (hecs > 0) {
    lineItems.push({ label: 'HECS-HELP Repayment', amount: -hecs, kind: 'levy', note: 'FY25–26 marginal rate' });
  }
  lineItems.push({ label: 'Net Take-Home Pay', amount: netIncome, kind: 'net' });

  if (totalSuperToFund > 0) {
    lineItems.push({
      label: `Superannuation (${opts.superRate}%${concessionalSacrifice > 0 ? ' + Sacrifice' : ''})`,
      amount: totalSuperToFund,
      kind: 'info',
      note: isContractor && opts.includesSuper ? 'Included within your daily/hourly rate' : 'Paid to your super fund',
    });
  }
  if (indirectTaxInvoice > 0) {
    lineItems.push({
      label: 'GST Collected on Invoices (10%)',
      amount: indirectTaxInvoice,
      kind: 'info',
      note: 'Pass-through to ATO via BAS — keep separate',
    });
  }

  return {
    grossIncome: baseGross,
    headlineInput: annualGross,
    taxableIncome,
    incomeTax,
    leviesAndSocial,
    studentLoan: hecs,
    employeeRetirement: concessionalSacrifice,
    employerRetirement: employerSuper + contractorSuperContribution,
    totalRetirement: totalSuperToFund,
    businessExpenses,
    indirectTaxInvoice,
    netIncome,
    totalPackage,
    marginalRate,
    effectiveTaxRate,
    brackets: taxRes.breakdown,
    lineItems,
    taxVaultAnnual: incomeTax + leviesAndSocial + hecs + indirectTaxInvoice,
    extras: { medicareLevy, mls, hecs, superTotal: totalSuperToFund },
  };
}
