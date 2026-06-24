import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

export default defineSandbox({
  backend: vercel({
    // allow-all egress so the repo checkout's `git clone` works.
    // Avoids Hobby-plan-only `transform`-based policies (402).
    networkPolicy: "allow-all",
    timeout: 120_000,
  }),
  async onSession({ use }) {
    await use({
      networkPolicy: "allow-all",
      timeout: 120_000,
    });
  },
});