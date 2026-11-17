// Placeholder for root scripts whose implementation lands in a later task (tasks.md T009).
// Exits non-zero with a clear message so a missing capability is never mistaken for success.
const [name = "(unknown)", task = "a later task"] = process.argv.slice(2);
console.error(
  `pnpm ${name} is not implemented yet (see ${task} in specs/001-project-foundation/tasks.md).`,
);
process.exit(1);
