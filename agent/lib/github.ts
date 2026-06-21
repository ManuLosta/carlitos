export const REVIEW_COMMENTS_START = "<github_review_comments>";
export const REVIEW_COMMENTS_END = "</github_review_comments>";

export type InlineReviewComment = {
  path: string;
  line: number;
  body: string;
  side?: "LEFT" | "RIGHT";
};

export type ExtractedReviewComments = {
  summary: string;
  comments: InlineReviewComment[];
};

export function extractInlineComments(
  message: string,
): ExtractedReviewComments | null {
  const startIdx = message.indexOf(REVIEW_COMMENTS_START);
  if (startIdx === -1) {
    return null;
  }

  const endIdx = message.indexOf(REVIEW_COMMENTS_END, startIdx);
  if (endIdx === -1) {
    return null;
  }

  let jsonText = message
    .slice(startIdx + REVIEW_COMMENTS_START.length, endIdx)
    .trim();

  // Strip an optional ```json ... ``` fence if the model included one.
  jsonText = jsonText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");

  const before = message.slice(0, startIdx).trim();
  const after = message.slice(endIdx + REVIEW_COMMENTS_END.length).trim();
  const summary = [before, after].filter(Boolean).join("\n\n");

  const comments = JSON.parse(jsonText) as unknown;
  if (!Array.isArray(comments)) {
    return null;
  }

  return { summary, comments };
}
