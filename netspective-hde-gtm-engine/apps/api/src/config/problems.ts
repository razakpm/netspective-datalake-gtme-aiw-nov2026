/** One configuration problem. Names the setting and what is wrong; never carries the value. */
export interface ConfigProblem {
  variable: string;
  message: string;
}

export class ConfigError extends Error {
  readonly problems: readonly ConfigProblem[];

  constructor(problems: readonly ConfigProblem[]) {
    super(
      `Invalid configuration: ${problems.map((p) => `${p.variable} (${p.message})`).join("; ")}`,
    );
    this.name = "ConfigError";
    this.problems = problems;
  }
}
