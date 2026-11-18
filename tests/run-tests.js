/**
 * Automated unit tests for PaySense AI tax engines, reverse goal solver,
 * contractor vs FTE comparator, and natural language parser.
 * Run with macOS JavaScriptCore:
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/run-tests.js
 */

import { calculatePay, solveGrossForTargetNet, getCountryDefaultOptions } from '../js/tax/calculator.js';
import { COUNTRIES } from '../js/tax/countries.js';
import { parseNaturalLanguage } from '../js/ai/nlParser.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    print(`FAIL: ${msg}`);
  }
}

function approx(actual, expected, tol, msg) {
  const ok = Math.abs(actual - expected) <= tol;
  assert(ok, `${msg} (expected ~${expected}, got ${actual.toFixed(2)})`);
}

function makeInput(overrides = {}) {
  const countryOptions = {};
  for (const code of Object.keys(COUNTRIES)) {
    countryOptions[code] = getCountryDefaultOptions(code);
  }
  if (overrides.countryOptions) {
    for (const [k, v] of Object.entries(overrides.countryOptions)) {
      countryOptions[k] = { ...countryOptions[k], ...v };
    }
  }
  return {
    country: 'AU',
    mode: 'employee',
    amount: 100000,
    ratePeriod: 'annual',
    bonus: 0,
    billableDays: 220,
    hoursPerDay: 8,
    hoursPerWeek: 38,
    businessExpenses: 0,
    compareSalary: 0,
    compareDayRate: 0,
    ...overrides,
    countryOptions,
  };
}

// 1. Australia FY 2025-26 Employee Test ($100,000 + 12% super)
{
  const res = calculatePay(makeInput({ country: 'AU', mode: 'employee', amount: 100000 }));
  // Tax on $100k: (45000-18200)*0.16 = 4288 + (100000-45000)*0.30 = 16500 => 20788
  // Medicare levy: 2000
  approx(res.incomeTax, 20788, 1, 'AU $100k resident income tax FY25-26');
  approx(res.leviesAndSocial, 2000, 1, 'AU $100k Medicare levy');
  approx(res.employerRetirement, 12000, 1, 'AU 12% SG super');
  approx(res.netIncome, 77212, 1, 'AU $100k net income');
}

// 2. Australia Contractor ($950/day, 220 days, incl. super, $5k expenses, GST)
{
  const res = calculatePay(
    makeInput({
      country: 'AU',
      mode: 'contractor',
      amount: 950,
      ratePeriod: 'daily',
      billableDays: 220,
      businessExpenses: 5000,
      compareSalary: 165000,
      countryOptions: { AU: { includesSuper: true, gstRegistered: true } },
    })
  );
  // Headline = 950 * 220 = 209,000; ex super = 209000 / 1.12 = 186,607.14
  approx(res.grossIncome, 186607.14, 2, 'AU contractor incl-super base gross');
  approx(res.indirectTaxInvoice, 20900, 1, 'AU contractor 10% GST invoice');
  assert(res.fteComparison.equivalentFteBase > 150000 && res.fteComparison.equivalentFteBase < 200000, 'AU contractor equivalent FTE in reasonable band');
  assert(res.fteComparison.compareRes !== null, 'AU contractor explicit comparison computed');
}

// 3. United States 2025 (TX 0% state vs CA state, plus 1099 QBI)
{
  const tx = calculatePay(makeInput({ country: 'US', mode: 'employee', amount: 140000, countryOptions: { US: { state: 'TX', retirementPct: 0 } } }));
  const ca = calculatePay(makeInput({ country: 'US', mode: 'employee', amount: 140000, countryOptions: { US: { state: 'CA', retirementPct: 0 } } }));
  assert(tx.extras.stateTax === 0, 'US TX has $0 state tax');
  assert(ca.extras.stateTax > 7000, 'US CA has meaningful state tax');
  assert(tx.netIncome > ca.netIncome, 'US TX net exceeds CA net');

  const c1099 = calculatePay(makeInput({ country: 'US', mode: 'contractor', amount: 850, ratePeriod: 'daily', billableDays: 220, countryOptions: { US: { state: 'TX', useQbiDeduction: true } } }));
  assert(c1099.extras.qbiDeduction > 0, 'US 1099 QBI deduction applied');
  assert(c1099.netIncome > 100000, 'US 1099 net income positive & sensible');
}

// 4. United Kingdom £110k 60% Personal Allowance Taper Trap & Outside IR35
{
  const uk = calculatePay(makeInput({ country: 'UK', mode: 'employee', amount: 110000, countryOptions: { UK: { pensionPct: 0 } } }));
  assert(uk.extras.in100kTrap === true, 'UK £110k detects 60% PA taper trap');
  approx(uk.extras.personalAllowance, 7570, 1, 'UK £110k reduced personal allowance');
  assert(uk.marginalRate >= 0.60, 'UK £110k marginal rate >= 60%');

  const ltd = calculatePay(makeInput({ country: 'UK', mode: 'contractor', amount: 600, ratePeriod: 'daily', billableDays: 220, countryOptions: { UK: { contractorType: 'outside-ir35' } } }));
  assert(ltd.extras.corpTax > 0 && ltd.netIncome > 70000, 'UK Outside IR35 Ltd Co calculates corp tax & net');
}

