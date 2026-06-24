import { createSign } from "node:crypto";
import type { SandboxSession } from "eve/sandbox";
import { defaultGitHubAuth, githubChannel } from "eve/channels/github";
import type { GitHubChannelState } from "eve/channels/github";

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

// --- Manual repo checkout (Hobby-plan compatible) ---------------------------
// The built-in handler brokers the GitHub installation token through Vercel's
// network-policy `transform`, which is unavailable on the Hobby plan (HTTP 402).
// We instead mint an installation token ourselves and pass it to `git` via an
// `http.extraHeader` on the fetch, so the token never lands in `.git/config`
// (only on the command line of a single sandbox `run`, which the model does
// not observe). Requires `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` to be set
// in the runtime environment (same env vars the channel uses for auth).

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function createGitHubAppJwt(
  appId: string,
  privateKeyPem: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    exp: now + 600,
    iat: now - 60,
    iss: appId,
  });
  const data = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const signature = signer.sign(privateKeyPem, "base64url");
  return `${data}.${signature}`;
}

function normalizePrivateKey(key: string): string {
  // Vercel platform escapes newlines in PEMs; restore them.
  return key.replace(/\\n/gu, "\n");
}

async function createInstallationToken(input: {
  appId: string;
  privateKey: string;
  installationId: number;
}): Promise<string> {
  const jwt = await createGitHubAppJwt(input.appId, input.privateKey);
  const res = await fetch(
    `https://api.github.com/app/installations/${input.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${jwt}`,
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  const body = (await res.json()) as { token?: string };
  if (!res.ok || !body.token) {
    throw new Error(
      `GitHub installation token failed (HTTP ${res.status}): ${JSON.stringify(body)}`,
    );
  }
  return body.token;
}

function resolveCheckoutRef(state: GitHubChannelState): string {
  if (state.headSha && /^[a-f0-9]{40}$/iu.test(state.headSha)) {
    return state.headSha;
  }
  if (state.pullRequestNumber != null) {
    return `refs/pull/${state.pullRequestNumber}/head`;
  }
  if (state.headRef) return state.headRef;
  if (state.defaultBranch) return state.defaultBranch;
  if (state.baseRef) return state.baseRef;
  throw new Error("GitHub checkout could not resolve a ref to fetch.");
}

async function runGit(
  sandbox: SandboxSession,
  label: string,
  command: string,
): Promise<void> {
  const result = await sandbox.run({ command });
  if (result.exitCode !== 0) {
    throw new Error(
      `GitHub checkout failed during ${label} (exit ${result.exitCode}). ${String(result.stderr ?? "")}`.trim(),
    );
  }
}

export default githubChannel({
  onPullRequest: (ctx, pr) =>
    pr.action === "opened" ? { auth: defaultGitHubAuth(ctx) } : null,
  events: {
    // Replace the built-in turn.started handler (eyes reaction + repo
    // checkout). Manual checkout mints an installation token and passes it
    // to `git` via `http.extraHeader` on the fetch, so we never call
    // `setNetworkPolicy` (which 402s on the Vercel Hobby plan) and the
    // token never persists in `.git/config`.
    async "turn.started"(_event, channel, ctx) {
      try {
        await channel.thread.react("eyes");
      } catch {
        // ignore reaction failures
      }

      const state = channel.state;
      if (state.installationId == null) return;

      const appId = process.env.GITHUB_APP_ID;
      const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY;
      if (!appId || !privateKeyRaw) return;

      try {
        const token = await createInstallationToken({
          appId,
          privateKey: normalizePrivateKey(privateKeyRaw),
          installationId: state.installationId,
        });
        const auth = Buffer.from(`x-access-token:${token}`).toString("base64");
        const url = `https://github.com/${state.owner}/${state.repo}.git`;
        const ref = resolveCheckoutRef(state);
        const dir = "/workspace";

        const sandbox = await ctx.getSandbox();
        await runGit(sandbox, "create checkout directory", `mkdir -p ${shellQuote(dir)}`);
        await runGit(sandbox, "initialize git repository", `cd ${shellQuote(dir)} && git init -q`);
        await runGit(sandbox, "reset git remote", `cd ${shellQuote(dir)} && git remote remove origin >/dev/null 2>&1 || true`);
        await runGit(sandbox, "configure git remote", `cd ${shellQuote(dir)} && git remote add origin ${shellQuote(url)}`);
        await runGit(
          sandbox,
          "fetch GitHub ref",
          `cd ${shellQuote(dir)} && GIT_TERMINAL_PROMPT=0 git -c http.extraHeader="Authorization: Basic ${auth}" fetch --depth 1 origin ${shellQuote(ref)}`,
        );
        await runGit(sandbox, "checkout GitHub ref", `cd ${shellQuote(dir)} && git checkout --detach FETCH_HEAD`);
        state.checkoutPath = dir;
      } catch (error) {
        console.error("[turn.started] manual GitHub checkout failed", error);
      }
    },
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
