export type SourceControlProvider = "github" | "other";

export interface RepositoryReference {
  readonly provider: SourceControlProvider;
  readonly rootDirectory: string;
}
