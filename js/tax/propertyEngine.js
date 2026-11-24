/**
 * Multi-Country Rental Property Tax, Negative Gearing, Depreciation Schedule,
 * 10-Year Cashflow Forecaster & Capital Gains Tax (CGT) Exit Engine.
 *
 * Models real local laws across:
 *   - AU: Negative gearing, Div 43 (2.5% 40-yr) & Div 40 plant (new vs established 2017 rule),
 *         50% CGT discount + Div 43 cost-base reduction, HECS/MLS net rental loss add-back.
 *   - US: 27.5-yr MACRS residential depreciation + 5/15-yr fixtures, $25k passive loss
 *         allowance ($100k–$150k MAGI phase-out), 25% Sec 1250 depreciation recapture + LTCG.
 *   - UK: Section 24 mortgage interest restriction (20% basic rate tax credit instead of
 *         deduction), replacement domestic items, 18%/24% residential CGT above £3k allowance.
 *   - CA: Cash rental loss offset against income, Class 1 (4%) CCA capped so CCA cannot
 *         create/increase a rental loss, 100% CCA recapture on sale + 50% CGT inclusion.
 *   - IN: Section 24(a) 30% flat standard deduction on NAV + Sec 24(b) interest;
 *         Old Regime (up to ₹2L loss set-off vs salary) vs New Regime (no salary set-off);
 *         12.5% LTCG (>24 months).
 *   - NZ: 100% mortgage interest deductibility (2025/26), residential ring-fencing of net
 *         losses (carried forward), chattels depreciation, 0% CGT after 2-year Bright-Line.
 *   - SG: Actual expenses or 15% deemed rental expense + mortgage interest, rental loss
 *         ring-fenced from employment income, 0% CGT after 3-year SSD window.
 */

import { COUNTRIES } from './countries.js';
import { calculatePay, getCountryDefaultOptions } from './calculator.js';
import { clamp } from './brackets.js';

/**
 * Standard itemized Plant & Equipment / Chattel asset breakdown percentages
 * (as share of total fixtures value) and ATO / standard effective lives in years.
 */
export const PLANT_ASSET_TEMPLATES = [
  { id: 'carpets', name: 'Carpets & Floor Coverings', share: 0.24, effectiveLifeYrs: 8 },
  { id: 'ac', name: 'Air Conditioning & Heating (Split System)', share: 0.22, effectiveLifeYrs: 10 },
  { id: 'blinds', name: 'Blinds, Curtains & Window Furnishings', share: 0.14, effectiveLifeYrs: 10 },
  { id: 'kitchen', name: 'Kitchen Appliances (Oven, Cooktop, Dishwasher)', share: 0.20, effectiveLifeYrs: 10 },
  { id: 'hotwater', name: 'Hot Water System & Pumps', share: 0.12, effectiveLifeYrs: 12 },
  { id: 'alarms', name: 'Smoke Alarms, Security & Light Fittings', share: 0.08, effectiveLifeYrs: 6 },
];

