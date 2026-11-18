/**
 * Zero-cost client-side Natural Language Parser & Conversational "What-If" Engine.
 * Turns plain English prompts (both full scenarios and incremental edits) into
 * structured calculator updates with transparent parsed chips.
 */

import { COUNTRIES } from '../tax/countries.js';
import { formatCurrency } from '../tax/brackets.js';

function parseMoneyValue(rawNum, suffix = '') {
  const clean = Number(String(rawNum).replace(/,/g, ''));
  if (!Number.isFinite(clean)) return null;
  const s = (suffix || '').toLowerCase();
  if (s === 'k') return clean * 1_000;
  if (s === 'l' || s === 'lac' || s === 'lakh' || s === 'lakhs' || s === 'lpa') return clean * 100_000;
  if (s === 'cr' || s === 'crore' || s === 'crores') return clean * 10_000_000;
  if (s === 'm' || s === 'mil' || s === 'million') return clean * 1_000_000;
  return clean;
}

const COUNTRY_PATTERNS = [
  { code: 'AU', re: /\b(australia|australian|aussie|aud|au|sydney|melbourne|brisbane|perth|adelaide|ato|hecs|superannuation)\b/i },
  { code: 'US', re: /\b(united states|usa|us|usd|america|american|401k|401\(k\)|1099|w2|w-2|california|texas|new york|nyc|florida|seattle|washington|illinois|massachusetts|colorado|san francisco|austin|chicago|boston)\b/i },
  { code: 'UK', re: /\b(united kingdom|uk|gbp|britain|british|london|manchester|edinburgh|scotland|hmrc|ir35|£|pounds?)\b/i },
  { code: 'CA', re: /\b(canada|canadian|cad|toronto|vancouver|montreal|calgary|ontario|british columbia|alberta|quebec|rrsp|cra)\b/i },
  { code: 'IN', re: /\b(india|indian|inr|₹|rupees?|lpa|lakhs?|lacs?|crores?|bengaluru|bangalore|mumbai|delhi|hyderabad|pune|44ada|epf|new regime|old regime)\b/i },
  { code: 'NZ', re: /\b(new zealand|nz|nzd|kiwi|kiwisaver|auckland|wellington|christchurch|ird|acc)\b/i },
  { code: 'SG', re: /\b(singapore|sg|sgd|s\$|cpf|iras|srs)\b/i },
];

const US_STATE_PATTERNS = [
  ['NYC', /\b(nyc|new york city|manhattan|brooklyn)\b/i],
  ['NY', /\b(new york|\bny\b)\b/i],
  ['CA', /\b(california|\bca\b|san francisco|bay area|silicon valley|los angeles|san diego)\b/i],
  ['TX', /\b(texas|\btx\b|austin|dallas|houston)\b/i],
  ['FL', /\b(florida|\bfl\b|miami|tampa|orlando)\b/i],
  ['WA', /\b(washington|\bwa\b|seattle|bellevue)\b/i],
  ['IL', /\b(illinois|\bil\b|chicago)\b/i],
  ['MA', /\b(massachusetts|\bma\b|boston|cambridge)\b/i],
  ['CO', /\b(colorado|\bco\b|denver|boulder)\b/i],
  ['NV', /\b(nevada|\bnv\b|las vegas)\b/i],
  ['NC', /\b(north carolina|\bnc\b|charlotte|raleigh)\b/i],
  ['PA', /\b(pennsylvania|\bpa\b|philadelphia|pittsburgh)\b/i],
  ['GA', /\b(georgia|\bga\b|atlanta)\b/i],
  ['VA', /\b(virginia|\bva\b)\b/i],
  ['NJ', /\b(new jersey|\bnj\b)\b/i],
  ['AZ', /\b(arizona|\baz\b|phoenix)\b/i],
  ['OR', /\b(oregon|\bor\b|portland)\b/i],
];

