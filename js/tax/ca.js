/**
 * Canada Tax & Pay Engine — 2025 Tax Year
 * Supports Employee (T4) & Contractor / Self-Employed modes across major provinces.
 */

import { calculateProgressiveTax } from './brackets.js';

const CA_FED_BRACKETS = [
  { min: 0, max: 57375, rate: 0.15, label: '$0 – $57.4k (15%)' },
  { min: 57375, max: 114750, rate: 0.205, label: '$57.4k – $114.8k (20.5%)' },
  { min: 114750, max: 177882, rate: 0.26, label: '$114.8k – $177.9k (26%)' },
  { min: 177882, max: 253414, rate: 0.29, label: '$177.9k – $253.4k (29%)' },
  { min: 253414, max: Infinity, rate: 0.33, label: '$253.4k+ (33%)' },
];

export const CA_PROVINCES = {
  ON: {
    name: 'Ontario',
    gstHst: 0.13,
    bpa: 12747,
    brackets: [
      { min: 0, max: 52886, rate: 0.0505 },
      { min: 52886, max: 105775, rate: 0.0915 },
      { min: 105775, max: 150000, rate: 0.1116 },
      { min: 150000, max: 220000, rate: 0.1216 },
      { min: 220000, max: Infinity, rate: 0.1316 },
    ],
  },
  BC: {
    name: 'British Columbia',
    gstHst: 0.05,
    bpa: 12932,
    brackets: [
      { min: 0, max: 49279, rate: 0.0506 },
      { min: 49279, max: 98560, rate: 0.077 },
      { min: 98560, max: 113158, rate: 0.105 },
      { min: 113158, max: 137407, rate: 0.1229 },
      { min: 137407, max: 186306, rate: 0.147 },
      { min: 186306, max: 259829, rate: 0.168 },
      { min: 259829, max: Infinity, rate: 0.205 },
    ],
  },
  AB: {
    name: 'Alberta',
    gstHst: 0.05,
    bpa: 22323,
    brackets: [
      { min: 0, max: 151234, rate: 0.10 },
      { min: 151234, max: 181481, rate: 0.12 },
      { min: 181481, max: 241974, rate: 0.13 },
      { min: 241974, max: 362961, rate: 0.14 },
      { min: 362961, max: Infinity, rate: 0.15 },
    ],
  },
  QC: {
    name: 'Quebec',
    gstHst: 0.14975,
    bpa: 18571,
    abatement: 0.165, // 16.5% federal Quebec abatement
    brackets: [
      { min: 0, max: 53255, rate: 0.14 },
      { min: 53255, max: 106495, rate: 0.19 },
      { min: 106495, max: 129590, rate: 0.24 },
      { min: 129590, max: Infinity, rate: 0.2575 },
    ],
  },
  MB: {
    name: 'Manitoba',
    gstHst: 0.05,
    bpa: 15780,
    brackets: [
      { min: 0, max: 47000, rate: 0.108 },
      { min: 47000, max: 100000, rate: 0.1275 },
      { min: 100000, max: Infinity, rate: 0.174 },
    ],
  },
  NS: {
    name: 'Nova Scotia',
    gstHst: 0.14,
    bpa: 11744,
    brackets: [
      { min: 0, max: 30507, rate: 0.0879 },
      { min: 30507, max: 61015, rate: 0.1495 },
      { min: 61015, max: 95883, rate: 0.1667 },
      { min: 95883, max: 154650, rate: 0.175 },
      { min: 154650, max: Infinity, rate: 0.21 },
    ],
  },
};

export function defaultOptions() {
  return {
    province: 'ON',
    rrspAnnual: 0,
    gstHstRegistered: true,
  };
}