export function defaultPropertyState(countryCode = 'AU') {
  const presets = {
    AU: {
      salary: 140000,
      propertyValue: 780000,
      loanAmount: 624000,
      interestRatePct: 6.2,
      weeklyRent: 680,
      annualExpenses: 6800, // council, water, strata, insurance, PM fees
      buildYear: 2020,
      isBrandNewBuild: false, // false = established residential (post-2017 Div 40 rule)
      buildingStructureCost: 320000, // historical construction cost (Div 43 base)
      plantAndEquipmentValue: 28000, // fixtures value (or newly installed items if established)
      newUpgradesInstalled: 8500, // brand-new items installed by owner in an established property
      depreciationMethod: 'diminishing', // 'diminishing' (200%) | 'prime' (100% straight-line)
      capitalGrowthPct: 5.5,
      rentGrowthPct: 4.0,
      holdingYears: 10,
      buyingCostsPct: 4.8, // stamp duty + legal
      sellingCostsPct: 2.2, // agent + legal
    },
    US: {
      salary: 150000,
      propertyValue: 520000,
      loanAmount: 416000,
      interestRatePct: 6.5,
      weeklyRent: 720, // ~$3,120/mo
      annualExpenses: 9200, // property tax, HOA, insurance, repairs
      buildYear: 2018,
      isBrandNewBuild: true,
      buildingStructureCost: 360000, // depreciable building basis (ex land)
      plantAndEquipmentValue: 24000,
      newUpgradesInstalled: 10000,
      depreciationMethod: 'prime',
      capitalGrowthPct: 4.8,
      rentGrowthPct: 3.5,
      holdingYears: 10,
      buyingCostsPct: 2.5,
      sellingCostsPct: 5.5,
    },
    UK: {
      salary: 82000,
      propertyValue: 360000,
      loanAmount: 270000,
      interestRatePct: 5.2,
      weeklyRent: 400, // ~£1,733/mo
      annualExpenses: 3400,
      buildYear: 2015,
      isBrandNewBuild: false,
      buildingStructureCost: 220000,
      plantAndEquipmentValue: 6000,
      newUpgradesInstalled: 3500, // Replacement of Domestic Items relief
      depreciationMethod: 'prime',
      capitalGrowthPct: 4.2,
      rentGrowthPct: 3.8,
      holdingYears: 10,
      buyingCostsPct: 4.5, // SDLT + legal
      sellingCostsPct: 2.0,
    },
    CA: {
      salary: 125000,
      propertyValue: 650000,
      loanAmount: 520000,
      interestRatePct: 5.4,
      weeklyRent: 650,
      annualExpenses: 6400,
      buildYear: 2019,
      isBrandNewBuild: true,
      buildingStructureCost: 420000, // Class 1 CCA (4% declining balance)
      plantAndEquipmentValue: 18000,
      newUpgradesInstalled: 6000,
      depreciationMethod: 'diminishing',
      capitalGrowthPct: 4.8,
      rentGrowthPct: 3.8,
      holdingYears: 10,
      buyingCostsPct: 3.0,
      sellingCostsPct: 4.0,
    },
    IN: {
      salary: 2800000,
      propertyValue: 12000000, // ₹1.2 Cr
      loanAmount: 9000000,
      interestRatePct: 8.6,
      weeklyRent: 8500, // ~₹36.8k/mo
      annualExpenses: 45000, // municipal property tax + society maintenance
      buildYear: 2022,
      isBrandNewBuild: true,
      buildingStructureCost: 7500000,
      plantAndEquipmentValue: 450000,
      newUpgradesInstalled: 150000,
      depreciationMethod: 'diminishing',
      capitalGrowthPct: 6.5,
      rentGrowthPct: 5.0,
      holdingYears: 10,
      buyingCostsPct: 6.5, // stamp duty + registration
      sellingCostsPct: 2.0,
    },
    NZ: {
      salary: 120000,
      propertyValue: 740000,
      loanAmount: 592000,
      interestRatePct: 6.4,
      weeklyRent: 660,
      annualExpenses: 6200,
      buildYear: 2020,
      isBrandNewBuild: true,
      buildingStructureCost: 410000,
      plantAndEquipmentValue: 22000,
      newUpgradesInstalled: 7000,
      depreciationMethod: 'diminishing',
      capitalGrowthPct: 5.0,
      rentGrowthPct: 4.0,
      holdingYears: 10,
      buyingCostsPct: 1.0,
      sellingCostsPct: 2.8,
    },
    SG: {
      salary: 140000,
      propertyValue: 1450000,
      loanAmount: 1087500,
      interestRatePct: 3.8,
      weeklyRent: 1050, // ~S$4,550/mo
      annualExpenses: 7800,
      buildYear: 2021,
      isBrandNewBuild: true,
      buildingStructureCost: 800000,
      plantAndEquipmentValue: 35000,
      newUpgradesInstalled: 10000,
      depreciationMethod: 'prime',
      capitalGrowthPct: 4.0,
      rentGrowthPct: 3.5,
      holdingYears: 10,
      buyingCostsPct: 4.0, // BSD
      sellingCostsPct: 2.0,
    },
  };

  return {
    country: countryCode,
    intent: 'own', // 'own' (already own) | 'buy' (planning to buy & forecast)
    workMode: 'employee',
    ...(presets[countryCode] || presets.AU),
  };
}

/**
 * Generates a 10-year itemized Depreciation Schedule for the property
 * (Building Structure + 6 Plant/Chattel Categories) under the selected country's law.
 */