const CA_PROV_PATTERNS = [
  ['ON', /\b(ontario|\bon\b|toronto|ottawa)\b/i],
  ['BC', /\b(british columbia|\bbc\b|vancouver|victoria)\b/i],
  ['AB', /\b(alberta|\bab\b|calgary|edmonton)\b/i],
  ['QC', /\b(quebec|\bqc\b|montreal|montréal)\b/i],
  ['MB', /\b(manitoba|\bmb\b|winnipeg)\b/i],
  ['NS', /\b(nova scotia|\bns\b|halifax)\b/i],
];

/**
 * Parses a natural language string relative to the current calculator state.
 */
export function parseNaturalLanguage(rawText, currentState) {
  const text = (rawText || '').trim();
  if (!text) return null;

  const patch = {};
  const countryOptionPatch = {};
  const tags = [];
  let targetNetAnnual = null;
  let actionType = 'update';

  // 1. Detect Country (explicit mention or currency symbol)
  let detectedCountry = null;
  for (const { code, re } of COUNTRY_PATTERNS) {
    if (re.test(text)) {
      detectedCountry = code;
      break;
    }
  }
  const activeCountry = detectedCountry || currentState.country || 'AU';
  if (detectedCountry && detectedCountry !== currentState.country) {
    patch.country = detectedCountry;
    tags.push({ label: `${COUNTRIES[detectedCountry].flag} ${COUNTRIES[detectedCountry].name}`, kind: 'country' });
  } else if (detectedCountry) {
    tags.push({ label: `${COUNTRIES[detectedCountry].flag} ${COUNTRIES[detectedCountry].name}`, kind: 'country' });
  }

  // 2. Detect Reverse Goal Mode ("take home $10k/month", "net £5000 a month", "earn to clear $120k")
  const reverseRe = /(?:take[- ]?home|net|clear|pocket|keep)\s*(?:of\s*)?(?:[$£₹]|s\$|aud|usd|gbp|cad|inr|nzd|sgd)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lac|lakh|lakhs|lpa|cr)?\s*(?:(?:per|a|\/)\s*(year|yr|annum|month|mo|fortnight|fn|week|wk|day))?/i;
  const reverseMatch = text.match(reverseRe);
  if (reverseMatch && /\b(need|earn|make|how much|target|goal|want|to take|to net|to clear|to pocket)\b/i.test(text)) {
    const val = parseMoneyValue(reverseMatch[1], reverseMatch[2]);
    const period = (reverseMatch[3] || (val < 25000 && activeCountry !== 'IN' ? 'month' : 'year')).toLowerCase();
    if (val && val > 0) {
      let mult = 1;
      if (period.startsWith('mo')) mult = 12;
      else if (period.startsWith('fn') || period.startsWith('fort')) mult = 26;
      else if (period.startsWith('w')) mult = 52;
      else if (period.startsWith('d')) mult = 220;
      targetNetAnnual = val * mult;
      actionType = 'reverse-goal';
      const c = COUNTRIES[activeCountry];
      tags.push({
        label: `🎯 Target Net: ${formatCurrency(val, c.currency, c.locale)}/${period.startsWith('mo') ? 'mo' : period.startsWith('w') ? 'wk' : 'yr'}`,
        kind: 'goal',
      });
    }
  }

  // 3. Detect "What if I get a X% raise / cut?"
  const raiseRe = /\b(\d+(?:\.\d+)?)\s*%\s*(raise|increase|bump|more|pay rise|hike|cut|less|drop|reduction)\b|\b(raise|increase|bump|hike|cut|drop)\s*(?:by|of)?\s*(\d+(?:\.\d+)?)\s*%/i;
  const raiseMatch = text.match(raiseRe);
  if (raiseMatch && !targetNetAnnual) {
    const pct = Number(raiseMatch[1] || raiseMatch[4]);
    const word = (raiseMatch[2] || raiseMatch[3] || '').toLowerCase();
    const isCut = /cut|less|drop|reduc/.test(word);
    if (Number.isFinite(pct) && pct > 0 && pct <= 200) {
      const factor = isCut ? 1 - pct / 100 : 1 + pct / 100;
      patch.amount = Math.round(currentState.amount * factor);
      tags.push({ label: `${isCut ? '📉 -' : '📈 +'}${pct}% Pay Change`, kind: 'income' });
    }
  }

  // 4. Detect Comparison clause ("compare with $165k FTE", "vs $900/day contractor", "vs 28L salary")
  let mainClause = text;
  let compareClause = '';
  const vsSplit = text.split(/\b(?:compare(?:\s+with|\s+to|\s+against)?|versus|vs\.?)\b/i);
  if (vsSplit.length >= 2) {
    mainClause = vsSplit[0];
    compareClause = vsSplit.slice(1).join(' ');
  }

  // 5. Detect Work Mode in main clause
  const mentionsContractor = /\b(contractor|contracting|freelance|freelancer|consultant|1099|sole trader|abn|ir35|44ada|day[- ]?rate|daily rate|\/\s*day|per day|a day|\/\s*hr|\/\s*hour|per hour|hourly)\b/i.test(mainClause);
  const mentionsEmployee = /\b(fte|full[- ]?time|permanent|perm|salaried|salary|employee|w-?2|payg|paye)\b/i.test(mainClause);

  let resolvedMode = currentState.mode;
  if (mentionsContractor && !mentionsEmployee) {
    resolvedMode = 'contractor';
    patch.mode = 'contractor';
    tags.push({ label: '🛠 Contractor', kind: 'mode' });
  } else if (mentionsEmployee && !mentionsContractor) {
    resolvedMode = 'employee';
    patch.mode = 'employee';
    tags.push({ label: '💼 Full-Time (FTE)', kind: 'mode' });
  } else if (mentionsContractor && mentionsEmployee) {
    // If main clause has both (e.g. "contractor $950/day"), day/hour rate wins
    if (/\/day|per day|day[- ]?rate|\/hr|\/hour|per hour|contractor|freelanc|1099|44ada/i.test(mainClause)) {
      resolvedMode = 'contractor';
      patch.mode = 'contractor';
      tags.push({ label: '🛠 Contractor', kind: 'mode' });
    }
  }

  // 6. Extract Billable Days ("220 days", "drop to 200 days")
  const daysMatch = text.match(/\b(\d{2,3})\s*(?:billable\s+|working\s+|work\s+)?days?\b/i);
  if (daysMatch) {
    const days = Number(daysMatch[1]);
    if (days >= 20 && days <= 365) {
      patch.billableDays = days;
      tags.push({ label: `📅 ${days} billable days/yr`, kind: 'option' });
    }
  }

  // 7. Extract Business Expenses ("$8k expenses", "12000 deductions", "add $5k business expenses")
  const expMatch = text.match(/(?:expenses?|deductions?|write[- ]?offs?)\s*(?:of\s*)?(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|l|lac|lakh)?|(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|l|lac|lakh)?\s*(?:in\s+)?(?:business\s+)?(?:expenses?|deductions?|write[- ]?offs?)/i);
  if (expMatch) {
    const val = parseMoneyValue(expMatch[1] || expMatch[3], expMatch[2] || expMatch[4]);
    if (val !== null && val >= 0) {
      patch.businessExpenses = val;
      const c = COUNTRIES[activeCountry];
      tags.push({ label: `🧾 ${formatCurrency(val, c.currency, c.locale)} expenses`, kind: 'option' });
    }
  }

  // 8. Extract Primary Income Amount + Period from mainClause (if not reverse goal / raise)
  if (!targetNetAnnual && !raiseMatch) {
    // Strip already-matched expense phrases so we don't mistake expenses for salary
    const cleanedMain = mainClause
      .replace(/(?:[$£₹]|s\$)?\s*[\d,]+(?:\.\d+)?\s*(?:k|l|lac|lakh)?\s*(?:in\s+)?(?:business\s+)?(?:expenses?|deductions?|write[- ]?offs?)/gi, '')
      .replace(/(?:salary\s+sacrifice|sacrifice|rrsp|srs|hsa|401k|401\(k\))\s*(?:of\s*)?(?:[$£₹]|s\$)?\s*[\d,]+(?:\.\d+)?\s*(?:k|l|lac|lakh|%)?/gi, '')
      .replace(/(?:[$£₹]|s\$)?\s*[\d,]+(?:\.\d+)?\s*(?:k|l|lac|lakh)?\s*(?:salary\s+sacrifice|rrsp|srs|hsa)/gi, '');

    // Pattern A: Explicit rate with period ($950/day, £550 per day, $110/hr, $10k/month, $145k/yr)
    const rateMatch = cleanedMain.match(/(?:[$£₹]|s\$|aud|usd|gbp|cad|inr|nzd|sgd)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lac|lakh|lakhs|lpa|cr)?\s*(?:\/\s*|per\s+|a\s+)(hr|hour|day|daily|wk|week|fortnight|fn|mo|month|yr|year|annum)/i);
    // Pattern B: Money with currency or k/L/M suffix ($145k, £80k, ₹30L, 24 LPA, 165000)
    const moneyMatch = cleanedMain.match(/(?:[$£₹]|s\$)\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lac|lakh|lakhs|lpa|cr)?|\b([\d,]+(?:\.\d+)?)\s*(k|m|l|lac|lakh|lakhs|lpa|cr)\b/i);

    const c = COUNTRIES[activeCountry];
    if (rateMatch) {
      const val = parseMoneyValue(rateMatch[1], rateMatch[2]);
      const p = rateMatch[3].toLowerCase();
      if (val && val > 0) {
        patch.amount = val;
        if (p.startsWith('h')) {
          patch.ratePeriod = 'hourly';
          if (!mentionsEmployee) {
            patch.mode = 'contractor';
            resolvedMode = 'contractor';
          }
          tags.push({ label: `💵 ${formatCurrency(val, c.currency, c.locale)}/hr`, kind: 'income' });
        } else if (p.startsWith('d')) {
          patch.ratePeriod = 'daily';
          patch.mode = 'contractor';
          resolvedMode = 'contractor';
          tags.push({ label: `💵 ${formatCurrency(val, c.currency, c.locale)}/day`, kind: 'income' });
        } else if (p.startsWith('w')) {
          patch.ratePeriod = 'weekly';
          tags.push({ label: `💵 ${formatCurrency(val, c.currency, c.locale)}/wk`, kind: 'income' });
        } else if (p.startsWith('f')) {
          patch.ratePeriod = 'fortnightly';
          tags.push({ label: `💵 ${formatCurrency(val, c.currency, c.locale)}/fn`, kind: 'income' });
        } else if (p.startsWith('m')) {
          patch.ratePeriod = 'monthly';
          tags.push({ label: `💵 ${formatCurrency(val, c.currency, c.locale)}/mo`, kind: 'income' });
        } else {
          patch.ratePeriod = 'annual';
          tags.push({ label: `💵 ${formatCurrency(val, c.currency, c.locale)}/yr`, kind: 'income' });
        }
      }
    } else if (moneyMatch) {
      const numStr = moneyMatch[1] || moneyMatch[3];
      const sufStr = moneyMatch[2] || moneyMatch[4];
      const val = parseMoneyValue(numStr, sufStr);
      if (val && val > 0) {
        patch.amount = val;
        // Heuristic: if contractor mode & small number like $900 or £550, treat as daily; if < 250, hourly
        if (resolvedMode === 'contractor' && !sufStr && activeCountry !== 'IN' && val < 3000) {
          if (val <= 260) {
            patch.ratePeriod = 'hourly';
            tags.push({ label: `💵 ${formatCurrency(val, c.currency, c.locale)}/hr`, kind: 'income' });
          } else {
            patch.ratePeriod = 'daily';
            tags.push({ label: `💵 ${formatCurrency(val, c.currency, c.locale)}/day`, kind: 'income' });
          }
        } else {
          patch.ratePeriod = 'annual';
          tags.push({ label: `💵 ${formatCurrency(val, c.currency, c.locale)}/yr`, kind: 'income' });
        }
      }
    }
  }

  // 9. Extract Comparison Offer from compareClause
  if (compareClause) {
    const cmpRate = compareClause.match(/(?:[$£₹]|s\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|l|lac|lakh|lakhs|lpa|cr)?(?:\s*(?:\/|per|a)\s*(day|hr|hour|yr|year))?/i);
    if (cmpRate) {
      const cmpVal = parseMoneyValue(cmpRate[1], cmpRate[2]);
      const cmpPeriod = (cmpRate[3] || '').toLowerCase();
      const c = COUNTRIES[activeCountry];
      if (cmpVal && cmpVal > 0) {
        if (resolvedMode === 'contractor') {
          patch.compareSalary = cmpVal;
          tags.push({ label: `⚖️ vs ${formatCurrency(cmpVal, c.currency, c.locale)} FTE`, kind: 'compare' });
        } else {
          const dayVal = cmpPeriod.startsWith('h') ? cmpVal * c.standardHoursPerDay : cmpVal;
          patch.compareDayRate = dayVal;
          tags.push({ label: `⚖️ vs ${formatCurrency(dayVal, c.currency, c.locale)}/day`, kind: 'compare' });
        }
      }
    }
  }

  // 10. Country-Specific Options Extraction
  if (activeCountry === 'AU') {
    if (/\b(incl\.?\s*super|including\s+super|super\s+included|total\s+package|package)\b/i.test(text)) {
      countryOptionPatch.includesSuper = true;
      tags.push({ label: '📦 Incl. Super', kind: 'option' });
    } else if (/\b(\+\s*super|plus\s+super|ex\.?\s*super|excluding\s+super|excl\.?\s*super)\b/i.test(text)) {
      countryOptionPatch.includesSuper = false;
      tags.push({ label: '➕ Plus Super', kind: 'option' });
    }
    const superPctMatch = text.match(/(\d+(?:\.\d+)?)\s*%\s*super/i);
    if (superPctMatch) {
      countryOptionPatch.superRate = Number(superPctMatch[1]);
      tags.push({ label: `🏦 ${superPctMatch[1]}% Super`, kind: 'option' });
    }
    if (/\b(no\s+hecs|without\s+hecs|paid\s+off\s+hecs)\b/i.test(text)) {
      countryOptionPatch.hasHecs = false;
      tags.push({ label: '🎓 No HECS', kind: 'option' });
    } else if (/\b(hecs|help\s+debt|student\s+loan)\b/i.test(text)) {
      countryOptionPatch.hasHecs = true;
      tags.push({ label: '🎓 HECS-HELP', kind: 'option' });
    }
    if (/\b(no\s+private\s+health|without\s+private\s+health|no\s+phi|mls)\b/i.test(text)) {
      countryOptionPatch.hasPrivateHealth = false;
      tags.push({ label: '🏥 No Private Health (MLS)', kind: 'option' });
    } else if (/\b(private\s+health|with\s+phi)\b/i.test(text)) {
      countryOptionPatch.hasPrivateHealth = true;
      tags.push({ label: '🏥 Private Health Cover', kind: 'option' });
    }
    if (/\bnon[- ]?resident\b/i.test(text)) {
      countryOptionPatch.residency = 'non-resident';
      tags.push({ label: '🌍 Non-Resident', kind: 'option' });
    } else if (/\b(whm|working holiday)\b/i.test(text)) {
      countryOptionPatch.residency = 'whm';
      tags.push({ label: '🎒 Working Holiday', kind: 'option' });
    }
    const sacMatch = text.match(/(?:salary\s+)?sacrifice\s*(?:of\s*)?\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?/i);
    if (sacMatch) {
      const val = parseMoneyValue(sacMatch[1], sacMatch[2]);
      if (val !== null) {
        countryOptionPatch.salarySacrifice = val;
        tags.push({ label: `💰 $${Math.round(val).toLocaleString()} Sacrifice`, kind: 'option' });
      }
    }
  }

  if (activeCountry === 'US') {
    for (const [stCode, re] of US_STATE_PATTERNS) {
      if (re.test(text)) {
        countryOptionPatch.state = stCode;
        tags.push({ label: `📍 ${stCode}`, kind: 'option' });
        break;
      }
    }
    if (/\b(married|joint|mfj)\b/i.test(text)) {
      countryOptionPatch.filingStatus = 'married';
      tags.push({ label: '💍 Married Joint', kind: 'option' });
    } else if (/\b(head of household|hoh)\b/i.test(text)) {
      countryOptionPatch.filingStatus = 'hoh';
      tags.push({ label: '🏠 Head of Household', kind: 'option' });
    } else if (/\bsingle\b/i.test(text)) {
      countryOptionPatch.filingStatus = 'single';
      tags.push({ label: '👤 Single', kind: 'option' });
    }
    const k401Match = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:401k|401\(k\)|solo\s*401k)/i);
    if (k401Match) {
      countryOptionPatch.retirementPct = Number(k401Match[1]);
      tags.push({ label: `🏦 ${k401Match[1]}% 401(k)`, kind: 'option' });
    }
    if (/\bno\s+qbi\b/i.test(text)) {
      countryOptionPatch.useQbiDeduction = false;
    } else if (/\bqbi\b/i.test(text)) {
      countryOptionPatch.useQbiDeduction = true;
      tags.push({ label: '✨ 20% QBI Deduction', kind: 'option' });
    }
  }

  if (activeCountry === 'UK') {
    if (/\b(scotland|scottish|edinburgh|glasgow)\b/i.test(text)) {
      countryOptionPatch.region = 'scotland';
      tags.push({ label: '🏴 Scotland Tax', kind: 'option' });
    } else if (/\b(england|london|wales)\b/i.test(text)) {
      countryOptionPatch.region = 'england';
    }
    const penMatch = text.match(/(\d+(?:\.\d+)?)\s*%\s*pension/i);
    if (penMatch) {
      countryOptionPatch.pensionPct = Number(penMatch[1]);
      tags.push({ label: `🏦 ${penMatch[1]}% Pension`, kind: 'option' });
    }
    const slMatch = text.match(/\bplan\s*([1245])\b/i);
    if (slMatch) {
      countryOptionPatch.studentLoan = `plan${slMatch[1]}`;
      tags.push({ label: `🎓 Plan ${slMatch[1]} Loan`, kind: 'option' });
    } else if (/\bpostgrad(?:uate)?\s*(?:loan)?\b/i.test(text)) {
      countryOptionPatch.studentLoan = 'postgrad';
      tags.push({ label: '🎓 Postgrad Loan', kind: 'option' });
    }
    if (/\boutside\s+ir35|ltd\b/i.test(text)) {
      countryOptionPatch.contractorType = 'outside-ir35';
      tags.push({ label: '🏢 Outside IR35 (Ltd)', kind: 'option' });
    } else if (/\binside\s+ir35\b/i.test(text)) {
      countryOptionPatch.contractorType = 'inside-ir35';
      tags.push({ label: '📋 Inside IR35', kind: 'option' });
    } else if (/\bsole\s+trader\b/i.test(text)) {
      countryOptionPatch.contractorType = 'sole-trader';
      tags.push({ label: '🛠 Sole Trader', kind: 'option' });
    }
  }

  if (activeCountry === 'CA') {
    for (const [pCode, re] of CA_PROV_PATTERNS) {
      if (re.test(text)) {
        countryOptionPatch.province = pCode;
        tags.push({ label: `📍 ${pCode}`, kind: 'option' });
        break;
      }
    }
    const rrspMatch = text.match(/(?:rrsp\s*(?:of\s*)?\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?|\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?\s*rrsp)/i);
    if (rrspMatch) {
      const val = parseMoneyValue(rrspMatch[1] || rrspMatch[3], rrspMatch[2] || rrspMatch[4]);
      if (val !== null) {
        countryOptionPatch.rrspAnnual = val;
        tags.push({ label: `🏦 $${Math.round(val).toLocaleString()} RRSP`, kind: 'option' });
      }
    }
  }

  if (activeCountry === 'IN') {
    if (/\bold\s+regime\b/i.test(text)) {
      countryOptionPatch.regime = 'old';
      tags.push({ label: '📜 Old Tax Regime', kind: 'option' });
    } else if (/\bnew\s+regime\b/i.test(text)) {
      countryOptionPatch.regime = 'new';
      tags.push({ label: '✨ New Regime FY25–26', kind: 'option' });
    }
    if (/\b44ada\b/i.test(text)) {
      countryOptionPatch.use44ADA = true;
      patch.mode = 'contractor';
      tags.push({ label: '⚡ Sec 44ADA (50% Presumptive)', kind: 'option' });
    }
    if (/\bdomestic\s+gst|18%\s*gst\b/i.test(text)) {
      countryOptionPatch.gstType = 'domestic';
      tags.push({ label: '🧾 18% Domestic GST', kind: 'option' });
    } else if (/\bexport|lut|foreign\s+client\b/i.test(text)) {
      countryOptionPatch.gstType = 'export';
      tags.push({ label: '🌍 Export LUT (0% GST)', kind: 'option' });
    }
  }

  if (activeCountry === 'NZ') {
    const ksMatch = text.match(/(\d+)\s*%\s*kiwisaver/i);
    if (ksMatch) {
      countryOptionPatch.kiwisaverPct = Number(ksMatch[1]);
      tags.push({ label: `🥝 ${ksMatch[1]}% KiwiSaver`, kind: 'option' });
    }
    if (/\bstudent\s+loan\b/i.test(text)) {
      countryOptionPatch.hasStudentLoan = !/\bno\s+student\s+loan\b/i.test(text);
      tags.push({ label: countryOptionPatch.hasStudentLoan ? '🎓 Student Loan' : '🎓 No Student Loan', kind: 'option' });
    }
  }

  if (activeCountry === 'SG') {
    if (/\b(expat|foreigner|ep|employment\s+pass|no\s+cpf)\b/i.test(text)) {
      countryOptionPatch.residency = 'expat-ep';
      tags.push({ label: '✈️ Expat / EP (No CPF)', kind: 'option' });
    } else if (/\b(citizen|pr|cpf)\b/i.test(text)) {
      countryOptionPatch.residency = 'citizen-pr';
      tags.push({ label: '🇸🇬 Citizen / PR (CPF)', kind: 'option' });
    }
    const srsMatch = text.match(/(?:srs\s*(?:of\s*)?(?:s\$|\$)?\s*([\d,]+(?:\.\d+)?)\s*(k)?|(?:s\$|\$)?\s*([\d,]+(?:\.\d+)?)\s*(k)?\s*srs)/i);
    if (srsMatch) {
      const val = parseMoneyValue(srsMatch[1] || srsMatch[3], srsMatch[2] || srsMatch[4]);
      if (val !== null) {
        countryOptionPatch.srsContribution = val;
        tags.push({ label: `🏦 S$${Math.round(val).toLocaleString()} SRS`, kind: 'option' });
      }
    }
  }

  const matchedAnything =
    Object.keys(patch).length > 0 ||
    Object.keys(countryOptionPatch).length > 0 ||
    targetNetAnnual !== null;

  return {
    matched: matchedAnything,
    activeCountry,
    patch,
    countryOptionPatch,
    targetNetAnnual,
    tags,
    actionType,
    rawText: text,
  };
}
