/**
 * PaySense — Client-Side Life & Money Decisions Engine
 * ----------------------------------------------------
 * 1. Car Decision: Novated Lease & EV vs Petrol vs Loan vs Cash (AU FBT Exemption,
 *    ECM Petrol Lease, UK BiK, GST savings, HECS/MLS RFBA warning, 5-yr running costs).
 * 2. Home Decision: Rent vs Buy (& Invest the Difference in ETFs) with Main Residence
 *    0% CGT exemption vs ETF portfolio after-CGT compounding.
 * 3. Smart What-If Playbooks:
 *    - Where should my extra $X/month go? (Mortgage Offset vs Pre-Tax Super/401k vs ETFs)
 *    - 4-Day Work Week / Part-Time Progressive Tax Cushion
 */

import { COUNTRIES } from './countries.js';
import { calculatePay, getCountryDefaultOptions } from './calculator.js';
import { clamp } from './brackets.js';

// ATO Statutory Residual (Balloon) % of vehicle financed amount by lease years (1 to 5)
const ATO_RESIDUAL_PCT = {
  1: 0.6563,
  2: 0.5625,
  3: 0.4688,
  4: 0.3750,
  5: 0.2813,
};

export function defaultDecisionsState(countryCode = 'AU') {
  const isInr = countryCode === 'IN';
  const mult = isInr ? 20 : 1;

  return {
    country: countryCode,
    activeTool: 'car', // 'car' | 'rentbuy' | 'whatif'
    salary: COUNTRIES[countryCode]?.defaultSalary || 140000,

    // 1. Car: Novated Lease & EV vs Petrol
    car: {
      evPrice: 62000 * mult,
      petrolPrice: 54000 * mult,
      leaseYears: 4,
      annualKm: 15000,
      financeRatePct: 7.8,
      evKwhPer100Km: 16.0,
      electricityCostPerKwh: isInr ? 9.0 : 0.28,
      petrolLitersPer100Km: 7.8,
      petrolCostPerLiter: isInr ? 102 : 1.95,
      cashOpportunityRatePct: 6.0, // e.g. mortgage offset rate lost if paying cash
      hasHecs: false,
    },

    // 2. Home: Rent vs Buy
    rentBuy: {
      homePrice: 850000 * mult,
      depositSaved: 170000 * mult,
      mortgageRatePct: 6.1,
      loanTermYears: 30,
      weeklyRent: isInr ? 12000 : 720,
      homeGrowthPct: 5.2,
      rentGrowthPct: 3.8,
      etfReturnPct: 8.2,
      holdingYears: 10,
      buyingStampDutyPct: 4.2,
      annualHomeMaintenancePct: 1.1, // council rates, strata, insurance, repairs (% of home value)
    },

    // 3. What-If Playbooks
    whatIf: {
      monthlySurplus: isInr ? 25000 : 1000,
      mortgageOffsetRatePct: 6.2,
      etfReturnPct: 8.2,
      superReturnPct: 7.8,
      horizonYears: 10,
      partTimeDaysPerWeek: 4, // out of 5
    },
  };
}

function calcBasePay(countryCode, annualSalary, extraOpts = {}) {
  const c = COUNTRIES[countryCode] || COUNTRIES.AU;
  const opts = { ...getCountryDefaultOptions(countryCode), ...extraOpts };
  return calculatePay({
    country: countryCode,
    mode: 'employee',
    amount: Math.max(0, annualSalary),
    ratePeriod: 'annual',
    bonus: 0,
    billableDays: c.defaultBillableDays,
    hoursPerDay: c.standardHoursPerDay,
    hoursPerWeek: c.standardHoursPerWeek,
    businessExpenses: 0,
    countryOptions: { [countryCode]: opts },
  });
}

/**
 * Standard monthly loan amortization payment with an optional balloon/residual at end.
 */
