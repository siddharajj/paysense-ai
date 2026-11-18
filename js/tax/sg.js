/**
 * Singapore Tax & Pay Engine — YA 2026
 * Supports Resident Citizen/PR (with CPF), Expat/EP (0% CPF), and Contractor modes.
 */

import { calculateProgressiveTax } from './brackets.js';

const SG_RESIDENT_BRACKETS = [
  { min: 0, max: 20000, rate: 0, label: 'S$0 – S$20k (0%)' },
  { min: 20000, max: 30000, rate: 0.02, label: 'S$20k – S$30k (2%)' },
  { min: 30000, max: 40000, rate: 0.035, label: 'S$30k – S$40k (3.5%)' },
  { min: 40000, max: 80000, rate: 0.07, label: 'S$40k – S$80k (7%)' },
  { min: 80000, max: 120000, rate: 0.115, label: 'S$80k – S$120k (11.5%)' },
  { min: 120000, max: 160000, rate: 0.15, label: 'S$120k – S$160k (15%)' },
  { min: 160000, max: 200000, rate: 0.18, label: 'S$160k – S$200k (18%)' },
  { min: 200000, max: 240000, rate: 0.19, label: 'S$200k – S$240k (19%)' },
  { min: 240000, max: 280000, rate: 0.195, label: 'S$240k – S$280k (19.5%)' },
  { min: 280000, max: 320000, rate: 0.20, label: 'S$280k – S$320k (20%)' },
  { min: 320000, max: 500000, rate: 0.22, label: 'S$320k – S$500k (22%)' },
  { min: 500000, max: 1000000, rate: 0.23, label: 'S$500k – S$1M (23%)' },
  { min: 1000000, max: Infinity, rate: 0.24, label: 'S$1M+ (24%)' },
];

export function defaultOptions() {
  return {
    residency: 'citizen-pr', // 'citizen-pr' | 'expat-ep'
    srsContribution: 0, // Voluntary SRS tax relief (cap S$15,300 citizen/PR, S$35,700 foreigner)
    gstRegistered: false, // 9% GST (only mandatory > S$1M turnover)
  };
}

export function calculate(annualGross, mode, rawOptions = {}) {
  const opts = { ...defaultOptions(), ...rawOptions };
  const isContractor = mode === 'contractor';
  const isCitizenPr = opts.residency !== 'expat-ep';
  const businessExpenses = isContractor ? Math.max(0, Number(opts.businessExpenses) || 0) : 0;

  // CPF (2026 OW ceiling S$8,000/mo -> S$96,000 OW / S$102,000 annual total cap)
  let employeeCpf = 0;
  let employerCpf = 0;
  if (isCitizenPr) {
    if (isContractor) {
      // Self-employed MediSave contribution (~8-10.5% up to S$8,640 cap approx)
      employeeCpf = Math.min(Math.max(0, annualGross - businessExpenses) * 0.09, 8640);
    } else {
      const cpfWage = Math.min(annualGross, 102000);
      employeeCpf = cpfWage * 0.20;
      employerCpf = cpfWage * 0.17;
    }
  }

  const srsCap = isCitizenPr ? 15300 : 35700;
  const srs = Math.min(Math.max(0, Number(opts.srsContribution) || 0), srsCap);
  const earnedIncomeRelief = 1000;
  const totalReliefs = Math.min(80000, employeeCpf + srs + earnedIncomeRelief);
  const taxableIncome = Math.max(0, annualGross - businessExpenses - totalReliefs);

  const taxRes = calculateProgressiveTax(taxableIncome, SG_RESIDENT_BRACKETS);
  const indirectTaxInvoice = isContractor && opts.gstRegistered ? annualGross * 0.09 : 0;

  const netIncome = Math.max(0, annualGross - businessExpenses - employeeCpf - srs - taxRes.totalTax);
  const totalPackage = annualGross + employerCpf;
  const effectiveTaxRate = taxRes.totalTax / Math.max(1, annualGross - businessExpenses);

  const lineItems = [
    { label: isContractor ? 'Gross Contracting Revenue' : 'Gross Annual Salary', amount: annualGross, kind: 'income' },
  ];
  if (businessExpenses > 0) {
    lineItems.push({ label: 'Deductible Business Expenses', amount: -businessExpenses, kind: 'deduction' });
  }
  if (employeeCpf > 0) {
    lineItems.push({
      label: isContractor ? 'MediSave Contribution (Self-Employed)' : 'Employee CPF (20%)',
      amount: -employeeCpf,
      kind: 'retirement',
    });
  }
  if (srs > 0) {
    lineItems.push({ label: 'SRS Voluntary Contribution', amount: -srs, kind: 'retirement', note: 'Dollar-for-dollar tax relief' });
  }
  lineItems.push({ label: 'IRAS Income Tax (YA 2026)', amount: -taxRes.totalTax, kind: 'tax' });
  lineItems.push({ label: 'Net Take-Home Pay', amount: netIncome, kind: 'net' });
  if (employerCpf > 0) {
    lineItems.push({ label: 'Employer CPF (17%)', amount: employerCpf, kind: 'info' });
  }
  if (indirectTaxInvoice > 0) {
    lineItems.push({ label: 'GST Collected (9%)', amount: indirectTaxInvoice, kind: 'info' });
  }

  return {
    grossIncome: annualGross,
    headlineInput: annualGross,
    taxableIncome,
    incomeTax: taxRes.totalTax,
    leviesAndSocial: 0,
    studentLoan: 0,
    employeeRetirement: employeeCpf + srs,
    employerRetirement: employerCpf,
    totalRetirement: employeeCpf + employerCpf + srs,
    businessExpenses,
    indirectTaxInvoice,
    netIncome,
    totalPackage,
    marginalRate: taxRes.marginalRate,
    effectiveTaxRate,
    brackets: taxRes.breakdown,
    lineItems,
    taxVaultAnnual: taxRes.totalTax + (isContractor ? employeeCpf : 0) + indirectTaxInvoice,
    extras: { employeeCpf, employerCpf, srs },
  };
}
