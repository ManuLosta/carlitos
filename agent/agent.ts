import { defineAgent } from "eve";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export default defineAgent({
  model: openrouter("deepseek/deepseek-v4-pro"),
  modelContextWindowTokens: 400_000,
});