function calcAnnualLeaseFinancePayment(financedAmount, residualAmount, annualRate, years) {
  if (financedAmount <= 0 || years <= 0) return 0;
  const r = annualRate / 12;
  const n = years * 12;
  if (r <= 0.0001) {
    return (financedAmount - residualAmount) / years;
  }
  // Monthly payment for PV -> FV (residual)
  const factor = Math.pow(1 + r, n);
  const monthly = ((financedAmount * factor - residualAmount) * r) / (factor - 1);
  return monthly * 12;
}

/**
 * 1. CAR DECISION: NOVATED LEASE & EV VS PETROL VS LOAN VS CASH
 */
export function calculateCarDecision(state) {
  const code = state.country || 'AU';
  const country = COUNTRIES[code] || COUNTRIES.AU;
  const salary = Math.max(0, Number(state.salary) || 0);
  const car = { ...defaultDecisionsState(code).car, ...(state.car || {}) };

  const years = Math.round(clamp(Number(car.leaseYears) || 4, 1, 5));
  const annualKm = Math.max(1000, Number(car.annualKm) || 15000);
  const finRate = clamp(Number(car.financeRatePct) || 7.8, 0, 22) / 100;
  const oppRate = clamp(Number(car.cashOpportunityRatePct) || 6.0, 0, 15) / 100;

  const basePay = calcBasePay(code, salary, { hasHecs: Boolean(car.hasHecs) });

  // Running costs per year (including GST/VAT)
  const evEnergyAnnual = (annualKm / 100) * (Number(car.evKwhPer100Km) || 16) * (Number(car.electricityCostPerKwh) || 0.28);
  const petrolFuelAnnual = (annualKm / 100) * (Number(car.petrolLitersPer100Km) || 7.8) * (Number(car.petrolCostPerLiter) || 1.95);

  const isInr = code === 'IN';
  const fixedScale = isInr ? 14 : 1;
  const evMaintenanceRegoIns = (450 + 850 + 1350 + 350) * fixedScale; // service + rego + ins + tyres
  const petrolMaintenanceRegoIns = (950 + 880 + 1250 + 320) * fixedScale;

  const evRunningIncTax = evEnergyAnnual + evMaintenanceRegoIns;
  const petrolRunningIncTax = petrolFuelAnnual + petrolMaintenanceRegoIns;

  // GST / VAT rate saved on novated lease in AU (10%) / UK (20% partial)
  const gstRate = code === 'AU' ? 0.10 : code === 'NZ' ? 0.15 : 0;
  const gstCapAu = 6191; // ATO car limit GST credit cap (~$68,108 / 11)

  const evPrice = Math.max(5000, Number(car.evPrice) || 62000);
  const petrolPrice = Math.max(5000, Number(car.petrolPrice) || 54000);
  const residualRatio = ATO_RESIDUAL_PCT[years] || 0.375;

  // --- Option A: EV on Pre-Tax Novated Lease / Salary Sacrifice ---
  // In AU: EVs below $91,387 LCT threshold are 100% FBT-exempt!
  const AU_LCT_EV_THRESHOLD = 91387;
  const evEligibleFbtExempt = code === 'AU' ? evPrice <= AU_LCT_EV_THRESHOLD : code === 'UK';
  const evGstSavedOnPurchase = code === 'AU' ? Math.min(evPrice / 11, gstCapAu) : 0;
  const evFinancedExGst = evPrice - evGstSavedOnPurchase;
  const evResidualExGst = evFinancedExGst * residualRatio;
  const evResidualIncGst = evResidualExGst * (1 + gstRate);
  const evAnnualLeaseExGst = calcAnnualLeaseFinancePayment(evFinancedExGst, evResidualExGst, finRate, years);
  const evAnnualRunningExGst = evRunningIncTax / (1 + gstRate);

  let evPreTaxSacrifice = 0;
  let evPostTaxContribution = 0;
  let evBiKOrFbtTax = 0;

  if (code === 'AU' && evEligibleFbtExempt) {
    evPreTaxSacrifice = evAnnualLeaseExGst + evAnnualRunningExGst;
    evPostTaxContribution = 0;
  } else if (code === 'UK') {
    // UK EV Salary Sacrifice: 100% pre-tax, plus 3% Benefit-in-Kind tax on P11D value
    evPreTaxSacrifice = evAnnualLeaseExGst + evRunningIncTax;
    evBiKOrFbtTax = evPrice * 0.03 * basePay.marginalRate;
  } else {
    // Either AU EV over $91,387 LCT cap or general country lease (uses 20% ECM post-tax)
    const ecmPostTax = evPrice * 0.20;
    const totalPackageCost = evAnnualLeaseExGst + evAnnualRunningExGst;
    evPostTaxContribution = Math.min(totalPackageCost, ecmPostTax);
    evPreTaxSacrifice = Math.max(0, totalPackageCost - evPostTaxContribution);
  }

  // ATO RFBA nuance: Reportable Fringe Benefits Amount is added back for HECS-HELP!
  const afterEvSacrificePay = calcBasePay(code, Math.max(0, salary - evPreTaxSacrifice), { hasHecs: Boolean(car.hasHecs) });
  // If AU FBT-exempt EV and user has HECS, ATO adds RFBA (statutory 20% * 1.8868 gross-up) to HECS repayment income
  let extraHecsFromRfba = 0;
  if (code === 'AU' && evEligibleFbtExempt && car.hasHecs) {
    const rfba = evPrice * 0.20 * 1.8868;
    const hecsWithRfba = calcBasePay(code, Math.max(0, salary - evPreTaxSacrifice + rfba), { hasHecs: true }).studentLoan;
    extraHecsFromRfba = Math.max(0, hecsWithRfba - afterEvSacrificePay.studentLoan);
  }

  const evTakeHomeReductionAnnual =
    basePay.netIncome - (afterEvSacrificePay.netIncome - evPostTaxContribution - evBiKOrFbtTax - extraHecsFromRfba);
  const evIncomeTaxSavedAnnual = Math.max(0, (evAnnualLeaseExGst + evRunningIncTax) - evTakeHomeReductionAnnual);
  const evTotalOutOfPocketOverTerm = evTakeHomeReductionAnnual * years + evResidualIncGst;

  // --- Option B: Petrol / Hybrid on Novated Lease (ECM Post-Tax + Pre-Tax) ---
  const petGstSavedOnPurchase = code === 'AU' ? Math.min(petrolPrice / 11, gstCapAu) : 0;
  const petFinancedExGst = petrolPrice - petGstSavedOnPurchase;
  const petResidualExGst = petFinancedExGst * residualRatio;
  const petResidualIncGst = petResidualExGst * (1 + gstRate);
  const petAnnualLeaseExGst = calcAnnualLeaseFinancePayment(petFinancedExGst, petResidualExGst, finRate, years);
  const petAnnualRunningExGst = petrolRunningIncTax / (1 + gstRate);

  const petEcmPostTax = code === 'AU' ? petrolPrice * 0.20 : (petAnnualLeaseExGst + petAnnualRunningExGst) * 0.65;
  const petTotalPackage = petAnnualLeaseExGst + petAnnualRunningExGst;
  const petPostTaxContribution = Math.min(petTotalPackage, petEcmPostTax);
  const petPreTaxSacrifice = Math.max(0, petTotalPackage - petPostTaxContribution);

  const afterPetSacrificePay = calcBasePay(code, Math.max(0, salary - petPreTaxSacrifice), { hasHecs: Boolean(car.hasHecs) });
  const petTakeHomeReductionAnnual =
    basePay.netIncome - (afterPetSacrificePay.netIncome - petPostTaxContribution);
  const petIncomeTaxSavedAnnual = Math.max(0, (petAnnualLeaseExGst + petrolRunningIncTax) - petTakeHomeReductionAnnual);
  const petTotalOutOfPocketOverTerm = petTakeHomeReductionAnnual * years + petResidualIncGst;

  // --- Option C: Buying Petrol Car with Post-Tax Car Loan ---
  const loanAnnualPayment = calcAnnualLeaseFinancePayment(petrolPrice, 0, finRate, years);
  const loanAnnualOutOfPocket = loanAnnualPayment + petrolRunningIncTax;
  // Wait: with a standard car loan, you own the car debt-free at end of term (0 balloon),
  // whereas on a novated lease you pay the residual balloon to own it. Both end with owning the car!
  const loanTotalOverTerm = loanAnnualOutOfPocket * years;

  // --- Option D: Paying Upfront Cash for EV (including lost Mortgage Offset / Interest on Cash) ---
  const lostOffsetInterestOverTerm = evPrice * oppRate * years * 0.75;
  const cashEvAnnualRunning = evRunningIncTax + lostOffsetInterestOverTerm / years;
  const cashEvTotalOverTerm = evPrice + evRunningIncTax * years + lostOffsetInterestOverTerm;

  return {
    country,
    years,
    annualKm,
    evEligibleFbtExempt,
    auLctThreshold: AU_LCT_EV_THRESHOLD,
    extraHecsFromRfba,
    energyComparison: {
      evEnergyAnnual: Math.round(evEnergyAnnual),
      petrolFuelAnnual: Math.round(petrolFuelAnnual),
      annualFuelSavings: Math.round(petrolFuelAnnual - evEnergyAnnual),
      termFuelSavings: Math.round((petrolFuelAnnual - evEnergyAnnual) * years),
    },
    options: {
      evNovated: {
        title: code === 'AU' ? 'EV Novated Lease (FBT-Exempt)' : 'EV Pre-Tax Salary Sacrifice',
        weeklyNetCost: Math.round(evTakeHomeReductionAnnual / 52),
        monthlyNetCost: Math.round(evTakeHomeReductionAnnual / 12),
        annualNetCost: Math.round(evTakeHomeReductionAnnual),
        annualTaxAndGstSaved: Math.round(evIncomeTaxSavedAnnual + evGstSavedOnPurchase / years),
        totalTaxAndGstSaved: Math.round(evIncomeTaxSavedAnnual * years + evGstSavedOnPurchase),
        residualBuyout: Math.round(evResidualIncGst),
        totalCostToOwnAfterTerm: Math.round(evTotalOutOfPocketOverTerm),
        preTaxSacrifice: Math.round(evPreTaxSacrifice),
        postTaxContribution: Math.round(evPostTaxContribution),
      },
      petrolNovated: {
        title: 'Petrol / Hybrid Novated Lease (ECM)',
        weeklyNetCost: Math.round(petTakeHomeReductionAnnual / 52),
        monthlyNetCost: Math.round(petTakeHomeReductionAnnual / 12),
        annualNetCost: Math.round(petTakeHomeReductionAnnual),
        annualTaxAndGstSaved: Math.round(petIncomeTaxSavedAnnual + petGstSavedOnPurchase / years),
        totalTaxAndGstSaved: Math.round(petIncomeTaxSavedAnnual * years + petGstSavedOnPurchase),
        residualBuyout: Math.round(petResidualIncGst),
        totalCostToOwnAfterTerm: Math.round(petTotalOutOfPocketOverTerm),
        preTaxSacrifice: Math.round(petPreTaxSacrifice),
        postTaxContribution: Math.round(petPostTaxContribution),
      },
      personalLoan: {
        title: 'Standard Post-Tax Car Loan (Petrol)',
        weeklyNetCost: Math.round(loanAnnualOutOfPocket / 52),
        monthlyNetCost: Math.round(loanAnnualOutOfPocket / 12),
        annualNetCost: Math.round(loanAnnualOutOfPocket),
        totalTaxAndGstSaved: 0,
        residualBuyout: 0,
        totalCostToOwnAfterTerm: Math.round(loanTotalOverTerm),
      },
      cashEv: {
        title: 'Buy EV Outright With Cash (incl. Lost Offset)',
        weeklyNetCost: Math.round(cashEvAnnualRunning / 52),
        monthlyNetCost: Math.round(cashEvAnnualRunning / 12),
        annualNetCost: Math.round(cashEvAnnualRunning),
        lostOffsetInterestOverTerm: Math.round(lostOffsetInterestOverTerm),
        totalCostToOwnAfterTerm: Math.round(cashEvTotalOverTerm),
      },
    },
  };
}