// 5. Canada Ontario Employee vs Self-Employed double CPP
{
  const emp = calculatePay(makeInput({ country: 'CA', mode: 'employee', amount: 120000, countryOptions: { CA: { province: 'ON' } } }));
  const con = calculatePay(makeInput({ country: 'CA', mode: 'contractor', amount: 120000, countryOptions: { CA: { province: 'ON' } } }));
  assert(con.extras.totalCpp > emp.extras.totalCpp * 1.9, 'CA contractor pays ~2x CPP');
  assert(emp.extras.ei > 1000 && con.extras.ei === 0, 'CA employee pays EI while contractor pays $0 EI');
}

// 6. India FY 2025-26 New Regime ₹12L Rebate & Section 44ADA Contractor
{
  const salaried12 = calculatePay(makeInput({ country: 'IN', mode: 'employee', amount: 1250000, countryOptions: { IN: { regime: 'new', epfAnnual: 0 } } }));
  // Taxable = 12.5L - 75k std ded = 11.75L <= 12L => ₹0 income tax!
  approx(salaried12.incomeTax, 0, 1, 'India FY25-26 ₹12.5L salaried pays ₹0 income tax under New Regime');

  const con44 = calculatePay(makeInput({ country: 'IN', mode: 'contractor', amount: 3000000, countryOptions: { IN: { regime: 'new', use44ADA: true } } }));
  approx(con44.taxableIncome, 1500000, 1, 'India 44ADA ₹30L contractor has ₹15L taxable profit');
  assert(con44.extras.presumptive44ADAApplied === true, 'India 44ADA flag set');
}

// 7. New Zealand & Singapore sanity checks
{
  const nz = calculatePay(makeInput({ country: 'NZ', mode: 'employee', amount: 115000, countryOptions: { NZ: { kiwisaverPct: 3, hasStudentLoan: true } } }));
  assert(nz.studentLoan > 10000 && nz.netIncome > 65000, 'NZ student loan & net calculated');

  const sgCit = calculatePay(makeInput({ country: 'SG', mode: 'employee', amount: 120000, countryOptions: { SG: { residency: 'citizen-pr' } } }));
  const sgExp = calculatePay(makeInput({ country: 'SG', mode: 'employee', amount: 120000, countryOptions: { SG: { residency: 'expat-ep' } } }));
  assert(sgCit.extras.employeeCpf > 18000 && sgExp.extras.employeeCpf === 0, 'SG CPF applies to Citizen/PR and not Expat');
}

// 8. Reverse Goal Solver ("Target $10,000/month net in AU")
{
  const baseIn = makeInput({ country: 'AU', mode: 'employee', amount: 100000, ratePeriod: 'annual' });
  const targetAnnualNet = 120000;
  const requiredGross = solveGrossForTargetNet(targetAnnualNet, baseIn);
  const verified = calculatePay({ ...baseIn, amount: requiredGross });
  approx(verified.netIncome, targetAnnualNet, 5, 'Reverse goal solver converges to target net within $5');
}

// 9. Natural Language Parser tests
{
  const base = makeInput({ country: 'AU', mode: 'employee', amount: 120000 });

  const p1 = parseNaturalLanguage('AU contractor $950/day, 220 days, incl super, compare with $165k FTE', base);
  assert(p1.activeCountry === 'AU', 'NLP detects AU');
  assert(p1.patch.mode === 'contractor', 'NLP detects contractor mode');
  assert(p1.patch.amount === 950 && p1.patch.ratePeriod === 'daily', 'NLP detects $950/day');
  assert(p1.patch.billableDays === 220, 'NLP detects 220 days');
  assert(p1.countryOptionPatch.includesSuper === true, 'NLP detects incl super');
  assert(p1.patch.compareSalary === 165000, 'NLP detects compare with $165k FTE');

  const p2 = parseNaturalLanguage('US $150k salary in California, married, 6% 401k', base);
  assert(p2.patch.country === 'US' && p2.patch.amount === 150000, 'NLP detects US $150k');
  assert(p2.countryOptionPatch.state === 'CA' && p2.countryOptionPatch.filingStatus === 'married' && p2.countryOptionPatch.retirementPct === 6, 'NLP detects CA married 6% 401k');

  const p3 = parseNaturalLanguage('How much do I need to earn in Australia to take home $10,000/month?', base);
  assert(p3.actionType === 'reverse-goal' && p3.targetNetAnnual === 120000, 'NLP detects reverse goal $10k/month');

  const p4 = parseNaturalLanguage('India 36L freelancer under 44ADA vs 32L salary', base);
  assert(p4.patch.country === 'IN' && p4.patch.mode === 'contractor' && p4.patch.amount === 3600000, 'NLP detects India 36L contractor');
  assert(p4.countryOptionPatch.use44ADA === true && p4.patch.compareSalary === 3200000, 'NLP detects 44ADA & 32L compare');

  const p5 = parseNaturalLanguage('what if I get a 15% raise?', base);
  assert(p5.patch.amount === 138000, 'NLP incremental 15% raise updates current amount');
}

print(`\nPaySense AI Test Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  throw new Error(`${failed} test(s) failed`);
}