export function calculate(annualGross, mode, rawOptions = {}) {
  const opts = { ...defaultOptions(), ...rawOptions };
  const isContractor = mode === 'contractor';
  const prov = CA_PROVINCES[opts.province] || CA_PROVINCES.ON;
  const businessExpenses = isContractor ? Math.max(0, Number(opts.businessExpenses) || 0) : 0;
  const netEarnings = Math.max(0, annualGross - businessExpenses);

  // RRSP deduction (capped at 18% of earned income or $32,490 for 2025)
  const rrspMax = Math.min(netEarnings * 0.18, 32490);
  const rrsp = Math.min(Math.max(0, Number(opts.rrspAnnual) || 0), rrspMax);

  // 2025 CPP & CPP2
  const cpp1Base = Math.max(0, Math.min(netEarnings, 71300) - 3500);
  const cpp2Base = Math.max(0, Math.min(netEarnings, 81200) - 71300);
  const employeeCpp1 = cpp1Base * 0.0595;
  const employeeCpp2 = cpp2Base * 0.04;

  // Self-employed pays both employee and employer CPP portions (employer portion is deductible)
  const totalCpp = isContractor ? (employeeCpp1 + employeeCpp2) * 2 : employeeCpp1 + employeeCpp2;
  const cppDeduction = isContractor ? employeeCpp1 + employeeCpp2 : employeeCpp1 * (0.01 / 0.0595) + employeeCpp2;

  // 2025 EI (employees only, 1.64% up to $65,700)
  const ei = isContractor ? 0 : Math.min(annualGross, 65700) * 0.0164;

  const taxableIncome = Math.max(0, netEarnings - rrsp - cppDeduction);

  // Federal tax minus non-refundable credits (BPA $16,129 + base CPP + EI)
  const fedGross = calculateProgressiveTax(taxableIncome, CA_FED_BRACKETS);
  const fedCredits = (16129 + employeeCpp1 * (0.0495 / 0.0595) + ei) * 0.15;
  let federalTax = Math.max(0, fedGross.totalTax - fedCredits);
  if (prov.abatement) {
    federalTax *= 1 - prov.abatement;
  }

  // Provincial tax minus provincial BPA credit
  const provGross = calculateProgressiveTax(taxableIncome, prov.brackets);
  const provLowestRate = prov.brackets[0].rate;
  const provCredits = (prov.bpa + employeeCpp1 * (0.0495 / 0.0595) + ei) * provLowestRate;
  const provincialTax = Math.max(0, provGross.totalTax - provCredits);

  const incomeTax = federalTax + provincialTax;
  const leviesAndSocial = totalCpp + ei;
  const indirectTaxInvoice = isContractor && opts.gstHstRegistered ? annualGross * prov.gstHst : 0;

  const netIncome = Math.max(0, netEarnings - rrsp - incomeTax - leviesAndSocial);
  const marginalRate = fedGross.marginalRate * (1 - (prov.abatement || 0)) + provGross.marginalRate;
  const effectiveTaxRate = (incomeTax + leviesAndSocial) / Math.max(1, netEarnings);

  const lineItems = [
    { label: isContractor ? 'Gross Contracting Revenue (ex GST/HST)' : 'Gross Annual Salary', amount: annualGross, kind: 'income' },
  ];
  if (businessExpenses > 0) {
    lineItems.push({ label: 'Deductible Business Expenses', amount: -businessExpenses, kind: 'deduction' });
  }
  if (rrsp > 0) {
    lineItems.push({ label: 'RRSP Contribution (Pre-Tax)', amount: -rrsp, kind: 'retirement' });
  }
  lineItems.push({ label: 'Federal Income Tax', amount: -federalTax, kind: 'tax' });
  lineItems.push({ label: `${prov.name} Provincial Tax`, amount: -provincialTax, kind: 'tax' });
  lineItems.push({
    label: isContractor ? 'CPP / CPP2 (Self-Employed 2×)' : 'CPP / CPP2',
    amount: -totalCpp,
    kind: 'levy',
  });
  if (ei > 0) {
    lineItems.push({ label: 'Employment Insurance (EI)', amount: -ei, kind: 'levy' });
  }
  lineItems.push({ label: 'Net Take-Home Pay', amount: netIncome, kind: 'net' });
  if (indirectTaxInvoice > 0) {
    lineItems.push({
      label: `GST/HST Collected (${(prov.gstHst * 100).toFixed(1).replace(/\.0$/, '')}%)`,
      amount: indirectTaxInvoice,
      kind: 'info',
      note: 'Pass-through to CRA',
    });
  }

  return {
    grossIncome: annualGross,
    headlineInput: annualGross,
    taxableIncome,
    incomeTax,
    leviesAndSocial,
    studentLoan: 0,
    employeeRetirement: rrsp,
    employerRetirement: 0,
    totalRetirement: rrsp,
    businessExpenses,
    indirectTaxInvoice,
    netIncome,
    totalPackage: annualGross,
    marginalRate,
    effectiveTaxRate,
    brackets: fedGross.breakdown,
    lineItems,
    taxVaultAnnual: incomeTax + leviesAndSocial + indirectTaxInvoice,
    extras: { federalTax, provincialTax, totalCpp, ei, provinceName: prov.name },
  };
}