/**
 * 2. HOME DECISION: RENT VS BUY (& INVEST THE DIFFERENCE IN ETFS)
 */
export function calculateRentVsBuy(state) {
  const code = state.country || 'AU';
  const country = COUNTRIES[code] || COUNTRIES.AU;
  const salary = Math.max(0, Number(state.salary) || 0);
  const rb = { ...defaultDecisionsState(code).rentBuy, ...(state.rentBuy || {}) };

  const basePay = calcBasePay(code, salary);

  const homePrice = Math.max(50000, Number(rb.homePrice) || 850000);
  const deposit = Math.min(homePrice, Math.max(0, Number(rb.depositSaved) || 170000));
  const loanAmount = Math.max(0, homePrice - deposit);
  const mortRate = clamp(Number(rb.mortgageRatePct) || 6.1, 0.1, 20) / 100;
  const loanTermYears = Math.round(clamp(Number(rb.loanTermYears) || 30, 5, 40));
  const weeklyRent = Math.max(0, Number(rb.weeklyRent) || 720);
  const homeGrowth = clamp(Number(rb.homeGrowthPct) || 5.2, -5, 20) / 100;
  const rentGrowth = clamp(Number(rb.rentGrowthPct) || 3.8, -5, 15) / 100;
  const etfReturn = clamp(Number(rb.etfReturnPct) || 8.2, 0, 20) / 100;
  const holdingYears = Math.round(clamp(Number(rb.holdingYears) || 10, 1, 30));
  const stampDuty = homePrice * (clamp(Number(rb.buyingStampDutyPct) || 4.2, 0, 15) / 100);
  const maintRate = clamp(Number(rb.annualHomeMaintenancePct) || 1.1, 0.2, 5) / 100;

  // Monthly mortgage P&I payment
  const monthlyRate = mortRate / 12;
  const totalMonths = loanTermYears * 12;
  const monthlyMortgage =
    loanAmount > 0
      ? (loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalMonths))) /
        (Math.pow(1 + monthlyRate, totalMonths) - 1)
      : 0;

  let remainingLoan = loanAmount;
  // Renter starts with the deposit + stamp duty invested in ETFs!
  let renterPortfolio = deposit + stampDuty;
  let renterTotalContributions = deposit + stampDuty;

  const timeline = [];
  let breakevenYear = null;

  for (let yr = 1; yr <= holdingYears; yr++) {
    // Buyer year simulation
    let interestThisYear = 0;
    let principalThisYear = 0;
    for (let m = 0; m < 12; m++) {
      if (remainingLoan <= 0) break;
      const intM = remainingLoan * monthlyRate;
      const prinM = Math.min(remainingLoan, Math.max(0, monthlyMortgage - intM));
      interestThisYear += intM;
      principalThisYear += prinM;
      remainingLoan -= prinM;
    }

    const homeValEndYr = homePrice * Math.pow(1 + homeGrowth, yr);
    const ownerMaintRatesStrata = homePrice * Math.pow(1 + homeGrowth, yr - 1) * maintRate;
    const totalBuyerAnnualCashOutflow = interestThisYear + principalThisYear + ownerMaintRatesStrata;

    // Primary home has 0% Capital Gains Tax (Main Residence Exemption in AU/UK/CA/NZ/SG; $250k/$500k in US)
    const sellingCosts = homeValEndYr * 0.02;
    const buyerNetEquity = homeValEndYr - remainingLoan - sellingCosts;

    // Renter year simulation
    const annualRentYr = weeklyRent * 52 * Math.pow(1 + rentGrowth, yr - 1);
    const cashDifferenceSavedByRenter = totalBuyerAnnualCashOutflow - annualRentYr;

    // Renter portfolio grows by etfReturn + adds monthly cash difference
    renterPortfolio = renterPortfolio * (1 + etfReturn) + cashDifferenceSavedByRenter;
    renterTotalContributions += cashDifferenceSavedByRenter;

    // Estimate Capital Gains Tax if renter liquidated ETF portfolio at end of year
    const portfolioGain = Math.max(0, renterPortfolio - renterTotalContributions);
    const effectiveLtcgRate =
      code === 'AU'
        ? basePay.marginalRate * 0.5
        : code === 'NZ' || code === 'SG'
          ? 0
          : code === 'IN'
            ? 0.125
            : 0.18;
    const renterNetWealthAfterCgt = renterPortfolio - portfolioGain * effectiveLtcgRate;

    if (breakevenYear === null && buyerNetEquity >= renterNetWealthAfterCgt) {
      breakevenYear = yr;
    }

    timeline.push({
      year: yr,
      homeValue: Math.round(homeValEndYr),
      remainingLoan: Math.round(remainingLoan),
      buyerNetEquity: Math.round(buyerNetEquity),
      buyerMonthlyOutflow: Math.round(totalBuyerAnnualCashOutflow / 12),
      renterMonthlyRent: Math.round(annualRentYr / 12),
      renterNetWealthAfterCgt: Math.round(renterNetWealthAfterCgt),
      advantageBuyer: Math.round(buyerNetEquity - renterNetWealthAfterCgt),
    });
  }

  const finalYear = timeline[timeline.length - 1];
  return {
    country,
    holdingYears,
    monthlyMortgage: Math.round(monthlyMortgage),
    year1BuyerMonthlyOutflow: timeline[0]?.buyerMonthlyOutflow || 0,
    year1RenterMonthlyRent: timeline[0]?.renterMonthlyRent || 0,
    stampDuty: Math.round(stampDuty),
    breakevenYear,
    finalBuyerNetWealth: finalYear.buyerNetEquity,
    finalRenterNetWealth: finalYear.renterNetWealthAfterCgt,
    netDifference: finalYear.advantageBuyer,
    timeline,
  };
}

