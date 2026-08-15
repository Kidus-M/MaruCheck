export type PackageManager = "bun" | "npm" | "pnpm" | "unknown" | "yarn";
export type Framework = "nextjs" | "react";
export type ProjectLanguage = "javascript" | "typescript";
export type TestFramework = "jest" | "playwright" | "vitest";

export interface DetectedStack {
  readonly ci: {
    readonly githubActions: boolean;
    readonly workflowFiles: readonly string[];
  };
  readonly databaseLibraries: readonly string[];
  readonly frameworks: readonly Framework[];
  readonly languages: readonly ProjectLanguage[];
  readonly packageManager: PackageManager;
  readonly sourceDirectories: readonly string[];
  readonly testDirectories: readonly string[];
  readonly testFrameworks: readonly TestFramework[];
}

export interface ProjectRoute {
  readonly kind: "api" | "page";
  readonly methods?: readonly string[];
  readonly path: string;
  readonly source: string;
}

export interface ProjectTestFile {
  readonly framework: TestFramework | "unknown";
  readonly path: string;
}

export interface ProjectScan {
  readonly ci: DetectedStack["ci"];
  readonly dependencies: {
    readonly development: readonly string[];
    readonly production: readonly string[];
  };
  readonly generatedAt: string;
  readonly project: {
    readonly databaseLibraries: readonly string[];
    readonly frameworks: readonly Framework[];
    readonly languages: readonly ProjectLanguage[];
    readonly name: string;
    readonly packageManager: PackageManager;
    readonly root: ".";
  };
  readonly routes: readonly ProjectRoute[];
  readonly schemaVersion: 1;
  readonly source: {
    readonly directories: readonly string[];
    readonly fileCount: number;
    readonly files: readonly string[];
    readonly filesByExtension: Readonly<Record<string, number>>;
  };
  readonly tests: {
    readonly directories: readonly string[];
    readonly files: readonly ProjectTestFile[];
    readonly frameworks: readonly TestFramework[];
  };
}

export interface InitializationResult {
  readonly configPath: ".maru/maru.yml";
  readonly created: boolean;
  readonly directories: readonly string[];
  readonly stack: DetectedStack;
}

export type DoctorStatus = "fail" | "pass" | "warn";

export interface DoctorCheck {
  readonly code: string;
  readonly details: string;
  readonly remediation?: string;
  readonly status: DoctorStatus;
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  readonly ok: boolean;
}

export interface DoctorEnvironment {
  readonly executableAvailable: (executable: string) => Promise<boolean>;
  readonly runtimeVersion: string;
}
