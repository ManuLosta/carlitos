import { defaultGitHubAuth, githubChannel } from "eve/channels/github";

export default githubChannel({
  onPullRequest: (ctx, pr) =>
    pr.action === "opened" ? { auth: defaultGitHubAuth(ctx) } : null,
});