export function generateDepreciationSchedule(state) {
  const code = state.country || 'AU';
  const buildYear = Number(state.buildYear) || 2020;
  const currentYear = 2026;
  const buildingCost = Math.max(0, Number(state.buildingStructureCost) || 0);
  const method = state.depreciationMethod === 'prime' ? 'prime' : 'diminishing';

  // Determine eligible Plant & Equipment base
  let eligiblePlantBase = Math.max(0, Number(state.plantAndEquipmentValue) || 0);
  let plantRuleNote = '';
  let structureRate = 0;
  let structureLabel = 'Building Structure (Capital Works)';
  let structureRemainingYears = 0;

  if (code === 'AU') {
    // ATO Division 43: 2.5% per year for 40 years on residential built after 15 Sept 1987
    const age = Math.max(0, currentYear - buildYear);
    structureRemainingYears = buildYear >= 1988 ? Math.max(0, 40 - age) : 0;
    structureRate = structureRemainingYears > 0 ? 0.025 : 0;
    structureLabel = 'Division 43 Capital Works (2.5% · 40-yr)';

    // ATO Division 40 (2017 second-hand rule)
    if (state.isBrandNewBuild) {
      eligiblePlantBase = Math.max(0, Number(state.plantAndEquipmentValue) || 0);
      plantRuleNote = 'Brand-new property: Full Division 40 depreciation allowed on all plant & equipment assets.';
    } else {
      eligiblePlantBase = Math.max(0, Number(state.newUpgradesInstalled) || 0);
      plantRuleNote =
        'Established property (post-May 2017 ATO rule): Existing second-hand fixtures are excluded from annual claims (saved for CGT cost base), while brand-new upgrades you install yourself are 100% depreciable.';
    }
  } else if (code === 'US') {
    // IRS MACRS 27.5 years straight-line (~3.636%/yr)
    structureRate = 1 / 27.5;
    structureRemainingYears = 28;
    structureLabel = 'IRS MACRS Residential Structure (27.5-yr Straight-Line)';
    plantRuleNote = 'US residential buildings depreciate over 27.5 years (MACRS) plus 5–10 yr appliances/improvements.';
  } else if (code === 'CA') {
    // CRA Class 1 Building: 4% declining balance (note: subject to net rental profit ceiling in tax calc)
    structureRate = 0.04;
    structureRemainingYears = 40;
    structureLabel = 'CRA Class 1 Building CCA (4% Declining Balance)';
    plantRuleNote = 'CRA allows 4% Class 1 CCA on building + Class 8 (20%) on appliances, capped so CCA cannot create a net rental loss.';
  } else if (code === 'NZ') {
    // NZ IRD: 0% building structure, chattels depreciable
    structureRate = 0;
    structureRemainingYears = 0;
    structureLabel = 'Building Structure (0% under NZ IRD rules)';
    plantRuleNote = 'NZ IRD sets residential building structure depreciation at 0%, but allows annual depreciation on distinct chattels (carpets, blinds, heat pumps, appliances).';
  } else if (code === 'UK') {
    structureRate = 0;
    structureRemainingYears = 0;
    structureLabel = 'Building Structure (0% for UK residential BTL)';
    eligiblePlantBase = Math.max(0, Number(state.newUpgradesInstalled) || 0);
    plantRuleNote = 'UK residential Buy-to-Let uses Replacement of Domestic Items Relief (deducting actual replacement of furnishings, carpets & appliances).';
  } else if (code === 'IN') {
    structureRate = 0;
    structureRemainingYears = 0;
    structureLabel = 'Covered by Section 24(a) 30% Standard Deduction';
    eligiblePlantBase = 0;
    plantRuleNote = 'India taxes residential rental under "Income from House Property", granting an automatic flat 30% Standard Deduction on Net Annual Value in place of itemized depreciation.';
  } else if (code === 'SG') {
    structureRate = 0;
    structureRemainingYears = 0;
    structureLabel = 'Covered by 15% Deemed Rental Expense Rule';
    eligiblePlantBase = 0;
    plantRuleNote = 'Singapore IRAS allows claiming a flat 15% of gross rent for repairs/furnishings (plus actual mortgage interest) without requiring an itemized depreciation schedule.';
  }

  // Build itemized asset rows for Year 1–10
  const assetItems = PLANT_ASSET_TEMPLATES.map((tpl) => {
    const openingValue = Math.round(eligiblePlantBase * tpl.share);
    return {
      ...tpl,
      openingValue,
      dvRate: Math.min(1, 2 / tpl.effectiveLifeYrs), // 200% Diminishing Value
      pcRate: 1 / tpl.effectiveLifeYrs, // 100% Prime Cost (Straight-Line)
    };
  });

  const years = [];
  let structureWrittenDown = buildingCost;
  const assetRemaining = assetItems.map((a) => a.openingValue);
  const year1Itemized = [];

  for (let yr = 1; yr <= 10; yr++) {
    // Structure deduction
    let structDed = 0;
    if (structureRate > 0 && yr <= structureRemainingYears) {
      if (code === 'CA') {
        // Declining balance 4% (half-year rule in year 1)
        const rateThisYr = yr === 1 ? structureRate * 0.5 : structureRate;
        structDed = structureWrittenDown * rateThisYr;
        structureWrittenDown = Math.max(0, structureWrittenDown - structDed);
      } else {
        structDed = buildingCost * structureRate;
      }
    }

    // Plant & equipment deduction
    let plantDed = 0;
    assetItems.forEach((asset, idx) => {
      if (assetRemaining[idx] <= 0) {
        if (yr === 1) year1Itemized.push({ ...asset, year1Deduction: 0 });
        return;
      }
      let ded = 0;
      if (code === 'UK') {
        // Replacement of domestic items claimed in Year 1 when incurred
        ded = yr === 1 ? asset.openingValue : 0;
      } else if (method === 'diminishing') {
        ded = assetRemaining[idx] * asset.dvRate;
        // Low-value pool boost when balance drops under $1,000
        if (assetRemaining[idx] < 1000) ded = assetRemaining[idx] * 0.375;
      } else {
        ded = Math.min(assetRemaining[idx], asset.openingValue * asset.pcRate);
      }
      ded = Math.min(assetRemaining[idx], ded);
      assetRemaining[idx] = Math.max(0, assetRemaining[idx] - ded);
      plantDed += ded;

      if (yr === 1) {
        year1Itemized.push({
          ...asset,
          year1Deduction: Math.round(ded),
        });
      }
    });

    years.push({
      year: yr,
      calendarYear: currentYear + yr - 1,
      structureDeduction: Math.round(structDed),
      plantDeduction: Math.round(plantDed),
      totalDeduction: Math.round(structDed + plantDed),
    });
  }

  return {
    structureLabel,
    structureRate,
    structureRemainingYears,
    eligiblePlantBase,
    plantRuleNote,
    method,
    year1Itemized,
    years,
    year1Total: years[0]?.totalDeduction || 0,
    tenYearTotal: years.reduce((s, y) => s + y.totalDeduction, 0),
  };
}

/**
 * Computes the complete Year-1 Tax & Pay Impact, 10-Year Forecast,
 * and Capital Gains Tax (CGT) Exit Summary for a rental property.
 */
