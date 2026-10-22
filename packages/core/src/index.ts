export * from "./extract";
export * from "./metrics";

/** Model registry observed on the marketing site (Free plan ⊂ Starter ⊂ Enterprise). */
export const AI_MODELS = [
  "chatgpt",
  "perplexity",
  "ai_overview",
  "gemini",
  "copilot",
  "ai_mode",
  "claude",
  "grok",
  "deepseek",
  "meta_ai",
  "mistral",
] as const;

export type AiModel = (typeof AI_MODELS)[number];

export const FREE_MODELS: readonly AiModel[] = ["chatgpt", "perplexity", "ai_overview", "gemini", "copilot"];

export const MODEL_LABELS: Record<AiModel, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  ai_overview: "AI Overview",
  gemini: "Gemini",
  copilot: "Copilot",
  ai_mode: "AI Mode",
  claude: "Claude",
  grok: "Grok",
  deepseek: "DeepSeek",
  meta_ai: "Meta AI",
  mistral: "Mistral",
};

export const PLANS = {
  free: { label: "Free", monthlyCredits: 300, models: FREE_MODELS, priceMonthlyUsd: 0 },
  starter: {
    label: "Starter",
    monthlyCredits: 3600,
    models: AI_MODELS,
    priceMonthlyUsd: 295,
  },
  enterprise: { label: "Enterprise", monthlyCredits: 0, models: AI_MODELS, priceMonthlyUsd: 0 },
} as const;

export type PlanTier = keyof typeof PLANS;
