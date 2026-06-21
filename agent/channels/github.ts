import { defaultGitHubAuth, githubChannel } from "eve/channels/github";
import {
  type ExtractedReviewComments,
  extractInlineComments,
} from "../lib/github.js";

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