export function calculatePropertyImpact(rawState, customCountryOptions = {}) {
  const code = COUNTRIES[rawState.country] ? rawState.country : 'AU';
  const country = COUNTRIES[code];
  const state = { ...defaultPropertyState(code), ...rawState, country: code };

  const salary = Math.max(0, Number(state.salary) || 0);
  const propertyValue = Math.max(0, Number(state.propertyValue) || 0);
  const loanAmount = Math.max(0, Number(state.loanAmount) || 0);
  const interestRate = clamp(Number(state.interestRatePct) || 0, 0, 25) / 100;
  const weeklyRent = Math.max(0, Number(state.weeklyRent) || 0);
  const annualRent = weeklyRent * 52;
  const annualExpenses = Math.max(0, Number(state.annualExpenses) || 0);
  const annualInterest = loanAmount * interestRate;

  // 1. Baseline Personal Pay (Without Property)
  const baseOptions = {
    ...getCountryDefaultOptions(code),
    ...(customCountryOptions[code] || {}),
  };
  const basePayInput = {
    country: code,
    mode: state.workMode || 'employee',
    amount: salary,
    ratePeriod: 'annual',
    bonus: 0,
    billableDays: country.defaultBillableDays,
    hoursPerDay: country.standardHoursPerDay,
    hoursPerWeek: country.standardHoursPerWeek,
    businessExpenses: 0,
    countryOptions: { [code]: baseOptions },
  };
  const withoutPropertyCalc = calculatePay(basePayInput);

  // 2. Generate Property Depreciation Schedule
  const depSchedule = generateDepreciationSchedule(state);
  const year1Dep = depSchedule.years[0] || { structureDeduction: 0, plantDeduction: 0, totalDeduction: 0 };

  // 3. Evaluate Year-1 Rental Tax & Personal Income Interaction by Country
  const preTaxCashflow = annualRent - annualInterest - annualExpenses;
  const yr1Eval = evaluateAnnualRentalTax({
    code,
    salary,
    annualRent,
    annualInterest,
    annualExpenses,
    structureDep: year1Dep.structureDeduction,
    plantDep: year1Dep.plantDeduction,
    basePayInput,
    withoutPropertyCalc,
  });

  // 4. Build 10-Year Forecast & Capital Gains Tax (CGT) on Exit
  const capGrowth = clamp(Number(state.capitalGrowthPct) || 0, -10, 25) / 100;
  const rentGrowth = clamp(Number(state.rentGrowthPct) || 0, -5, 20) / 100;
  const holdingYears = Math.round(clamp(Number(state.holdingYears) || 10, 1, 30));

  const forecastYears = [];
  let cumulativeNetCashflow = 0;
  let cumulativeTaxSaved = 0;
  let cumulativeStructureDepClaimed = 0;
  let cumulativeTotalDepClaimed = 0;

  for (let yr = 1; yr <= holdingYears; yr++) {
    const rentYr = annualRent * Math.pow(1 + rentGrowth, yr - 1);
    const expYr = annualExpenses * Math.pow(1 + Math.min(rentGrowth, 0.03), yr - 1);
    const depYr = depSchedule.years[yr - 1] || depSchedule.years[depSchedule.years.length - 1];

    const evalYr = evaluateAnnualRentalTax({
      code,
      salary,
      annualRent: rentYr,
      annualInterest,
      annualExpenses: expYr,
      structureDep: depYr.structureDeduction,
      plantDep: depYr.plantDeduction,
      basePayInput,
      withoutPropertyCalc,
    });

    const propValYr = propertyValue * Math.pow(1 + capGrowth, yr);
    const equityYr = propValYr - loanAmount;

    cumulativeNetCashflow += evalYr.afterTaxPropertyCashflow;
    cumulativeTaxSaved += evalYr.taxSavedOrPaid;
    cumulativeStructureDepClaimed += evalYr.claimedStructureDep;
    cumulativeTotalDepClaimed += evalYr.claimedTotalDep;

    forecastYears.push({
      year: yr,
      propertyValue: Math.round(propValYr),
      equity: Math.round(equityYr),
      grossRent: Math.round(rentYr),
      preTaxCashflow: Math.round(rentYr - annualInterest - expYr),
      depreciationClaimed: Math.round(evalYr.claimedTotalDep),
      taxSavedOrPaid: Math.round(evalYr.taxSavedOrPaid),
      afterTaxCashflow: Math.round(evalYr.afterTaxPropertyCashflow),
    });
  }

  const exitCgt = calculateExitCgt({
    code,
    state,
    salary,
    holdingYears,
    propertyValue,
    loanAmount,
    capGrowth,
    cumulativeStructureDepClaimed,
    cumulativeTotalDepClaimed,
    cumulativeNetCashflow,
    marginalRate: withoutPropertyCalc.marginalRate,
  });

  return {
    country,
    state,
    annualRent,
    annualInterest,
    annualExpenses,
    preTaxCashflow,
    withoutPropertyCalc,
    depSchedule,
    year1: yr1Eval,
    forecastYears,
    exitCgt,
    summaryMetrics: {
      grossYieldPct: propertyValue > 0 ? (annualRent / propertyValue) * 100 : 0,
      lvrPct: propertyValue > 0 ? (loanAmount / propertyValue) * 100 : 0,
      cumulativeTaxSaved,
      cumulativeNetCashflow,
    },
  };
}

/**
 * Evaluates a single year's rental tax outcome under the specific country's rules.
 * `taxSavedOrPaid`: positive = tax refund / tax saved; negative = extra tax owed.
 */
