/**
 * Smart Contextual Pay Advisor (100% client-side, instant, $0).
 * Generates actionable tax-optimization alerts, cliff warnings,
 * contractor tax vault rules, and breakeven takeaways.
 */

import { formatCurrency, formatPercent } from '../tax/brackets.js';

export function generateInsights(calc, state) {
  const insights = [];
  const { country, mode, options, extras = {}, fteComparison } = calc;
  const fmt = (n) => formatCurrency(n, country.currency, country.locale);

  // 1. Contractor Tax Vault (High-value practical rule for every contractor!)
  if (mode === 'contractor' && calc.grossIncome > 0) {
    const setAsideRatio = calc.taxVaultAnnual / Math.max(1, calc.grossIncome + calc.indirectTaxInvoice);
    const perMonthVault = calc.taxVaultAnnual / 12;
    const perInvoiceNote = calc.indirectTaxInvoice > 0
      ? ` (includes ${fmt(calc.indirectTaxInvoice / 12)}/mo pass-through ${country.indirectTaxLabel})`
      : '';
    insights.push({
      tone: 'info',
      badge: 'Tax Vault Rule',
      title: `Set aside ${formatPercent(setAsideRatio, 0)} of every invoice (${fmt(perMonthVault)}/mo)`,
      body: `Transfer ${fmt(calc.taxVaultAnnual)}/yr into a separate tax savings account${perInvoiceNote} so quarterly/annual tax bills never surprise your cashflow.`,
    });
  }

  // 2. Contractor vs FTE Reality Check takeaway
  if (mode === 'contractor' && fteComparison?.compareRes) {
    const diff = fteComparison.wealthDeltaVsCompare;
    const ahead = diff >= 0;
    insights.push({
      tone: ahead ? 'positive' : 'warning',
      badge: 'Offer Verdict',
      title: ahead
        ? `Contracting beats ${fmt(fteComparison.compareSalary)} FTE by ${fmt(diff)}/yr`
        : `${fmt(fteComparison.compareSalary)} FTE beats this day rate by ${fmt(Math.abs(diff))}/yr`,
      body: `Comparing total take-home + ${country.retirementLabel} at ${fteComparison.billableDays} billable days/yr. Your breakeven FTE base salary is ~${fmt(fteComparison.equivalentFteBase)} + ${country.retirementLabel}.`,
    });
  } else if (mode === 'contractor' && calc.grossIncome > 0) {
    insights.push({
      tone: 'positive',
      badge: 'FTE Equivalent',
      title: `Equivalent to ~${fmt(fteComparison.equivalentFteBase)} + ${country.retirementLabel} permanent salary`,
      body: `At ${fteComparison.billableDays} billable days/yr (accounting for ${fteComparison.unpaidLeaveValueNote}), this contracting rate produces the same net cash + retirement wealth as a ${fmt(fteComparison.equivalentFtePackage)} total FTE package.`,
    });
  }

  // 3. Country-specific high-leverage tax alerts
  if (country.code === 'AU') {
    if (extras.mls > 0) {
      insights.push({
        tone: 'warning',
        badge: 'MLS Alert',
        title: `Paying ${fmt(extras.mls)}/yr in Medicare Levy Surcharge`,
        body: `Because your income exceeds $101,000 without private hospital cover, you owe MLS. Basic hospital cover often costs less than ${fmt(extras.mls)}/yr and eliminates this surcharge.`,
      });
    }
    const superHeadroom = Math.max(0, 30000 - (calc.totalRetirement || 0));
    if (calc.marginalRate >= 0.32 && superHeadroom >= 2000) {
      const potentialSacrifice = Math.min(superHeadroom, 10000);
      const taxSaved = potentialSacrifice * Math.max(0, calc.marginalRate - 0.15);
      insights.push({
        tone: 'tip',
        badge: 'Super Tax Arbitrage',
        title: `Up to ${fmt(superHeadroom)} left in your $30k concessional super cap`,
        body: `Salary sacrificing ${fmt(potentialSacrifice)} into super could save ~${fmt(taxSaved)} in tax this year (15% super tax vs your ${formatPercent(calc.marginalRate, 0)} marginal rate).`,
      });
    }
  }

  if (country.code === 'UK') {
    if (extras.in100kTrap) {
      const excessOver100k = Math.max(0, calc.grossIncome - calc.businessExpenses - calc.employeeRetirement - 100000);
      insights.push({
        tone: 'warning',
        badge: '60% Tax Trap',
        title: `You’re inside the UK £100k–£125k Personal Allowance taper`,
        body: `Every £2 earned over £100k loses £1 of tax-free Personal Allowance, creating an effective ${formatPercent(calc.marginalRate, 0)} marginal rate. Contributing ${fmt(excessOver100k)} into your pension restores the full £12,570 allowance.`,
      });
    }
  }

  if (country.code === 'US') {
    if (mode === 'contractor' && extras.qbiDeduction > 0) {
      insights.push({
        tone: 'positive',
        badge: 'QBI Savings',
        title: `Section 199A QBI deduction shields ${fmt(extras.qbiDeduction)} from Federal tax`,
        body: `Also consider an S-Corp election if net profit consistently exceeds $90k–$100k, or maxing a Solo 401(k) to shelter up to $69,000/yr.`,
      });
    }
    if (mode === 'employee' && calc.employeeRetirement < 23500 && calc.marginalRate >= 0.24) {
      const headroom = 23500 - calc.employeeRetirement;
      insights.push({
        tone: 'tip',
        badge: '401(k) Headroom',
        title: `${fmt(headroom)} remaining in your 2025 401(k) deferral cap ($23,500)`,
        body: `Every $1,000 added pre-tax reduces your current tax bill by roughly ${fmt(1000 * Math.max(0.22, calc.marginalRate - 0.0765))}.`,
      });
    }
  }

  if (country.code === 'IN') {
    if (mode === 'contractor' && extras.presumptive44ADAApplied) {
      insights.push({
        tone: 'positive',
        badge: 'Section 44ADA Advantage',
        title: `Only 50% of your receipts (${fmt(calc.taxableIncome)}) are taxed`,
        body: `Under Section 44ADA for eligible professionals (IT, engineering, design, consulting up to ₹75L), you don’t need to maintain detailed expense books to claim 50% deemed expenses.`,
      });
    }
    if (options.regime === 'new' && calc.taxableIncome <= 1200000 && calc.grossIncome > 400000) {
      insights.push({
        tone: 'positive',
        badge: 'Zero Income Tax',
        title: `Section 87A Rebate wipes out your income tax completely`,
        body: `Under the Budget 2025 New Tax Regime, taxable income up to ₹12,00,000 pays ₹0 income tax.`,
      });
    }
  }

  if (country.code === 'CA' && calc.marginalRate >= 0.35 && (options.rrspAnnual || 0) < 5000) {
    insights.push({
      tone: 'tip',
      badge: 'RRSP Opportunity',
      title: `Every $1,000 in RRSP saves ~${fmt(1000 * calc.marginalRate)} in tax`,
      body: `At your ${formatPercent(calc.marginalRate, 1)} combined Federal + ${extras.provinceName || 'Provincial'} marginal rate, RRSP contributions deliver strong upfront tax refunds.`,
    });
  }

  if (country.code === 'SG' && calc.incomeTax > 2000 && (options.srsContribution || 0) === 0) {
    const cap = options.residency === 'expat-ep' ? 35700 : 15300;
    insights.push({
      tone: 'tip',
      badge: 'SRS Tax Relief',
      title: `Up to ${fmt(cap)}/yr available in SRS tax relief`,
      body: `Voluntary SRS contributions reduce your IRAS chargeable income dollar-for-dollar at your ${formatPercent(calc.marginalRate, 1)} marginal bracket.`,
    });
  }

  // Fallback marginal rate insight if fewer than 2 insights
  if (insights.length < 2 && calc.grossIncome > 0) {
    insights.push({
      tone: 'info',
      badge: 'Marginal vs Effective',
      title: `You keep ${formatPercent(1 - calc.effectiveTaxRate, 1)} overall, and ${formatPercent(1 - calc.marginalRate, 1)} of your next raise`,
      body: `Effective total tax & levy rate is ${formatPercent(calc.effectiveTaxRate, 1)}, while additional income is taxed at your top marginal rate of ${formatPercent(calc.marginalRate, 1)}.`,
    });
  }

  return insights.slice(0, 4);
}
