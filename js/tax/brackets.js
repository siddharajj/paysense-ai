/**
 * Progressive tax bracket computation & currency formatting utilities.
 */

export function calculateProgressiveTax(taxableIncome, brackets) {
  const income = Math.max(0, taxableIncome);
  let totalTax = 0;
  let marginalRate = brackets.length ? brackets[0].rate : 0;
  const breakdown = [];

  for (const bracket of brackets) {
    const min = bracket.min;
    const max = bracket.max ?? Infinity;
    if (income > min) {
      const taxableInBracket = Math.min(income, max) - min;
      const taxInBracket = taxableInBracket * bracket.rate;
      totalTax += taxInBracket;
      marginalRate = bracket.rate;
      breakdown.push({
        label: bracket.label || formatBracketRange(min, max),
        min,
        max,
        rate: bracket.rate,
        taxableAmount: taxableInBracket,
        tax: taxInBracket,
      });
    } else {
      breakdown.push({
        label: bracket.label || formatBracketRange(min, max),
        min,
        max,
        rate: bracket.rate,
        taxableAmount: 0,
        tax: 0,
      });
    }
  }

  return { totalTax, marginalRate, breakdown };
}

function formatBracketRange(min, max) {
  const fmt = (n) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
    return `${n}`;
  };
  if (!Number.isFinite(max)) return `${fmt(min)}+`;
  return `${fmt(min)}–${fmt(max)}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatCurrency(amount, currencyCode = 'AUD', locale = 'en-AU', compact = false) {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  try {
    if (compact && Math.abs(safeAmount) >= 100_000) {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode,
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(safeAmount);
    }
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: Math.abs(safeAmount) < 1000 && Math.abs(safeAmount % 1) > 0.005 ? 2 : 0,
      maximumFractionDigits: Math.abs(safeAmount) < 1000 ? 2 : 0,
    }).format(safeAmount);
  } catch {
    return `${currencyCode} ${Math.round(safeAmount).toLocaleString()}`;
  }
}

export function formatPercent(ratio, decimals = 1) {
  const safe = Number.isFinite(ratio) ? ratio : 0;
  return `${(safe * 100).toFixed(decimals)}%`;
}