function evaluateAnnualRentalTax({
  code,
  salary,
  annualRent,
  annualInterest,
  annualExpenses,
  structureDep,
  plantDep,
  basePayInput,
  withoutPropertyCalc,
}) {
  const preTaxCashflow = annualRent - annualInterest - annualExpenses;
  let claimedStructureDep = structureDep;
  let claimedPlantDep = plantDep;
  let claimedTotalDep = structureDep + plantDep;
  let netTaxableRentalIncome = 0;
  let deductibleLossAgainstSalary = 0;
  let carriedForwardLoss = 0;
  let taxSavedOrPaid = 0;
  let newTotalTaxAndLevies = withoutPropertyCalc.incomeTax + withoutPropertyCalc.leviesAndSocial + withoutPropertyCalc.studentLoan;
  let lawTitle = '';
  let lawExplanation = '';
  let gearingStatus = 'Neutral';

  if (code === 'AU') {
    // Australia: 100% negative gearing against salary; HECS & MLS add back net rental loss!
    netTaxableRentalIncome = preTaxCashflow - claimedTotalDep;
    const adjustedGross = Math.max(0, salary + netTaxableRentalIncome);
    const withPropCalc = calculatePay({ ...basePayInput, amount: adjustedGross });

    // ATO rule: Repayment Income for HECS-HELP and MLS adds back net rental losses!
    const correctedHecs = netTaxableRentalIncome < 0 ? withoutPropertyCalc.studentLoan : withPropCalc.studentLoan;
    const correctedMls =
      netTaxableRentalIncome < 0
        ? withoutPropertyCalc.extras?.mls || 0
        : withPropCalc.extras?.mls || 0;
    const withPropMls = withPropCalc.extras?.mls || 0;

    newTotalTaxAndLevies =
      withPropCalc.incomeTax +
      (withPropCalc.leviesAndSocial - withPropMls + correctedMls) +
      correctedHecs;

    const oldTotalTax =
      withoutPropertyCalc.incomeTax +
      withoutPropertyCalc.leviesAndSocial +
      withoutPropertyCalc.studentLoan;

    taxSavedOrPaid = oldTotalTax - newTotalTaxAndLevies;
    deductibleLossAgainstSalary = netTaxableRentalIncome < 0 ? Math.abs(netTaxableRentalIncome) : 0;
    gearingStatus = netTaxableRentalIncome < 0 ? 'Negatively Geared' : 'Positively Geared';
    lawTitle = 'ATO Negative Gearing + Div 43 & Div 40 Depreciation';
    lawExplanation =
      netTaxableRentalIncome < 0
        ? 'Under Australian tax law, 100% of your net rental loss (cash shortfall + non-cash depreciation) reduces your taxable salary at your marginal tax rate. (Note: ATO adds back net rental losses when assessing HECS-HELP & Medicare Levy Surcharge thresholds.)'
        : 'Your rental income exceeds interest, running costs, and depreciation, so the net profit is taxed at your marginal tax rate.';
  } else if (code === 'US') {
    // US: 27.5-yr MACRS depreciation + $25k passive loss allowance ($100k–$150k MAGI phase-out)
    netTaxableRentalIncome = preTaxCashflow - claimedTotalDep;
    if (netTaxableRentalIncome < 0) {
      const loss = Math.abs(netTaxableRentalIncome);
      const allowance =
        salary <= 100000
          ? 25000
          : salary >= 150000
            ? 0
            : Math.max(0, 25000 - (salary - 100000) * 0.5);
      deductibleLossAgainstSalary = Math.min(loss, allowance);
      carriedForwardLoss = Math.max(0, loss - deductibleLossAgainstSalary);
      const withPropCalc = calculatePay({ ...basePayInput, amount: Math.max(0, salary - deductibleLossAgainstSalary) });
      newTotalTaxAndLevies = withPropCalc.incomeTax + withPropCalc.leviesAndSocial;
      taxSavedOrPaid = (withoutPropertyCalc.incomeTax + withoutPropertyCalc.leviesAndSocial) - newTotalTaxAndLevies;
      gearingStatus = deductibleLossAgainstSalary > 0 ? 'Passive Loss Offset' : 'Suspended Passive Loss';
    } else {
      const withPropCalc = calculatePay({ ...basePayInput, amount: salary + netTaxableRentalIncome });
      newTotalTaxAndLevies = withPropCalc.incomeTax + withPropCalc.leviesAndSocial;
      taxSavedOrPaid = (withoutPropertyCalc.incomeTax + withoutPropertyCalc.leviesAndSocial) - newTotalTaxAndLevies;
      gearingStatus = 'Taxable Rental Profit';
    }
    lawTitle = 'IRS 27.5-Yr MACRS Depreciation & Sec. 469 Passive Loss Rules';
    lawExplanation =
      carriedForwardLoss > 0
        ? `Because your income exceeds the $100k–$150k IRS Passive Activity Loss phase-out, $${Math.round(carriedForwardLoss).toLocaleString()}/yr of paper rental loss is suspended and carried forward to offset future rental profits or capital gain on sale.`
        : 'Up to $25,000 of net rental loss (including 27.5-year MACRS depreciation) offsets active income when Modified AGI is under $100,000 (phasing out by $150,000).';
  } else if (code === 'UK') {
    // UK Section 24: Mortgage interest is NOT deducted from taxable rental income;
    // instead landlord gets a max 20% basic rate tax credit on mortgage interest!
    const operatingProfitBeforeInterest = annualRent - annualExpenses - claimedPlantDep;
    netTaxableRentalIncome = operatingProfitBeforeInterest;

    if (operatingProfitBeforeInterest > 0) {
      const withPropCalc = calculatePay({ ...basePayInput, amount: salary + operatingProfitBeforeInterest });
      const rawExtraTax =
        withPropCalc.incomeTax + withPropCalc.leviesAndSocial + withPropCalc.studentLoan -
        (withoutPropertyCalc.incomeTax + withoutPropertyCalc.leviesAndSocial + withoutPropertyCalc.studentLoan);
      // Section 24 basic rate (20%) credit on the lower of: mortgage interest, property profit, or adjusted total income
      const eligibleForCredit = Math.min(annualInterest, operatingProfitBeforeInterest);
      const sec24Credit = eligibleForCredit * 0.20;
      const netExtraTax = Math.max(0, rawExtraTax - sec24Credit);
      taxSavedOrPaid = -netExtraTax;
      newTotalTaxAndLevies =
        withoutPropertyCalc.incomeTax + withoutPropertyCalc.leviesAndSocial + withoutPropertyCalc.studentLoan + netExtraTax;
    } else {
      carriedForwardLoss = Math.abs(operatingProfitBeforeInterest);
      taxSavedOrPaid = 0;
    }
    gearingStatus = preTaxCashflow < 0 ? 'Section 24 Restricted' : 'Cashflow Positive';
    lawTitle = 'UK Section 24 Mortgage Interest Restriction (20% Tax Credit)';
    lawExplanation =
      'Under HMRC Section 24 rules for individual Buy-to-Let landlords, mortgage interest cannot be deducted from rental income (and rental losses cannot offset PAYE salary). Instead, you are taxed on rent minus running costs and receive a flat 20% tax credit on mortgage interest.';
  } else if (code === 'CA') {
    // Canada: Cash rental losses CAN offset personal income, but CCA (depreciation) CANNOT create or increase a rental loss!
    if (preTaxCashflow < 0) {
      claimedStructureDep = 0;
      claimedPlantDep = 0;
      claimedTotalDep = 0;
      netTaxableRentalIncome = preTaxCashflow;
      deductibleLossAgainstSalary = Math.abs(preTaxCashflow);
    } else {
      claimedTotalDep = Math.min(preTaxCashflow, structureDep + plantDep);
      const ratio = structureDep + plantDep > 0 ? claimedTotalDep / (structureDep + plantDep) : 0;
      claimedStructureDep = structureDep * ratio;
      claimedPlantDep = plantDep * ratio;
      netTaxableRentalIncome = preTaxCashflow - claimedTotalDep;
    }
    const withPropCalc = calculatePay({ ...basePayInput, amount: Math.max(0, salary + netTaxableRentalIncome) });
    newTotalTaxAndLevies = withPropCalc.incomeTax + withPropCalc.leviesAndSocial;
    taxSavedOrPaid = (withoutPropertyCalc.incomeTax + withoutPropertyCalc.leviesAndSocial) - newTotalTaxAndLevies;
    gearingStatus = preTaxCashflow < 0 ? 'Negatively Geared (Cash Loss)' : 'CCA Sheltered';
    lawTitle = 'CRA Rental Loss Deductibility & Class 1 CCA Restriction';
    lawExplanation =
      preTaxCashflow < 0
        ? 'In Canada, cash rental losses (when interest & expenses exceed rent) offset your personal employment income. However, CRA rules prohibit using Capital Cost Allowance (depreciation) to create or increase a rental loss.'
        : 'Your property has positive cashflow, allowing you to use Class 1 (4%) Capital Cost Allowance to shelter up to 100% of the net rental profit from tax today.';
  } else if (code === 'IN') {
    // India: Section 24(a) 30% standard deduction on Net Annual Value (Rent - Municipal Taxes) + Sec 24(b) interest.
    const nav = Math.max(0, annualRent - annualExpenses);
    const stdDeduction30 = nav * 0.30;
    claimedStructureDep = stdDeduction30;
    claimedPlantDep = 0;
    claimedTotalDep = stdDeduction30;
    netTaxableRentalIncome = nav - stdDeduction30 - annualInterest;

    const regime = basePayInput.countryOptions?.IN?.regime || 'new';
    if (netTaxableRentalIncome < 0) {
      if (regime === 'old') {
        // Old Regime allows setting off up to ₹2,00,000 of House Property loss against Salary!
        deductibleLossAgainstSalary = Math.min(Math.abs(netTaxableRentalIncome), 200000);
        carriedForwardLoss = Math.max(0, Math.abs(netTaxableRentalIncome) - 200000);
      } else {
        // New Regime does NOT allow setting off House Property loss against Salary!
        deductibleLossAgainstSalary = 0;
        carriedForwardLoss = Math.abs(netTaxableRentalIncome);
      }
      const withPropCalc = calculatePay({ ...basePayInput, amount: Math.max(0, salary - deductibleLossAgainstSalary) });
      newTotalTaxAndLevies = withPropCalc.incomeTax + withPropCalc.leviesAndSocial;
      taxSavedOrPaid = (withoutPropertyCalc.incomeTax + withoutPropertyCalc.leviesAndSocial) - newTotalTaxAndLevies;
    } else {
      const withPropCalc = calculatePay({ ...basePayInput, amount: salary + netTaxableRentalIncome });
      newTotalTaxAndLevies = withPropCalc.incomeTax + withPropCalc.leviesAndSocial;
      taxSavedOrPaid = (withoutPropertyCalc.incomeTax + withoutPropertyCalc.leviesAndSocial) - newTotalTaxAndLevies;
    }
    gearingStatus =
      netTaxableRentalIncome < 0
        ? regime === 'old'
          ? 'Sec 24 Loss Set-Off (₹2L Cap)'
          : 'Loss Blocked in New Regime'
        : 'Taxable House Property';
    lawTitle = 'India Sec 24(a) 30% Standard Deduction & Sec 71 Loss Set-Off';
    lawExplanation =
      netTaxableRentalIncome < 0 && regime === 'new'
        ? 'Under India’s New Tax Regime (FY 2025–26), a net loss from House Property cannot be set off against Salary income. Switching to the Old Tax Regime allows setting off up to ₹2,00,000/yr of rental loss against your salary.'
        : 'India grants an automatic 30% flat Standard Deduction on Net Annual Value (Section 24a) plus mortgage interest deduction (Section 24b). Under the Old Regime, up to ₹2,00,000 of net rental loss offsets salary income.';
  } else if (code === 'NZ') {
    // New Zealand: 100% interest deductibility restored for 2025/26, but residential rental losses are ring-fenced!
    netTaxableRentalIncome = preTaxCashflow - claimedTotalDep;
    if (netTaxableRentalIncome < 0) {
      deductibleLossAgainstSalary = 0;
      carriedForwardLoss = Math.abs(netTaxableRentalIncome);
      taxSavedOrPaid = 0;
      gearingStatus = 'Ring-Fenced Loss (Carry Forward)';
    } else {
      const withPropCalc = calculatePay({ ...basePayInput, amount: salary + netTaxableRentalIncome });
      newTotalTaxAndLevies = withPropCalc.incomeTax + withPropCalc.leviesAndSocial + withPropCalc.studentLoan;
      taxSavedOrPaid =
        withoutPropertyCalc.incomeTax + withoutPropertyCalc.leviesAndSocial + withoutPropertyCalc.studentLoan -
        newTotalTaxAndLevies;
      gearingStatus = 'Taxable Rental Profit';
    }
    lawTitle = 'NZ 100% Interest Deductibility & Residential Ring-Fencing';
    lawExplanation =
      'From 1 April 2025 (2025/26 tax year), 100% of residential mortgage interest is tax-deductible again in New Zealand. However, residential ring-fencing rules mean a net rental loss cannot reduce your PAYE salary tax today — instead it carries forward to shelter future rental profits.';
  } else if (code === 'SG') {
    // Singapore: 15% deemed rental expenses (or actual) + mortgage interest; losses cannot offset employment income.
    const deemedExpenses = annualRent * 0.15;
    const usedExpenses = Math.max(annualExpenses, deemedExpenses);
    netTaxableRentalIncome = annualRent - usedExpenses - annualInterest;
    if (netTaxableRentalIncome < 0) {
      carriedForwardLoss = Math.abs(netTaxableRentalIncome);
      taxSavedOrPaid = 0;
      gearingStatus = 'Loss Non-Deductible vs Salary';
    } else {
      const withPropCalc = calculatePay({ ...basePayInput, amount: salary + netTaxableRentalIncome });
      newTotalTaxAndLevies = withPropCalc.incomeTax + withPropCalc.leviesAndSocial;
      taxSavedOrPaid = (withoutPropertyCalc.incomeTax + withoutPropertyCalc.leviesAndSocial) - newTotalTaxAndLevies;
      gearingStatus = 'Taxable Rental Profit';
    }
    lawTitle = 'Singapore IRAS 15% Deemed Expense Option & Rental Rules';
    lawExplanation =
      'IRAS lets residential landlords claim either actual running expenses or a simplified 15% of gross rent (plus 100% of mortgage interest). Net rental deficits cannot be offset against employment salary.';
  }

  const afterTaxPropertyCashflow = preTaxCashflow + taxSavedOrPaid;
  const combinedTakeHomeWithProperty = withoutPropertyCalc.netIncome + afterTaxPropertyCashflow;

  return {
    preTaxCashflow,
    claimedStructureDep,
    claimedPlantDep,
    claimedTotalDep,
    netTaxableRentalIncome,
    deductibleLossAgainstSalary,
    carriedForwardLoss,
    taxSavedOrPaid,
    afterTaxPropertyCashflow,
    weeklyAfterTaxImpact: afterTaxPropertyCashflow / 52,
    monthlyAfterTaxImpact: afterTaxPropertyCashflow / 12,
    combinedTakeHomeWithProperty,
    newTotalTaxAndLevies,
    gearingStatus,
    lawTitle,
    lawExplanation,
  };
}