/**
 * 3. SMART WHAT-IF PLAYBOOKS:
 *    A) Where should my extra $X/month go? (Mortgage Offset vs Pre-Tax Super/401k vs ETFs)
 *    B) 4-Day Work Week / Part-Time Progressive Tax Cushion
 */
export function calculateWhatIfScenarios(state) {
  const code = state.country || 'AU';
  const country = COUNTRIES[code] || COUNTRIES.AU;
  const salary = Math.max(0, Number(state.salary) || 0);
  const wi = { ...defaultDecisionsState(code).whatIf, ...(state.whatIf || {}) };

  const basePay = calcBasePay(code, salary);
  const marginalRate = basePay.marginalRate;

  // --- Playbook A: Extra $X/month (Post-Tax Surplus) allocation over N years ---
  const monthlySurplus = Math.max(50, Number(wi.monthlySurplus) || 1000);
  const annualPostTaxSurplus = monthlySurplus * 12;
  const years = Math.round(clamp(Number(wi.horizonYears) || 10, 1, 30));
  const offsetRate = clamp(Number(wi.mortgageOffsetRatePct) || 6.2, 0, 18) / 100;
  const etfReturn = clamp(Number(wi.etfReturnPct) || 8.2, 0, 20) / 100;
  const superReturn = clamp(Number(wi.superReturnPct) || 7.8, 0, 20) / 100;

  // 1) Mortgage Offset Account (100% tax-free compound interest saved)
  let offsetBalance = 0;
  for (let y = 1; y <= years; y++) {
    offsetBalance = (offsetBalance + annualPostTaxSurplus) * (1 + offsetRate);
  }
  const preTaxEquivalentOfOffset = offsetRate / Math.max(0.2, 1 - marginalRate);

  // 2) Pre-Tax Super / 401(k) / Pension Salary Sacrifice
  // sacrificing `annualPostTaxSurplus / (1 - marginalRate)` pre-tax costs the EXACT SAME out-of-pocket take-home!
  const equivalentPreTaxContribution = annualPostTaxSurplus / Math.max(0.3, 1 - marginalRate);
  // In AU, concessional super contributions are taxed at 15% on entry (in US/UK/CA 0% on entry, taxed on withdrawal)
  const entryTaxRate = code === 'AU' ? 0.15 : 0;
  const netAnnualIntoRetirementFund = equivalentPreTaxContribution * (1 - entryTaxRate);
  // Earnings inside AU super are taxed at ~10–15% effective; tax-deferred in US/UK/CA
  const netSuperGrowthRate = code === 'AU' ? superReturn * 0.88 : superReturn * 0.85;
  let superBalance = 0;
  for (let y = 1; y <= years; y++) {
    superBalance = (superBalance + netAnnualIntoRetirementFund) * (1 + netSuperGrowthRate);
  }

  // 3) Personal Index ETF Portfolio (Post-tax dollars invested, taxed on dividends + discounted CGT at end)
  let etfBalance = 0;
  const totalOutOfPocketContributed = annualPostTaxSurplus * years;
  const annualAfterDividendTaxReturn = etfReturn * (1 - marginalRate * 0.25);
  for (let y = 1; y <= years; y++) {
    etfBalance = (etfBalance + annualPostTaxSurplus) * (1 + annualAfterDividendTaxReturn);
  }
  const etfUnrealizedGain = Math.max(0, etfBalance - totalOutOfPocketContributed);
  const ltcgRate = code === 'AU' ? marginalRate * 0.5 : code === 'NZ' || code === 'SG' ? 0 : 0.15;
  const etfNetAfterCgt = etfBalance - etfUnrealizedGain * ltcgRate;

  // --- Playbook B: 4-Day Work Week / Part-Time Progressive Tax Cushion ---
  const daysComparisons = [5, 4, 3].map((days) => {
    const fteRatio = days / 5;
    const scaledGross = salary * fteRatio;
    const scaledCalc = calcBasePay(code, scaledGross);
    const grossRatioPct = Math.round(fteRatio * 100);
    const netRatioPct = basePay.netIncome > 0 ? Math.round((scaledCalc.netIncome / basePay.netIncome) * 100) : 100;
    return {
      days,
      fteRatio,
      grossRatioPct,
      netRatioPct,
      grossAnnual: Math.round(scaledGross),
      netAnnual: Math.round(scaledCalc.netIncome),
      netMonthly: Math.round(scaledCalc.netIncome / 12),
      monthlyDrop: Math.round((basePay.netIncome - scaledCalc.netIncome) / 12),
      effectiveTaxRate: scaledCalc.effectiveTaxRate,
    };
  });

  return {
    country,
    basePay,
    surplusAllocation: {
      monthlySurplus,
      years,
      totalOutOfPocketContributed: Math.round(totalOutOfPocketContributed),
      offset: {
        finalValue: Math.round(offsetBalance),
        netGain: Math.round(offsetBalance - totalOutOfPocketContributed),
        preTaxEquivalentRatePct: (preTaxEquivalentOfOffset * 100).toFixed(1),
      },
      superSacrifice: {
        annualPreTaxSacrificed: Math.round(equivalentPreTaxContribution),
        annualIntoFundAfterTax: Math.round(netAnnualIntoRetirementFund),
        finalValue: Math.round(superBalance),
        netGain: Math.round(superBalance - totalOutOfPocketContributed),
      },
      etf: {
        finalValue: Math.round(etfNetAfterCgt),
        netGain: Math.round(etfNetAfterCgt - totalOutOfPocketContributed),
      },
    },
    partTimeCushion: daysComparisons,
  };
}
