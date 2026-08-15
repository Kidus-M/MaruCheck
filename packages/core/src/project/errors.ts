export type ProjectErrorCode =
  | "INVALID_PROJECT_MANIFEST"
  | "MARU_NOT_INITIALIZED"
  | "PROJECT_PATH_OUTSIDE_ROOT"
  | "PROJECT_READ_FAILED"
  | "PROJECT_WRITE_FAILED";

export class ProjectError extends Error {
  public constructor(
    public readonly code: ProjectErrorCode,
    public readonly operation: string,
    message: string,
    public readonly remediation: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProjectError";
  }
}
