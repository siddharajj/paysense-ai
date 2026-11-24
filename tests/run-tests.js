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

// 10. Rental Property, Negative Gearing, Depreciation Schedule & CGT Forecaster tests
import {
  defaultPropertyState,
  generateDepreciationSchedule,
  calculatePropertyImpact,
} from '../js/tax/propertyEngine.js';

{
  // Australia: Negatively geared property with Div 43 & Div 40 depreciation + 50% CGT discount
  const auState = defaultPropertyState('AU');
  const auImpact = calculatePropertyImpact(auState);
  assert(auImpact.year1.preTaxCashflow < 0, 'AU default property is cashflow negative before tax');
  assert(auImpact.depSchedule.year1Total > 8000, 'AU Div 43 + Div 40 generates >$8k Year-1 depreciation');
  assert(auImpact.year1.taxSavedOrPaid > 3000, 'AU negative gearing + depreciation generates tax refund');
  assert(auImpact.year1.afterTaxPropertyCashflow > auImpact.year1.preTaxCashflow, 'AU tax refund improves property cashflow');
  assert(auImpact.exitCgt.costBaseAdjustmentOrRecapture > 0, 'AU CGT exit adjusts cost base for Div 43 capital works claimed');
  assert(auImpact.exitCgt.estimatedCgtAndRecaptureTax > 0, 'AU CGT exit computes 50% discounted CGT');

  // AU Brand-new vs Established Div 40 plant difference (2017 legislative rule)
  const auNew = generateDepreciationSchedule({ ...auState, isBrandNewBuild: true });
  const auEst = generateDepreciationSchedule({ ...auState, isBrandNewBuild: false });
  assert(auNew.year1Total > auEst.year1Total, 'AU brand-new property gets higher Div 40 plant depreciation than established');

  // US: 27.5-yr MACRS depreciation + $100k-$150k passive loss phase-out + 25% Sec 1250 recapture
  const usHighEarner = calculatePropertyImpact({ ...defaultPropertyState('US'), salary: 160000 });
  assert(usHighEarner.year1.carriedForwardLoss > 0, 'US $160k earner has passive rental loss suspended above $150k MAGI');
  const usMidEarner = calculatePropertyImpact({ ...defaultPropertyState('US'), salary: 95000 });
  assert(usMidEarner.year1.deductibleLossAgainstSalary > 0 && usMidEarner.year1.taxSavedOrPaid > 0, 'US $95k earner deducts up to $25k passive rental loss');

  // UK: Section 24 mortgage interest restriction (20% basic rate tax credit)
  const ukImpact = calculatePropertyImpact(defaultPropertyState('UK'));
  assert(ukImpact.year1.lawTitle.includes('Section 24'), 'UK applies Section 24 mortgage interest restriction');

  // Canada: CCA cannot create or increase a rental loss
  const caImpact = calculatePropertyImpact(defaultPropertyState('CA'));
  assert(caImpact.year1.claimedTotalDep === 0, 'CA prevents CCA from increasing a cash rental loss');

  // New Zealand & Singapore: 0% CGT on long-term exit
  const nzImpact = calculatePropertyImpact(defaultPropertyState('NZ'));
  const sgImpact = calculatePropertyImpact(defaultPropertyState('SG'));
  assert(nzImpact.exitCgt.estimatedCgtAndRecaptureTax === 0, 'NZ 10-yr hold has $0 CGT (past 2-yr Bright-Line)');
  assert(sgImpact.exitCgt.estimatedCgtAndRecaptureTax === 0, 'SG 10-yr hold has $0 CGT');
}

print(`All Property & Tax Forecaster assertions passed! Total assertions: ${passed} passed, ${failed} failed.`);

// 11. Life & Money Decisions (Novated Lease, EV vs Petrol, Rent vs Buy, Smart What-Ifs) tests
import {
  defaultDecisionsState,
  calculateCarDecision,
  calculateRentVsBuy,
  calculateWhatIfScenarios,
} from '../js/tax/decisionsEngine.js';

{
  // Australia EV Novated Lease (FBT-exempt under $91,387) vs Petrol Novated Lease vs Loan
  const decAu = defaultDecisionsState('AU');
  const carRes = calculateCarDecision(decAu);
  assert(carRes.evEligibleFbtExempt === true, 'AU $62k EV is eligible for 100% FBT exemption');
  assert(carRes.options.evNovated.totalTaxAndGstSaved > 15000, 'AU EV novated lease saves >$15k in tax & GST over 4 yrs');
  assert(
    carRes.options.evNovated.totalCostToOwnAfterTerm < carRes.options.petrolNovated.totalCostToOwnAfterTerm,
    'AU FBT-exempt EV novated lease has lower 4-yr net cost than petrol novated lease'
  );
  assert(carRes.energyComparison.annualFuelSavings > 1000, 'EV home charging saves >$1,000/yr vs petrol fuel');

  // Verify HECS Reportable Fringe Benefit add-back on FBT-exempt EV novated lease
  const carHecs = calculateCarDecision({ ...decAu, car: { ...decAu.car, hasHecs: true } });
  assert(carHecs.extraHecsFromRfba > 0, 'AU EV novated lease models ATO RFBA HECS-HELP repayment impact');

  // Rent vs Buy Home decision over 10 years
  const rbRes = calculateRentVsBuy(decAu);
  assert(rbRes.timeline.length === 10, 'Rent vs Buy simulates 10-year timeline');
  assert(rbRes.finalBuyerNetWealth > 300000 && rbRes.finalRenterNetWealth > 300000, 'Rent vs Buy computes both homeowner equity and renter after-CGT ETF portfolio');

  // Smart What-If Playbooks: Extra $1,000/mo allocation & 4-Day Work Week cushion
  const wiRes = calculateWhatIfScenarios(decAu);
  assert(
    wiRes.surplusAllocation.superSacrifice.finalValue > wiRes.surplusAllocation.offset.finalValue,
    'Pre-tax Super sacrifice compounds higher than mortgage offset due to upfront tax arbitrage'
  );
  const fourDay = wiRes.partTimeCushion.find((r) => r.days === 4);
  assert(fourDay.grossRatioPct === 80 && fourDay.netRatioPct > 80, '4-day work week (80% gross) keeps >80% of net take-home pay due to progressive tax cushion');
}

print(`All Life & Money Decisions assertions passed! Final total: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  throw new Error(`${failed} test(s) failed`);
}
