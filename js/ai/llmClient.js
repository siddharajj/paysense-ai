/**
 * Optional BYOK ($0 Free-Tier) LLM Client.
 * Runs 100% in the browser — keys are stored ONLY in localStorage.
 * Supports Google Gemini API (Free Tier) or any OpenAI-compatible API (Groq, OpenRouter, Ollama).
 */

const STORAGE_KEY = 'paysense_ai_llm_config_v1';

export function loadLlmConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLlmConfig();
    return { ...defaultLlmConfig(), ...JSON.parse(raw) };
  } catch {
    return defaultLlmConfig();
  }
}

export function saveLlmConfig(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...defaultLlmConfig(), ...cfg }));
  } catch {
    // ignore quota/private mode errors
  }
}

export function defaultLlmConfig() {
  return {
    provider: 'local', // 'local' | 'gemini' | 'openai-compatible'
    apiKey: '',
    model: 'gemini-2.5-flash',
    baseUrl: 'https://api.groq.com/openai/v1',
  };
}

export function isExternalLlmActive(cfg) {
  return cfg.provider !== 'local' && Boolean((cfg.apiKey || '').trim());
}

/**
 * Ask the user's configured free-tier LLM to parse a complex natural language prompt
 * into structured calculator fields AND provide a concise 2-sentence explanation.
 */
export async function parseAndAdviseWithLlm(promptText, currentState, currentCalc, cfg) {
  const systemPrompt = `You are PaySense AI, an expert multi-country employee and contractor pay calculator assistant.
Supported countries: AU, US, UK, CA, IN, NZ, SG.
Supported modes: "employee", "contractor".
Supported ratePeriods: "annual", "monthly", "fortnightly", "weekly", "daily", "hourly".

Given the user's prompt and their current state, respond ONLY with valid JSON matching this schema:
{
  "patch": {
    "country"?: "AU"|"US"|"UK"|"CA"|"IN"|"NZ"|"SG",
    "mode"?: "employee"|"contractor",
    "amount"?: number,
    "ratePeriod"?: "annual"|"monthly"|"fortnightly"|"weekly"|"daily"|"hourly",
    "billableDays"?: number,
    "businessExpenses"?: number,
    "compareSalary"?: number,
    "compareDayRate"?: number
  },
  "countryOptionPatch"?: object,
  "targetNetAnnual"?: number | null,
  "reply": "Short, clear 1-3 sentence explanation or answer to the user's question."
}
Only include keys in patch/countryOptionPatch that should change. Do not wrap in markdown fences.`;

  const userPayload = JSON.stringify({
    prompt: promptText,
    currentState: {
      country: currentState.country,
      mode: currentState.mode,
      amount: currentState.amount,
      ratePeriod: currentState.ratePeriod,
      billableDays: currentState.billableDays,
      businessExpenses: currentState.businessExpenses,
      countryOptions: currentState.countryOptions?.[currentState.country],
    },
    currentSummary: {
      grossAnnual: Math.round(currentCalc.grossIncome),
      netAnnual: Math.round(currentCalc.netIncome),
      effectiveTaxRatePct: Number((currentCalc.effectiveTaxRate * 100).toFixed(1)),
      marginalRatePct: Number((currentCalc.marginalRate * 100).toFixed(1)),
    },
  });

  if (cfg.provider === 'gemini') {
    const model = cfg.model || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.apiKey.trim())}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPayload }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini API error (${res.status}). Falling back to built-in Local AI.`);
    }
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return safeParseJson(raw);
  }

  if (cfg.provider === 'openai-compatible') {
    const base = (cfg.baseUrl || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: cfg.model || 'llama-3.3-70b-versatile',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPayload },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`API error (${res.status}). Falling back to built-in Local AI.`);
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    return safeParseJson(raw);
  }

  return null;
}

function safeParseJson(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned);
  return {
    patch: parsed.patch && typeof parsed.patch === 'object' ? parsed.patch : {},
    countryOptionPatch: parsed.countryOptionPatch && typeof parsed.countryOptionPatch === 'object' ? parsed.countryOptionPatch : {},
    targetNetAnnual: typeof parsed.targetNetAnnual === 'number' && parsed.targetNetAnnual > 0 ? parsed.targetNetAnnual : null,
    reply: typeof parsed.reply === 'string' ? parsed.reply : '',
  };
}
