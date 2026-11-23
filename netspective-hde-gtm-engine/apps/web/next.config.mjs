// Minimal Next.js configuration. `agentRules: false` stops the dev server writing an AGENTS.md file, and the
// browser test opens the app as 127.0.0.1, which the dev server blocks unless it is listed.
export default { agentRules: false, allowedDevOrigins: ["127.0.0.1"] };
