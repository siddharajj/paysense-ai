/**
 * Dynamic Country-Aware & Mode-Aware Form Renderer.
 * Renders cleanly on structural changes (country/mode/AI parse) so typing
 * in numeric fields never loses focus.
 */

import { COUNTRIES, COUNTRY_LIST } from '../tax/countries.js';
import { US_STATES } from '../tax/us.js';
import { CA_PROVINCES } from '../tax/ca.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderCalculatorForm(container, state) {
  const country = COUNTRIES[state.country] || COUNTRIES.AU;
  const opts = state.countryOptions[state.country] || {};
  const isContractor = state.mode === 'contractor';

  const periodOptions = isContractor
    ? [
        { val: 'daily', label: 'Per Day' },
        { val: 'hourly', label: 'Per Hour' },
        { val: 'weekly', label: 'Per Week' },
        { val: 'monthly', label: 'Per Month' },
        { val: 'annual', label: 'Per Year' },
      ]
    : [
        { val: 'annual', label: 'Per Year' },
        { val: 'monthly', label: 'Per Month' },
        { val: 'fortnightly', label: 'Per Fortnight' },
        { val: 'weekly', label: 'Per Week' },
        { val: 'hourly', label: 'Per Hour' },
      ];

  container.innerHTML = `
    <div class="form-card">
      <div class="form-section">
        <div class="section-header-row">
          <label class="field-label" for="country-select">Country & Tax Year</label>
          <span class="tax-year-pill">${escapeHtml(country.taxYear)}</span>
        </div>
        <div class="country-pills" role="radiogroup" aria-label="Select country">
          ${COUNTRY_LIST.map(
            (c) => `
            <button type="button" class="country-pill ${c.code === state.country ? 'active' : ''}" data-country="${c.code}" title="${escapeHtml(c.name)} (${escapeHtml(c.currency)})">
              <span class="pill-flag">${c.flag}</span>
              <span class="pill-code">${c.code}</span>
            </button>
          `
          ).join('')}
        </div>
      </div>

      <div class="form-section">
        <label class="field-label">Work Arrangement</label>
        <div class="segmented-control" role="tablist">
          <button type="button" class="seg-btn ${!isContractor ? 'active' : ''}" data-mode="employee" role="tab" aria-selected="${!isContractor}">
            <span class="seg-icon">💼</span> Full-Time / Employee
          </button>
          <button type="button" class="seg-btn ${isContractor ? 'active' : ''}" data-mode="contractor" role="tab" aria-selected="${isContractor}">
            <span class="seg-icon">🛠</span> Contractor / Freelance
          </button>
        </div>
      </div>

      <div class="form-section">
        <div class="section-header-row">
          <label class="field-label" for="amount-input">${isContractor ? 'Contracting Rate' : 'Base Salary / Pay'}</label>
          <button type="button" class="text-action-btn ${state.reverseGoalActive ? 'active' : ''}" id="toggle-reverse-btn">
            ${state.reverseGoalActive ? '← Back to Gross Input' : '🎯 Solve from Target Net'}
          </button>
        </div>

        ${
          state.reverseGoalActive
            ? `
          <div class="reverse-goal-box">
            <div class="reverse-goal-hint">Enter the take-home pay you want — we’ll calculate the exact ${isContractor ? 'rate' : 'gross salary'} needed.</div>
            <div class="input-combo">
              <span class="input-prefix">${escapeHtml(country.symbol)}</span>
              <input type="number" id="target-net-input" class="num-input" min="0" step="100" value="${state.targetNetDisplay}" />
              <select id="target-net-period" class="combo-select">
                <option value="monthly" ${state.targetNetPeriod === 'monthly' ? 'selected' : ''}>/ month net</option>
                <option value="annual" ${state.targetNetPeriod === 'annual' ? 'selected' : ''}>/ year net</option>
                <option value="fortnightly" ${state.targetNetPeriod === 'fortnightly' ? 'selected' : ''}>/ fortnight net</option>
                <option value="weekly" ${state.targetNetPeriod === 'weekly' ? 'selected' : ''}>/ week net</option>
              </select>
            </div>
            <button type="button" class="btn-primary btn-sm full-width" id="apply-reverse-btn">Calculate Required ${isContractor ? 'Rate' : 'Gross Salary'}</button>
          </div>
        `
            : `
          <div class="input-combo">
            <span class="input-prefix">${escapeHtml(country.symbol)}</span>
            <input type="number" id="amount-input" class="num-input" min="0" step="${isContractor ? '25' : '1000'}" value="${state.amount}" placeholder="0" />
            <select id="rate-period-select" class="combo-select" aria-label="Pay frequency">
              ${periodOptions
                .map((p) => `<option value="${p.val}" ${state.ratePeriod === p.val ? 'selected' : ''}>${p.label}</option>`)
                .join('')}
            </select>
          </div>
        `
        }

        ${
          isContractor
            ? `
          <div class="two-col-fields">
            <div class="sub-field">
              <div class="slider-label-row">
                <label class="sub-label" for="billable-days-input">Billable Days / Yr</label>
                <span class="slider-val" id="billable-days-val">${state.billableDays}d</span>
              </div>
              <input type="range" id="billable-days-slider" class="range-slider" min="50" max="260" step="5" value="${state.billableDays}" />
              <div class="field-hint">260 weekdays − leave/holidays ≈ 220</div>
            </div>
            <div class="sub-field">
              <label class="sub-label" for="expenses-input">Annual Business Expenses</label>
              <div class="input-combo compact">
                <span class="input-prefix">${escapeHtml(country.symbol)}</span>
                <input type="number" id="expenses-input" class="num-input" min="0" step="500" value="${state.businessExpenses}" />
              </div>
              <div class="field-hint">Laptop, software, insurance, accounting</div>
            </div>
          </div>
          ${
            state.ratePeriod === 'hourly'
              ? `
            <div class="sub-field mt-sm">
              <label class="sub-label" for="hours-day-input">Billable Hours / Day</label>
              <input type="number" id="hours-day-input" class="text-input" min="1" max="16" step="0.5" value="${state.hoursPerDay}" />
            </div>
          `
              : ''
          }
        `
            : `
          <div class="two-col-fields">
            <div class="sub-field">
              <label class="sub-label" for="bonus-input">Annual Bonus / Variable</label>
              <div class="input-combo compact">
                <span class="input-prefix">${escapeHtml(country.symbol)}</span>
                <input type="number" id="bonus-input" class="num-input" min="0" step="1000" value="${state.bonus}" />
              </div>
            </div>
            <div class="sub-field">
              <label class="sub-label" for="hours-week-input">Hours / Week</label>
              <input type="number" id="hours-week-input" class="text-input" min="1" max="80" step="0.5" value="${state.hoursPerWeek}" />
            </div>
          </div>
        `
        }
      </div>

      <div class="form-section">
        <div class="section-header-row">
          <label class="field-label">${escapeHtml(country.name)} Tax Settings</label>
        </div>
        <div class="country-specific-fields">
          ${renderCountryOptionsHtml(state.country, opts, isContractor, country)}
        </div>
      </div>

      <div class="form-section compare-offer-section">
        <div class="section-header-row">
          <label class="field-label" for="compare-input">
            ${isContractor ? '⚖️ Compare vs Permanent Offer' : '⚖️ Compare vs Contractor Day Rate'}
          </label>
          <span class="field-optional">Optional</span>
        </div>
        <div class="input-combo compact">
          <span class="input-prefix">${escapeHtml(country.symbol)}</span>
          <input
            type="number"
            id="compare-input"
            class="num-input"
            min="0"
            step="${isContractor ? '5000' : '25'}"
            value="${isContractor ? state.compareSalary || '' : state.compareDayRate || ''}"
            placeholder="${isContractor ? 'e.g. 165000 base + super' : 'e.g. 900 / day'}"
          />
          <span class="input-suffix">${isContractor ? '/ yr FTE' : '/ day'}</span>
        </div>
      </div>

      <div class="form-footnote">${escapeHtml(country.notes)}</div>
    </div>
  `;
}

