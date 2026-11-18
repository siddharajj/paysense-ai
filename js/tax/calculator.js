/**
 * Unified Multi-Country Pay Calculator, Reverse Goal Solver,
 * and Contractor vs Permanent (FTE) Comparator.
 */

import { COUNTRIES } from './countries.js';
import * as AU from './au.js';
import * as US from './us.js';
import * as UK from './uk.js';
import * as CA from './ca.js';
import * as IN from './in.js';
import * as NZ from './nz.js';
import * as SG from './sg.js';

const ENGINES = { AU, US, UK, CA, IN, NZ, SG };

export function getCountryDefaultOptions(countryCode) {
  const engine = ENGINES[countryCode] || AU;
  return engine.defaultOptions();
}

/**
 * Normalize user input (annual/monthly/fortnightly/weekly/daily/hourly + bonus)
 * into annual gross income.
 */
export function computeAnnualGross(input) {
  const country = COUNTRIES[input.country] || COUNTRIES.AU;
  const amount = Math.max(0, Number(input.amount) || 0);
  const bonus = Math.max(0, Number(input.bonus) || 0);
  const hoursPerDay = Math.max(1, Number(input.hoursPerDay) || country.standardHoursPerDay);
  const hoursPerWeek = Math.max(1, Number(input.hoursPerWeek) || country.standardHoursPerWeek);
  const billableDays = Math.max(1, Number(input.billableDays) || country.defaultBillableDays);

  let baseAnnual = amount;
  if (input.mode === 'contractor') {
    switch (input.ratePeriod) {
      case 'hourly':
        baseAnnual = amount * hoursPerDay * billableDays;
        break;
      case 'daily':
        baseAnnual = amount * billableDays;
        break;
      case 'weekly':
        baseAnnual = amount * (billableDays / 5);
        break;
      case 'monthly':
        baseAnnual = amount * 12;
        break;
      case 'annual':
      default:
        baseAnnual = amount;
        break;
    }
  } else {
    switch (input.ratePeriod) {
      case 'hourly':
        baseAnnual = amount * hoursPerWeek * 52;
        break;
      case 'daily':
        baseAnnual = amount * 260;
        break;
      case 'weekly':
        baseAnnual = amount * 52;
        break;
      case 'fortnightly':
        baseAnnual = amount * 26;
        break;
      case 'monthly':
        baseAnnual = amount * 12;
        break;
      case 'annual':
      default:
        baseAnnual = amount;
        break;
    }
  }

  return baseAnnual + bonus;
}

/**
 * Full pay calculation for any supported country and work mode.
 */
export function calculatePay(input) {
  const countryCode = ENGINES[input.country] ? input.country : 'AU';
  const country = COUNTRIES[countryCode];
  const engine = ENGINES[countryCode];

  const annualGross = computeAnnualGross(input);
  const options = {
    ...engine.defaultOptions(),
    ...(input.countryOptions?.[countryCode] || {}),
    businessExpenses: input.mode === 'contractor' ? Math.max(0, Number(input.businessExpenses) || 0) : 0,
  };

  const result = engine.calculate(annualGross, input.mode, options);

  const billableDays = Math.max(1, Number(input.billableDays) || country.defaultBillableDays);
  const hoursPerDay = Math.max(1, Number(input.hoursPerDay) || country.standardHoursPerDay);
  const hoursPerWeek = Math.max(1, Number(input.hoursPerWeek) || country.standardHoursPerWeek);
  const annualHours = input.mode === 'contractor' ? billableDays * hoursPerDay : hoursPerWeek * 52;
  const workingDays = input.mode === 'contractor' ? billableDays : 260;

  const divide = (val) => ({
    annual: val,
    monthly: val / 12,
    fortnightly: val / 26,
    weekly: val / 52,
    daily: val / workingDays,
    hourly: val / Math.max(1, annualHours),
  });

  const periods = {
    gross: divide(result.grossIncome),
    tax: divide(result.incomeTax),
    levies: divide(result.leviesAndSocial + result.studentLoan),
    retirement: divide(result.totalRetirement),
    expenses: divide(result.businessExpenses),
    net: divide(result.netIncome),
    totalPackage: divide(result.totalPackage),
  };

  // Contractor vs FTE Equivalent Comparison
  const fteComparison = computeContractorVsFte(input, result, country, engine, options);

  return {
    country,
    mode: input.mode,
    annualGross,
    workingDays,
    annualHours,
    options,
    ...result,
    periods,
    fteComparison,
  };
}

/**
 * Solve for the required gross input (salary or contractor rate) to hit a desired NET take-home.
 * Uses fast monotonic binary search — converges to < $1 accuracy in 40 iterations.
 */
