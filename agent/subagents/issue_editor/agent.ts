import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { defineAgent } from "eve";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export default defineAgent({
  description:
    "Improve the description of a Linear issue: clarify intent, add structure and detail, flag missing context, and suggest a better title when needed. Posts the result as a comment.",
  model: openrouter("deepseek/deepseek-v4-pro"),
  modelContextWindowTokens: 400_000,
});
