import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { defineAgent } from "eve";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export default defineAgent({
  description:
    "Review a GitHub pull request diff and produce a structured code review with inline comments.",
  model: openrouter("deepseek/deepseek-v4-pro"),
  modelContextWindowTokens: 400_000,
});
