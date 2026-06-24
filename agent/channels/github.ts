import { defaultGitHubAuth, githubChannel } from "eve/channels/github";

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

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }

  const comments: InlineReviewComment[] = [];
  for (const entry of parsed) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).path === "string" &&
      typeof (entry as Record<string, unknown>).line === "number" &&
      typeof (entry as Record<string, unknown>).body === "string"
    ) {
      const { path, line, body, side } = entry as Record<string, unknown>;
      const comment: InlineReviewComment = {
        path: path as string,
        line: line as number,
        body: body as string,
      };
      if (side === "LEFT" || side === "RIGHT") {
        comment.side = side;
      }
      comments.push(comment);
    } else {
      console.warn(
        "Dropping malformed inline review comment:",
        JSON.stringify(entry),
      );
    }
  }

  return { summary, comments };
}

export default githubChannel({
  onPullRequest: (ctx, pr) =>
    pr.action === "opened" ? { auth: defaultGitHubAuth(ctx) } : null,
  events: {
    async "message.completed"(event, channel) {
      const { message, finishReason } = event;
      if (finishReason === "tool-calls" || !message) {
        return;
      }

      const pullRequestNumber = channel.state.pullRequestNumber;
      if (pullRequestNumber == null) {
        // Not a pull request conversation: post the reply as-is.
        await channel.thread.post(message);
        return;
      }

      const extracted = extractInlineComments(message);

      if (!extracted || extracted.comments.length === 0) {
        const summary = extracted?.summary;
        await channel.thread.post(summary && summary.trim() ? summary : message);
        return;
      }

      const { summary, comments } = extracted;

      try {
        await channel.github.request({
          method: "POST",
          path: `/repos/${encodeURIComponent(channel.repository.owner)}/${encodeURIComponent(
            channel.repository.name,
          )}/pulls/${pullRequestNumber}/reviews`,
          body: {
            body: summary || "Code review",
            event: "COMMENT",
            comments: comments.map((comment) => ({
              path: comment.path,
              line: comment.line,
              side: comment.side ?? "RIGHT",
              body: comment.body,
            })),
          },
        });
      } catch (error) {
        console.error("Failed to create pull request review", error);
        await channel.thread.post(summary || message);
      }
    },
  },
});
