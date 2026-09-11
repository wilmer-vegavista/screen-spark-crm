/** Errors the Fortnox layer throws. Messages are already redacted where they carry API text. */

export class FortnoxApiError extends Error {
  constructor(
    readonly status: number,
    readonly fortnoxCode: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "FortnoxApiError";
  }
}

/** A read that cannot prove it is complete, or a response whose shape drifted. */
export class FortnoxReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FortnoxReadError";
  }
}

/** The company guard refused: wrong tenant, or a write attempted outside the guard. */
export class TenantGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantGuardError";
  }
}
