/**
 * Section 01 — Warm, Simple, Step-by-Step Form Renderer.
 * Shows the 3 essential questions upfront and tucks advanced tax tweaks into
 * an easy expandable drawer so everyday users never feel overwhelmed.
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
    <section class="editorial-section">
      <div class="section-divider">
        <span class="section-num">01</span>
        <div class="section-divider-text">
          <h2 class="section-heading">Your Work &amp; Pay Setup</h2>
          <p class="section-sub">Choose your country, how you work, and your pay rate.</p>
        </div>
        <span class="tax-year-pill">${escapeHtml(country.name)} · ${escapeHtml(country.taxYear)}</span>
      </div>

      <div class="card setup-card">
        <!-- Step 1: Country -->
        <div class="setup-block">
          <label class="field-label">1. Where do you pay tax?</label>
          <div class="country-pills warm-country-pills" role="radiogroup" aria-label="Select country">
            ${COUNTRY_LIST.map(
              (c) => `
              <button type="button" class="country-pill ${c.code === state.country ? 'active' : ''}" data-country="${c.code}">
                <span class="pill-flag">${c.flag}</span>
                <span class="pill-name">${escapeHtml(c.name)}</span>
              </button>
            `
            ).join('')}
          </div>
        </div>

        <!-- Step 2 & 3: Work Arrangement + Pay Amount side-by-side on desktop -->
        <div class="setup-two-col">
          <div class="setup-block">
            <label class="field-label">2. How are you employed?</label>
            <div class="segmented-control" role="tablist">
              <button type="button" class="seg-btn ${!isContractor ? 'active' : ''}" data-mode="employee" role="tab" aria-selected="${!isContractor}">
                Full-Time Employee
              </button>
              <button type="button" class="seg-btn ${isContractor ? 'active' : ''}" data-mode="contractor" role="tab" aria-selected="${isContractor}">
                Contractor / Freelancer
              </button>
            </div>
            <div class="field-hint">
              ${
                isContractor
                  ? 'You invoice for your days or hours and handle your own tax & leave.'
                  : 'Your employer deducts tax for you and provides paid leave.'
              }
            </div>
          </div>

          <div class="setup-block">
            <div class="section-header-row">
              <label class="field-label" for="amount-input">
                3. ${isContractor ? 'What is your contracting rate?' : 'What is your gross pay?'}
              </label>
              <button type="button" class="text-action-btn ${state.reverseGoalActive ? 'active' : ''}" id="toggle-reverse-btn">
                ${state.reverseGoalActive ? '← Enter gross pay instead' : 'Work backwards from target take-home'}
              </button>
            </div>

            ${
              state.reverseGoalActive
                ? `
              <div class="reverse-goal-box">
                <div class="reverse-goal-hint">Enter the net take-home pay you want in your pocket — we’ll find the gross pay needed:</div>
                <div class="input-combo">
                  <span class="input-prefix">${escapeHtml(country.symbol)}</span>
                  <input type="number" id="target-net-input" class="num-input" min="0" step="100" value="${state.targetNetDisplay}" />
                  <select id="target-net-period" class="combo-select">
                    <option value="monthly" ${state.targetNetPeriod === 'monthly' ? 'selected' : ''}>/ month take-home</option>
                    <option value="annual" ${state.targetNetPeriod === 'annual' ? 'selected' : ''}>/ year take-home</option>
                    <option value="fortnightly" ${state.targetNetPeriod === 'fortnightly' ? 'selected' : ''}>/ fortnight take-home</option>
                    <option value="weekly" ${state.targetNetPeriod === 'weekly' ? 'selected' : ''}>/ week take-home</option>
                  </select>
                </div>
                <button type="button" class="btn-primary btn-sm" id="apply-reverse-btn">Find Required ${isContractor ? 'Rate' : 'Gross Salary'}</button>
              </div>
            `
                : `
              <div class="input-combo large-combo">
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
          </div>
        </div>

        ${
          isContractor
            ? `
          <div class="contractor-essentials">
            <div class="sub-field">
              <div class="slider-label-row">
                <label class="sub-label" for="billable-days-slider">Working days you’ll bill per year</label>
                <span class="slider-val" id="billable-days-val">${state.billableDays} days</span>
              </div>
              <input type="range" id="billable-days-slider" class="range-slider" min="50" max="260" step="5" value="${state.billableDays}" />
              <div class="field-hint">A full year has 260 weekdays — subtracting 4 weeks holiday, public holidays &amp; sick days leaves ~220 billable days.</div>
            </div>
            <div class="sub-field">
              <label class="sub-label" for="expenses-input">Annual business expenses (deductible)</label>
              <div class="input-combo compact">
                <span class="input-prefix">${escapeHtml(country.symbol)}</span>
                <input type="number" id="expenses-input" class="num-input" min="0" step="500" value="${state.businessExpenses}" />
              </div>
              <div class="field-hint">Equipment, software, insurance, accountant fees.</div>
            </div>
            ${
              state.ratePeriod === 'hourly'
                ? `
              <div class="sub-field">
                <label class="sub-label" for="hours-day-input">Billable hours per day</label>
                <input type="number" id="hours-day-input" class="text-input" min="1" max="16" step="0.5" value="${state.hoursPerDay}" />
              </div>
            `
                : ''
            }
          </div>
        `
            : ''
        }

        <!-- Progressive Disclosure: Optional Tax & Comparison Details -->
        <details class="optional-drawer" id="optional-tax-drawer" ${state.drawerOpen ? 'open' : ''}>
          <summary class="optional-summary">
            <span>Fine-tune ${escapeHtml(country.name)} tax details &amp; compare offers <span class="muted-normal">(Optional — sensible defaults already applied)</span></span>
            <span class="summary-chevron" aria-hidden="true">▾</span>
          </summary>

          <div class="optional-body">
            <div class="optional-grid">
              <div>
                <h3 class="mini-section-title">${escapeHtml(country.name)} Tax &amp; ${escapeHtml(country.retirementLabel)} Settings</h3>
                <div class="country-specific-fields">
                  ${renderCountryOptionsHtml(state.country, opts, isContractor, country)}
                </div>
                ${
                  !isContractor
                    ? `
                  <div class="two-col-fields mt-sm">
                    <div class="sub-field">
                      <label class="sub-label" for="bonus-input">Annual Bonus (Optional)</label>
                      <div class="input-combo compact">
                        <span class="input-prefix">${escapeHtml(country.symbol)}</span>
                        <input type="number" id="bonus-input" class="num-input" min="0" step="1000" value="${state.bonus}" />
                      </div>
                    </div>
                    <div class="sub-field">
                      <label class="sub-label" for="hours-week-input">Hours per Week</label>
                      <input type="number" id="hours-week-input" class="text-input" min="1" max="80" step="0.5" value="${state.hoursPerWeek}" />
                    </div>
                  </div>
                `
                    : ''
                }
              </div>

              <div>
                <h3 class="mini-section-title">${isContractor ? 'Compare Against a Full-Time Salary Offer' : 'Compare Against a Contractor Day Rate'}</h3>
                <p class="field-hint" style="margin-bottom:10px;">
                  ${
                    isContractor
                      ? 'Weighing up a permanent job offer? Enter the annual base salary below to see which leaves you better off after tax, super/retirement, and paid leave.'
                      : 'Thinking of contracting? Enter a daily contractor rate below to see how it stacks up against your current full-time package.'
                  }
                </p>
                <div class="input-combo compact">
                  <span class="input-prefix">${escapeHtml(country.symbol)}</span>
                  <input
                    type="number"
                    id="compare-input"
                    class="num-input"
                    min="0"
                    step="${isContractor ? '5000' : '25'}"
                    value="${isContractor ? state.compareSalary || '' : state.compareDayRate || ''}"
                    placeholder="${isContractor ? 'e.g. 165000' : 'e.g. 900'}"
                  />
                  <span class="input-suffix">${isContractor ? 'per year (full-time)' : 'per day (contractor)'}</span>
                </div>
                <div class="form-footnote">${escapeHtml(country.notes)}</div>
              </div>
            </div>
          </div>
        </details>
      </div>
    </section>
  `;
}

function renderCountryOptionsHtml(code, opts, isContractor) {
  switch (code) {
    case 'AU':
      return `
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="opt-residency">Tax Residency</label>
            <select id="opt-residency" class="select-input" data-opt="residency">
              <option value="resident" ${opts.residency === 'resident' ? 'selected' : ''}>Australian Resident</option>
              <option value="non-resident" ${opts.residency === 'non-resident' ? 'selected' : ''}>Foreign Resident</option>
              <option value="whm" ${opts.residency === 'whm' ? 'selected' : ''}>Working Holiday Maker</option>
            </select>
          </div>
          <div class="sub-field">
            <label class="sub-label" for="opt-superRate">Superannuation (%)</label>
            <input type="number" id="opt-superRate" class="text-input" data-opt="superRate" data-type="number" min="0" max="40" step="0.5" value="${opts.superRate}" />
          </div>
        </div>
        <div class="sub-field">
          <label class="sub-label" for="opt-salarySacrifice">${isContractor ? 'Voluntary Deductible Super ($/yr)' : 'Pre-Tax Salary Sacrifice ($/yr)'}</label>
          <div class="input-combo compact">
            <span class="input-prefix">$</span>
            <input type="number" id="opt-salarySacrifice" class="num-input" data-opt="salarySacrifice" data-type="number" min="0" step="1000" value="${opts.salarySacrifice}" />
          </div>
        </div>
        <div class="toggle-grid">
          <label class="toggle-row">
            <input type="checkbox" data-opt="includesSuper" data-type="boolean" ${opts.includesSuper ? 'checked' : ''} />
            <span>${isContractor ? 'My rate includes Super' : 'My salary package includes Super'}</span>
          </label>
          <label class="toggle-row">
            <input type="checkbox" data-opt="hasHecs" data-type="boolean" ${opts.hasHecs ? 'checked' : ''} />
            <span>I have a HECS-HELP student loan</span>
          </label>
          <label class="toggle-row">
            <input type="checkbox" data-opt="hasPrivateHealth" data-type="boolean" ${opts.hasPrivateHealth ? 'checked' : ''} />
            <span>I have private hospital insurance (avoids surcharge)</span>
          </label>
          ${
            isContractor
              ? `
            <label class="toggle-row">
              <input type="checkbox" data-opt="gstRegistered" data-type="boolean" ${opts.gstRegistered ? 'checked' : ''} />
              <span>GST registered (adds 10% GST on invoices)</span>
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
            <label class="sub-label" for="opt-filingStatus">Tax Filing Status</label>
            <select id="opt-filingStatus" class="select-input" data-opt="filingStatus">
              <option value="single" ${opts.filingStatus === 'single' ? 'selected' : ''}>Single</option>
              <option value="married" ${opts.filingStatus === 'married' ? 'selected' : ''}>Married Filing Jointly</option>
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
              <span>Include 20% QBI self-employed deduction</span>
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
            <label class="sub-label" for="opt-region">Region</label>
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
            <label class="sub-label" for="opt-contractorType">How You Contract</label>
            <select id="opt-contractorType" class="select-input" data-opt="contractorType">
              <option value="sole-trader" ${opts.contractorType === 'sole-trader' ? 'selected' : ''}>Sole Trader / Self-Employed</option>
              <option value="outside-ir35" ${opts.contractorType === 'outside-ir35' ? 'selected' : ''}>Outside IR35 (Limited Company)</option>
              <option value="inside-ir35" ${opts.contractorType === 'inside-ir35' ? 'selected' : ''}>Inside IR35 (Taxed like employee)</option>
            </select>
          </div>`
            : ''
        }
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="opt-pensionPct">Your Pension (%)</label>
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
              <span>GST/HST Registered</span>
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
              <option value="old" ${opts.regime === 'old' ? 'selected' : ''}>Old Regime (with 80C / HRA)</option>
            </select>
          </div>
          ${
            isContractor
              ? `
            <div class="sub-field">
              <label class="sub-label" for="opt-gstType">GST Invoicing</label>
              <select id="opt-gstType" class="select-input" data-opt="gstType">
                <option value="export" ${opts.gstType === 'export' ? 'selected' : ''}>Foreign Client / Export (0% GST)</option>
                <option value="domestic" ${opts.gstType === 'domestic' ? 'selected' : ''}>Indian Client (18% GST)</option>
                <option value="none" ${opts.gstType === 'none' ? 'selected' : ''}>Below ₹20L Threshold</option>
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
              <span>Use Section 44ADA (only 50% of income is taxed, up to ₹75L)</span>
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
              <span>GST Registered (15%)</span>
            </label>
          </div>`
            : ''
        }
      `;

    case 'SG':
      return `
        <div class="two-col-fields">
          <div class="sub-field">
            <label class="sub-label" for="opt-residency">Residency Status</label>
            <select id="opt-residency" class="select-input" data-opt="residency">
              <option value="citizen-pr" ${opts.residency === 'citizen-pr' ? 'selected' : ''}>Singapore Citizen / PR (with CPF)</option>
              <option value="expat-ep" ${opts.residency === 'expat-ep' ? 'selected' : ''}>Employment Pass / Expat (No CPF)</option>
            </select>
          </div>
          <div class="sub-field">
            <label class="sub-label" for="opt-srsContribution">SRS Tax Relief (S$/yr)</label>
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
