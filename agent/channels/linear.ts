import { defaultLinearAuth, linearChannel } from "eve/channels/linear";

export default linearChannel({
  onAgentSession: (_ctx, event) => {
    if (event.action !== "created" && event.action !== "prompted") return null;
    return { auth: defaultLinearAuth(event) };
  },
});