/**
 * Computes Capital Gains Tax (CGT), depreciation recapture / cost-base adjustments,
 * and net walk-away profit if sold at the end of `holdingYears`.
 */
function calculateExitCgt({
  code,
  state,
  holdingYears,
  propertyValue,
  loanAmount,
  capGrowth,
  cumulativeStructureDepClaimed,
  cumulativeTotalDepClaimed,
  cumulativeNetCashflow,
  marginalRate,
}) {
  const salePrice = propertyValue * Math.pow(1 + capGrowth, holdingYears);
  const buyingCosts = propertyValue * (clamp(Number(state.buyingCostsPct) || 0, 0, 15) / 100);
  const sellingCosts = salePrice * (clamp(Number(state.sellingCostsPct) || 0, 0, 15) / 100);
  const rawCapitalGain = salePrice - propertyValue - buyingCosts - sellingCosts;

  let costBaseAdjustmentOrRecapture = 0;
  let taxableCapitalGain = 0;
  let estimatedCgtAndRecaptureTax = 0;
  let cgtRuleNote = '';

  if (code === 'AU') {
    // ATO: Claimed Div 43 Capital Works deductions reduce your CGT Cost Base (increasing capital gain),
    // then the 50% CGT discount applies if held > 12 months!
    costBaseAdjustmentOrRecapture = cumulativeStructureDepClaimed;
    const adjustedGain = rawCapitalGain + costBaseAdjustmentOrRecapture;
    const discountMultiplier = holdingYears >= 1 ? 0.5 : 1.0;
    taxableCapitalGain = Math.max(0, adjustedGain * discountMultiplier);
    estimatedCgtAndRecaptureTax = taxableCapitalGain * Math.max(0.32, marginalRate);
    cgtRuleNote =
      'ATO rules reduce your property cost base by the Division 43 building depreciation claimed during ownership, then apply the 50% individual CGT discount (held > 12 months) at your marginal rate.';
  } else if (code === 'US') {
    // IRS: Section 1250 Depreciation Recapture taxed at up to 25%, plus LTCG (~15%–20% + state) on raw gain!
    costBaseAdjustmentOrRecapture = cumulativeTotalDepClaimed;
    const recaptureTax = Math.max(0, Math.min(rawCapitalGain + costBaseAdjustmentOrRecapture, costBaseAdjustmentOrRecapture)) * 0.25;
    const ltcgTax = Math.max(0, rawCapitalGain) * 0.188; // ~15% federal LTCG + 3.8% NIIT/state approx
    taxableCapitalGain = Math.max(0, rawCapitalGain + costBaseAdjustmentOrRecapture);
    estimatedCgtAndRecaptureTax = recaptureTax + ltcgTax;
    cgtRuleNote =
      'IRS Section 1250 recaptures claimed MACRS depreciation at up to 25% on sale, while appreciation above original cost basis is taxed at Long-Term Capital Gains rates (unless deferred via a 1031 Exchange).';
  } else if (code === 'UK') {
    // UK: £3,000 annual CGT allowance; 24% higher-rate residential CGT (18% basic)
    const allowance = 3000;
    taxableCapitalGain = Math.max(0, rawCapitalGain - allowance);
    const ukCgtRate = marginalRate > 0.30 ? 0.24 : 0.18;
    estimatedCgtAndRecaptureTax = taxableCapitalGain * ukCgtRate;
    cgtRuleNote = `UK residential property gains above the £3,000 annual exemption are taxed at ${(ukCgtRate * 100).toFixed(0)}% (2025/26 residential CGT rate).`;
  } else if (code === 'CA') {
    // CRA: 100% of claimed CCA is recaptured as regular income + 50% inclusion rate on capital gain!
    costBaseAdjustmentOrRecapture = cumulativeTotalDepClaimed;
    const recaptureTax = costBaseAdjustmentOrRecapture * marginalRate;
    taxableCapitalGain = Math.max(0, rawCapitalGain * 0.5);
    estimatedCgtAndRecaptureTax = recaptureTax + taxableCapitalGain * marginalRate;
    cgtRuleNote =
      'CRA recaptures 100% of claimed CCA as ordinary income upon sale, while 50% of the capital appreciation above original cost is included in taxable income.';
  } else if (code === 'IN') {
    // India: 12.5% LTCG (+ 4% cess => 13%) on property held > 24 months
    taxableCapitalGain = Math.max(0, rawCapitalGain);
    const rate = holdingYears >= 2 ? 0.125 * 1.04 : marginalRate;
    estimatedCgtAndRecaptureTax = taxableCapitalGain * rate;
    cgtRuleNote =
      'Under updated Indian LTCG rules for real estate held over 24 months, capital gains are taxed at 12.5% (+ 4% cess) or can be rolled over into a residential house under Section 54.';
  } else if (code === 'NZ') {
    // NZ: 0% CGT after 2-year Bright-Line test; chattels depreciation recovery if sold above written-down value
    const brightLineApplies = holdingYears < 2;
    taxableCapitalGain = brightLineApplies ? Math.max(0, rawCapitalGain) : 0;
    estimatedCgtAndRecaptureTax = taxableCapitalGain * marginalRate;
    cgtRuleNote = brightLineApplies
      ? 'Sold within New Zealand’s 2-year Bright-Line window — gain is taxed at your marginal income tax rate.'
      : 'Held beyond New Zealand’s 2-year Bright-Line period — 0% Capital Gains Tax applies on the property appreciation.';
  } else if (code === 'SG') {
    // Singapore: 0% CGT (Seller's Stamp Duty applies only if sold within 3 years)
    taxableCapitalGain = 0;
    estimatedCgtAndRecaptureTax = 0;
    cgtRuleNote =
      'Singapore does not levy Capital Gains Tax on long-term residential property investments (held beyond the 3-year Seller’s Stamp Duty window).';
  }

  const initialCashInvested = Math.max(0, propertyValue - loanAmount) + buyingCosts;
  const netSaleProceedsAfterLoanAndCgt =
    salePrice - loanAmount - sellingCosts - estimatedCgtAndRecaptureTax;
  const totalNetWealthCreated =
    netSaleProceedsAfterLoanAndCgt - initialCashInvested + cumulativeNetCashflow;

  return {
    holdingYears,
    salePrice: Math.round(salePrice),
    buyingCosts: Math.round(buyingCosts),
    sellingCosts: Math.round(sellingCosts),
    rawCapitalGain: Math.round(rawCapitalGain),
    costBaseAdjustmentOrRecapture: Math.round(costBaseAdjustmentOrRecapture),
    taxableCapitalGain: Math.round(taxableCapitalGain),
    estimatedCgtAndRecaptureTax: Math.round(estimatedCgtAndRecaptureTax),
    initialCashInvested: Math.round(initialCashInvested),
    netSaleProceedsAfterLoanAndCgt: Math.round(netSaleProceedsAfterLoanAndCgt),
    totalNetWealthCreated: Math.round(totalNetWealthCreated),
    cgtRuleNote,
  };
}
