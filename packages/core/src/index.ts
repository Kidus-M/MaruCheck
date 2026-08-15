import { MARU_CONFIG_DIRECTORY, MARU_CONFIG_FILENAME } from "@maru/shared";

export const MARU_PRODUCT = {
  command: "maru",
  configDirectory: MARU_CONFIG_DIRECTORY,
  configFilename: MARU_CONFIG_FILENAME,
  name: "MaruCheck",
  positioning: "Test what your AI didn't.",
} as const;
