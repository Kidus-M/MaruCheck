export const MARU_CONFIG_DIRECTORY = ".maru";
export const MARU_CONFIG_FILENAME = "maru.yml";

export interface ProjectIdentity {
  readonly name: string;
  readonly rootDirectory: string;
}