export function solveGrossForTargetNet(targetNetAnnual, input) {
  if (targetNetAnnual <= 0) return 0;
  let low = targetNetAnnual;
  let high = targetNetAnnual * 2.8 + 50000;

  // Ensure upper bound exceeds target net
  for (let i = 0; i < 10; i++) {
    const probe = calculatePay({ ...input, amount: high, ratePeriod: 'annual', bonus: 0 });
    if (probe.netIncome >= targetNetAnnual) break;
    high *= 2;
  }

  for (let i = 0; i < 44; i++) {
    const mid = (low + high) / 2;
    const probe = calculatePay({ ...input, amount: mid, ratePeriod: 'annual', bonus: 0 });
    if (probe.netIncome < targetNetAnnual) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const solvedAnnual = (low + high) / 2;
  const country = COUNTRIES[input.country] || COUNTRIES.AU;
  const hoursPerDay = Math.max(1, Number(input.hoursPerDay) || country.standardHoursPerDay);
  const hoursPerWeek = Math.max(1, Number(input.hoursPerWeek) || country.standardHoursPerWeek);
  const billableDays = Math.max(1, Number(input.billableDays) || country.defaultBillableDays);

  // Convert solved annual back to the active ratePeriod
  if (input.mode === 'contractor') {
    if (input.ratePeriod === 'hourly') return solvedAnnual / (hoursPerDay * billableDays);
    if (input.ratePeriod === 'daily') return solvedAnnual / billableDays;
    if (input.ratePeriod === 'weekly') return solvedAnnual / (billableDays / 5);
    if (input.ratePeriod === 'monthly') return solvedAnnual / 12;
    return solvedAnnual;
  } else {
    if (input.ratePeriod === 'hourly') return solvedAnnual / (hoursPerWeek * 52);
    if (input.ratePeriod === 'daily') return solvedAnnual / 260;
    if (input.ratePeriod === 'weekly') return solvedAnnual / 52;
    if (input.ratePeriod === 'fortnightly') return solvedAnnual / 26;
    if (input.ratePeriod === 'monthly') return solvedAnnual / 12;
    return solvedAnnual;
  }
}

/**
 * Computes:
 * 1) What FTE salary produces the SAME total wealth (net cash + retirement) as this Contractor setup
 * 2) If user provided a comparison FTE offer (compareFteSalary), how the two stack up side-by-side!
 */
function computeContractorVsFte(input, currentRes, country, engine, currentOptions) {
  const fteOptions = {
    ...currentOptions,
    businessExpenses: 0,
    includesSuper: false, // standard base + super FTE comparison
  };

  if (input.mode === 'contractor') {
    const contractorTotalWealth = currentRes.netIncome + currentRes.totalRetirement;

    // Binary search FTE base salary whose (net + totalRetirement) matches contractorTotalWealth
    let lo = 0;
    let hi = Math.max(currentRes.grossIncome * 1.5, 50000);
    for (let i = 0; i < 36; i++) {
      const mid = (lo + hi) / 2;
      const fteRes = engine.calculate(mid, 'employee', fteOptions);
      const fteWealth = fteRes.netIncome + fteRes.totalRetirement;
      if (fteWealth < contractorTotalWealth) lo = mid;
      else hi = mid;
    }
    const equivalentFteBase = (lo + hi) / 2;
    const equivalentFteRes = engine.calculate(equivalentFteBase, 'employee', fteOptions);

    // Optional explicit comparison FTE salary entered by user or parsed from natural language
    const compareSalary = Number(input.compareSalary) > 0 ? Number(input.compareSalary) : null;
    const compareRes = compareSalary ? engine.calculate(compareSalary, 'employee', fteOptions) : null;

    const billableDays = Math.max(1, Number(input.billableDays) || country.defaultBillableDays);
    const unpaidLeaveValueNote = `${country.paidLeaveDays}d annual + ${country.sickLeaveDays}d sick + ${country.publicHolidays}d public holidays`;

    return {
      direction: 'contractor-to-fte',
      equivalentFteBase,
      equivalentFtePackage: equivalentFteRes.totalPackage,
      equivalentFteNet: equivalentFteRes.netIncome,
      compareSalary,
      compareRes,
      billableDays,
      unpaidLeaveValueNote,
      netDeltaVsCompare: compareRes ? currentRes.netIncome - compareRes.netIncome : null,
      wealthDeltaVsCompare: compareRes
        ? currentRes.netIncome + currentRes.totalRetirement - (compareRes.netIncome + compareRes.totalRetirement)
        : null,
    };
  } else {
    // Employee mode: What contractor day rate matches this FTE job?
    const fteTotalWealth = currentRes.netIncome + currentRes.totalRetirement;
    const billableDays = Math.max(1, Number(input.billableDays) || country.defaultBillableDays);
    const contractorOpts = { ...currentOptions, businessExpenses: 0 };

    let lo = 0;
    let hi = Math.max(currentRes.totalPackage * 2, 50000);
    for (let i = 0; i < 36; i++) {
      const mid = (lo + hi) / 2;
      const cRes = engine.calculate(mid, 'contractor', contractorOpts);
      const cWealth = cRes.netIncome + cRes.totalRetirement;
      if (cWealth < fteTotalWealth) lo = mid;
      else hi = mid;
    }
    const equivalentContractorAnnual = (lo + hi) / 2;
    const equivalentDayRate = equivalentContractorAnnual / billableDays;
    const equivalentHourlyRate = equivalentDayRate / country.standardHoursPerDay;

    const compareDayRate = Number(input.compareDayRate) > 0 ? Number(input.compareDayRate) : null;
    const compareRes = compareDayRate
      ? engine.calculate(compareDayRate * billableDays, 'contractor', contractorOpts)
      : null;

    return {
      direction: 'fte-to-contractor',
      equivalentContractorAnnual,
      equivalentDayRate,
      equivalentHourlyRate,
      billableDays,
      compareDayRate,
      compareRes,
      netDeltaVsCompare: compareRes ? compareRes.netIncome - currentRes.netIncome : null,
      wealthDeltaVsCompare: compareRes
        ? compareRes.netIncome + compareRes.totalRetirement - (currentRes.netIncome + currentRes.totalRetirement)
        : null,
    };
  }
}
