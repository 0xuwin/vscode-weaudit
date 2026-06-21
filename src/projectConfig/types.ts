export const PROJECT_CONFIG_SCHEMA_VERSION = 1;
export const PROJECT_CONFIG_FILENAME = "info.json";

/** Project-level metadata shared by reports and external tooling. */
export interface ProjectInfo {
    client?: string;
    target?: string;
    description?: string;
}

/** Glob-based audit scope for a repository. */
export interface ScopeConfig {
    include?: string[];
    exclude?: string[];
}

/** A named repository version and its optional commit. */
export interface VersionConfig {
    name: string;
    commit?: string;
}

/** Repository metadata within a project config file. */
export interface RepositoryConfig {
    name: string;
    root?: string;
    remote?: string;
    scope?: ScopeConfig;
    versions?: VersionConfig[];
}

/** Project-level configuration stored at .vscode/info.json. */
export interface ProjectConfig {
    schemaVersion: number;
    project: ProjectInfo;
    repositories: RepositoryConfig[];
}

/** A validation diagnostic for project config files. */
export interface ProjectConfigDiagnostic {
    message: string;
    path?: string;
}

/** The result of validating a project config object. */
export interface ProjectConfigValidationResult {
    errors: ProjectConfigDiagnostic[];
    warnings: ProjectConfigDiagnostic[];
}