function renderCountryOptionsHtml(code, opts, isContractor, country) {
  switch (code) {
    case 'AU':
      return `
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="opt-residency">Residency</label>
            <select id="opt-residency" class="select-input" data-opt="residency">
              <option value="resident" ${opts.residency === 'resident' ? 'selected' : ''}>AU Tax Resident</option>
              <option value="non-resident" ${opts.residency === 'non-resident' ? 'selected' : ''}>Foreign Resident</option>
              <option value="whm" ${opts.residency === 'whm' ? 'selected' : ''}>Working Holiday</option>
            </select>
          </div>
          <div class="sub-field">
            <label class="sub-label" for="opt-superRate">Superannuation (%)</label>
            <input type="number" id="opt-superRate" class="text-input" data-opt="superRate" data-type="number" min="0" max="40" step="0.5" value="${opts.superRate}" />
          </div>
        </div>
        <div class="sub-field">
          <label class="sub-label" for="opt-salarySacrifice">${isContractor ? 'Personal Deductible Super ($/yr)' : 'Pre-Tax Salary Sacrifice ($/yr)'}</label>
          <div class="input-combo compact">
            <span class="input-prefix">$</span>
            <input type="number" id="opt-salarySacrifice" class="num-input" data-opt="salarySacrifice" data-type="number" min="0" step="1000" value="${opts.salarySacrifice}" />
          </div>
        </div>
        <div class="toggle-grid">
          <label class="toggle-row">
            <input type="checkbox" data-opt="includesSuper" data-type="boolean" ${opts.includesSuper ? 'checked' : ''} />
            <span>${isContractor ? 'Rate Includes Super' : 'Salary Includes Super (Package)'}</span>
          </label>
          <label class="toggle-row">
            <input type="checkbox" data-opt="hasHecs" data-type="boolean" ${opts.hasHecs ? 'checked' : ''} />
            <span>HECS-HELP / Study Loan</span>
          </label>
          <label class="toggle-row">
            <input type="checkbox" data-opt="hasPrivateHealth" data-type="boolean" ${opts.hasPrivateHealth ? 'checked' : ''} />
            <span>Private Hospital Cover (avoids MLS)</span>
          </label>
          ${
            isContractor
              ? `
            <label class="toggle-row">
              <input type="checkbox" data-opt="gstRegistered" data-type="boolean" ${opts.gstRegistered ? 'checked' : ''} />
              <span>GST Registered (add 10% on invoice)</span>
            </label>`
              : ''
          }
        </div>
      `;

    case 'US':
      return `
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="opt-state">State</label>
            <select id="opt-state" class="select-input" data-opt="state">
              ${Object.entries(US_STATES)
                .map(([k, v]) => `<option value="${k}" ${opts.state === k ? 'selected' : ''}>${escapeHtml(v.name)}</option>`)
                .join('')}
            </select>
          </div>
          <div class="sub-field">
            <label class="sub-label" for="opt-filingStatus">Filing Status</label>
            <select id="opt-filingStatus" class="select-input" data-opt="filingStatus">
              <option value="single" ${opts.filingStatus === 'single' ? 'selected' : ''}>Single</option>
              <option value="married" ${opts.filingStatus === 'married' ? 'selected' : ''}>Married Joint</option>
              <option value="hoh" ${opts.filingStatus === 'hoh' ? 'selected' : ''}>Head of Household</option>
            </select>
          </div>
        </div>
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="opt-retirementPct">${isContractor ? 'Solo 401(k) (%)' : '401(k) Contribution (%)'}</label>
            <input type="number" id="opt-retirementPct" class="text-input" data-opt="retirementPct" data-type="number" min="0" max="50" step="1" value="${opts.retirementPct}" />
          </div>
          <div class="sub-field">
            <label class="sub-label" for="opt-hsaAnnual">Pre-Tax HSA / Health ($/yr)</label>
            <input type="number" id="opt-hsaAnnual" class="text-input" data-opt="hsaAnnual" data-type="number" min="0" step="250" value="${opts.hsaAnnual}" />
          </div>
        </div>
        ${
          isContractor
            ? `
          <div class="toggle-grid">
            <label class="toggle-row">
              <input type="checkbox" data-opt="useQbiDeduction" data-type="boolean" ${opts.useQbiDeduction ? 'checked' : ''} />
              <span>Claim 20% QBI Deduction (Section 199A)</span>
            </label>
          </div>`
            : `
          <div class="sub-field">
            <label class="sub-label" for="opt-employerMatchPct">Employer 401(k) Match (%)</label>
            <input type="number" id="opt-employerMatchPct" class="text-input" data-opt="employerMatchPct" data-type="number" min="0" max="20" step="0.5" value="${opts.employerMatchPct}" />
          </div>`
        }
      `;

    case 'UK':
      return `
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="opt-region">Tax Region</label>
            <select id="opt-region" class="select-input" data-opt="region">
              <option value="england" ${opts.region === 'england' ? 'selected' : ''}>England / Wales / NI</option>
              <option value="scotland" ${opts.region === 'scotland' ? 'selected' : ''}>Scotland</option>
            </select>
          </div>
          <div class="sub-field">
            <label class="sub-label" for="opt-studentLoan">Student Loan</label>
            <select id="opt-studentLoan" class="select-input" data-opt="studentLoan">
              <option value="none" ${opts.studentLoan === 'none' ? 'selected' : ''}>None</option>
              <option value="plan1" ${opts.studentLoan === 'plan1' ? 'selected' : ''}>Plan 1</option>
              <option value="plan2" ${opts.studentLoan === 'plan2' ? 'selected' : ''}>Plan 2</option>
              <option value="plan4" ${opts.studentLoan === 'plan4' ? 'selected' : ''}>Plan 4 (Scotland)</option>
              <option value="plan5" ${opts.studentLoan === 'plan5' ? 'selected' : ''}>Plan 5</option>
              <option value="postgrad" ${opts.studentLoan === 'postgrad' ? 'selected' : ''}>Postgraduate</option>
            </select>
          </div>
        </div>
        ${
          isContractor
            ? `
          <div class="sub-field">
            <label class="sub-label" for="opt-contractorType">Contractor Structure</label>
            <select id="opt-contractorType" class="select-input" data-opt="contractorType">
              <option value="sole-trader" ${opts.contractorType === 'sole-trader' ? 'selected' : ''}>Sole Trader / Self-Employed</option>
              <option value="outside-ir35" ${opts.contractorType === 'outside-ir35' ? 'selected' : ''}>Outside IR35 (Ltd Co · Salary + Divs)</option>
              <option value="inside-ir35" ${opts.contractorType === 'inside-ir35' ? 'selected' : ''}>Inside IR35 (PAYE Equivalent)</option>
            </select>
          </div>`
            : ''
        }
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="opt-pensionPct">Pension Contribution (%)</label>
            <input type="number" id="opt-pensionPct" class="text-input" data-opt="pensionPct" data-type="number" min="0" max="60" step="1" value="${opts.pensionPct}" />
          </div>
          ${
            !isContractor
              ? `
            <div class="sub-field">
              <label class="sub-label" for="opt-employerPensionPct">Employer Pension (%)</label>
              <input type="number" id="opt-employerPensionPct" class="text-input" data-opt="employerPensionPct" data-type="number" min="0" max="25" step="0.5" value="${opts.employerPensionPct}" />
            </div>`
              : `
            <div class="sub-field flex-end">
              <label class="toggle-row">
                <input type="checkbox" data-opt="vatRegistered" data-type="boolean" ${opts.vatRegistered ? 'checked' : ''} />
                <span>VAT Registered (20%)</span>
              </label>
            </div>`
          }
        </div>
      `;

    case 'CA':
      return `
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="opt-province">Province</label>
            <select id="opt-province" class="select-input" data-opt="province">
              ${Object.entries(CA_PROVINCES)
                .map(([k, v]) => `<option value="${k}" ${opts.province === k ? 'selected' : ''}>${escapeHtml(v.name)}</option>`)
                .join('')}
            </select>
          </div>
          <div class="sub-field">
            <label class="sub-label" for="opt-rrspAnnual">Annual RRSP ($)</label>
            <input type="number" id="opt-rrspAnnual" class="text-input" data-opt="rrspAnnual" data-type="number" min="0" step="1000" value="${opts.rrspAnnual}" />
          </div>
        </div>
        ${
          isContractor
            ? `
          <div class="toggle-grid">
            <label class="toggle-row">
              <input type="checkbox" data-opt="gstHstRegistered" data-type="boolean" ${opts.gstHstRegistered ? 'checked' : ''} />
              <span>GST/HST Registered (> $30k threshold)</span>
            </label>
          </div>`
            : ''
        }
      `;

    case 'IN':
      return `
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="opt-regime">Tax Regime</label>
            <select id="opt-regime" class="select-input" data-opt="regime">
              <option value="new" ${opts.regime === 'new' ? 'selected' : ''}>New Regime (FY25–26 · ₹12L Rebate)</option>
              <option value="old" ${opts.regime === 'old' ? 'selected' : ''}>Old Regime (80C/HRA)</option>
            </select>
          </div>
          ${
            isContractor
              ? `
            <div class="sub-field">
              <label class="sub-label" for="opt-gstType">GST Invoicing</label>
              <select id="opt-gstType" class="select-input" data-opt="gstType">
                <option value="export" ${opts.gstType === 'export' ? 'selected' : ''}>Export LUT (0% GST)</option>
                <option value="domestic" ${opts.gstType === 'domestic' ? 'selected' : ''}>Domestic Client (18% GST)</option>
                <option value="none" ${opts.gstType === 'none' ? 'selected' : ''}>Not Registered (&lt; ₹20L)</option>
              </select>
            </div>`
              : `
            <div class="sub-field">
              <label class="sub-label" for="opt-epfAnnual">Employee EPF (₹/yr)</label>
              <input type="number" id="opt-epfAnnual" class="text-input" data-opt="epfAnnual" data-type="number" min="0" step="1200" value="${opts.epfAnnual}" />
            </div>`
          }
        </div>
        ${
          opts.regime === 'old'
            ? `
          <div class="sub-field">
            <label class="sub-label" for="opt-oldRegimeDeductions">80C / 80D / HRA Deductions (₹/yr)</label>
            <input type="number" id="opt-oldRegimeDeductions" class="text-input" data-opt="oldRegimeDeductions" data-type="number" min="0" step="10000" value="${opts.oldRegimeDeductions}" />
          </div>`
            : ''
        }
        ${
          isContractor
            ? `
          <div class="toggle-grid">
            <label class="toggle-row">
              <input type="checkbox" data-opt="use44ADA" data-type="boolean" ${opts.use44ADA ? 'checked' : ''} />
              <span>Section 44ADA (50% Presumptive Profit up to ₹75L)</span>
            </label>
          </div>`
            : ''
        }
      `;

    case 'NZ':
      return `
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="opt-kiwisaverPct">KiwiSaver (%)</label>
            <select id="opt-kiwisaverPct" class="select-input" data-opt="kiwisaverPct" data-type="number">
              ${[0, 3, 4, 6, 8, 10]
                .map((r) => `<option value="${r}" ${Number(opts.kiwisaverPct) === r ? 'selected' : ''}>${r}%</option>`)
                .join('')}
            </select>
          </div>
          <div class="sub-field flex-end">
            <label class="toggle-row">
              <input type="checkbox" data-opt="hasStudentLoan" data-type="boolean" ${opts.hasStudentLoan ? 'checked' : ''} />
              <span>Student Loan (12%)</span>
            </label>
          </div>
        </div>
        ${
          isContractor
            ? `
          <div class="toggle-grid">
            <label class="toggle-row">
              <input type="checkbox" data-opt="gstRegistered" data-type="boolean" ${opts.gstRegistered ? 'checked' : ''} />
              <span>GST Registered (15% on invoices)</span>
            </label>
          </div>`
            : ''
        }
      `;

    case 'SG':
      return `
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="opt-residency">Residency / CPF</label>
            <select id="opt-residency" class="select-input" data-opt="residency">
              <option value="citizen-pr" ${opts.residency === 'citizen-pr' ? 'selected' : ''}>Citizen / PR (with CPF)</option>
              <option value="expat-ep" ${opts.residency === 'expat-ep' ? 'selected' : ''}>Expat / EP (No CPF)</option>
            </select>
          </div>
          <div class="sub-field">
            <label class="sub-label" for="opt-srsContribution">SRS Relief (S$/yr)</label>
            <input type="number" id="opt-srsContribution" class="text-input" data-opt="srsContribution" data-type="number" min="0" step="1000" value="${opts.srsContribution}" />
          </div>
        </div>
        ${
          isContractor
            ? `
          <div class="toggle-grid">
            <label class="toggle-row">
              <input type="checkbox" data-opt="gstRegistered" data-type="boolean" ${opts.gstRegistered ? 'checked' : ''} />
              <span>GST Registered (9%)</span>
            </label>
          </div>`
            : ''
        }
      `;

    default:
      return '';
  }
}
