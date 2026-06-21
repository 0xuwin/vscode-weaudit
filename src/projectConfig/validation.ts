import * as path from "path";

import { PROJECT_CONFIG_SCHEMA_VERSION, ProjectConfigDiagnostic, ProjectConfigValidationResult, RepositoryConfig, ScopeConfig } from "./types";

/**
 * Validates a project config against the required schema and workspace path rules.
 */
export function validateProjectConfig(config: unknown, workspaceRoot: string): ProjectConfigValidationResult {
    const errors: ProjectConfigDiagnostic[] = [];
    const warnings: ProjectConfigDiagnostic[] = [];

    if (!isRecord(config)) {
        return { errors: [{ message: "Project config must be a JSON object." }], warnings };
    }

    if (config.schemaVersion !== PROJECT_CONFIG_SCHEMA_VERSION) {
        errors.push({ path: "schemaVersion", message: `schemaVersion must be ${PROJECT_CONFIG_SCHEMA_VERSION}.` });
    }

    if (!isRecord(config.project)) {
        errors.push({ path: "project", message: "project must be an object." });
    } else {
        if (config.project.client === undefined) {
            warnings.push({ path: "project.client", message: "project.client is missing; reporting may prompt for it later." });
        }
        if (config.project.target === undefined) {
            warnings.push({ path: "project.target", message: "project.target is missing; reporting may prompt for it later." });
        }
    }

    if (!Array.isArray(config.repositories)) {
        errors.push({ path: "repositories", message: "repositories must be an array." });
        return { errors, warnings };
    }

    if (config.repositories.length === 0) {
        errors.push({ path: "repositories", message: "repositories must contain at least one repository." });
    }

    validateRepositories(config.repositories, workspaceRoot, errors);
    return { errors, warnings };
}

/**
 * Returns true when a project config validation result has no errors.
 */
export function isValidProjectConfig(result: ProjectConfigValidationResult): boolean {
    return result.errors.length === 0;
}

/**
 * Validates repository-level uniqueness, paths, scope, and versions.
 */
function validateRepositories(repositories: unknown[], workspaceRoot: string, errors: ProjectConfigDiagnostic[]): void {
    const seenNames = new Set<string>();

    repositories.forEach((repository, index) => {
        const basePath = `repositories[${index}]`;
        if (!isRecord(repository)) {
            errors.push({ path: basePath, message: "repository must be an object." });
            return;
        }

        const repo = repository as Partial<RepositoryConfig>;
        if (typeof repo.name !== "string" || repo.name === "") {
            errors.push({ path: `${basePath}.name`, message: "repository name must be a non-empty string." });
        } else if (seenNames.has(repo.name)) {
            errors.push({ path: `${basePath}.name`, message: `repository name '${repo.name}' is duplicated.` });
        } else {
            seenNames.add(repo.name);
        }

        if (repo.root !== undefined) {
            if (typeof repo.root !== "string" || repo.root === "") {
                errors.push({ path: `${basePath}.root`, message: "repository root must be a non-empty string when present." });
            } else if (!isWorkspaceRelativePathInsideRoot(repo.root, workspaceRoot)) {
                errors.push({ path: `${basePath}.root`, message: "repository root must resolve inside the workspace root." });
            }
        }

        if (repo.remote !== undefined && typeof repo.remote !== "string") {
            errors.push({ path: `${basePath}.remote`, message: "repository remote must be a string when present." });
        }

        if (repo.scope !== undefined) {
            validateScope(repo.scope, `${basePath}.scope`, errors);
        }

        if (repo.versions !== undefined) {
            validateVersions(repo.versions, `${basePath}.versions`, errors);
        }
    });
}

/**
 * Validates include and exclude scope glob arrays.
 */
function validateScope(scope: unknown, basePath: string, errors: ProjectConfigDiagnostic[]): void {
    if (!isRecord(scope)) {
        errors.push({ path: basePath, message: "scope must be an object when present." });
        return;
    }

    const typedScope = scope as ScopeConfig;
    validateOptionalStringArray(typedScope.include, `${basePath}.include`, errors);
    validateOptionalStringArray(typedScope.exclude, `${basePath}.exclude`, errors);
}

/**
 * Validates repository versions and version-name uniqueness.
 */
function validateVersions(versions: unknown, basePath: string, errors: ProjectConfigDiagnostic[]): void {
    if (!Array.isArray(versions)) {
        errors.push({ path: basePath, message: "versions must be an array when present." });
        return;
    }

    const seenNames = new Set<string>();
    versions.forEach((version, index) => {
        const versionPath = `${basePath}[${index}]`;
        if (!isRecord(version)) {
            errors.push({ path: versionPath, message: "version must be an object." });
            return;
        }
        if (typeof version.name !== "string" || version.name === "") {
            errors.push({ path: `${versionPath}.name`, message: "version name must be a non-empty string." });
        } else if (seenNames.has(version.name)) {
            errors.push({ path: `${versionPath}.name`, message: `version name '${version.name}' is duplicated within this repository.` });
        } else {
            seenNames.add(version.name);
        }
        if (version.commit !== undefined && typeof version.commit !== "string") {
            errors.push({ path: `${versionPath}.commit`, message: "version commit must be a string when present." });
        }
    });
}

/**
 * Validates optional arrays whose values must all be strings.
 */
function validateOptionalStringArray(value: unknown, valuePath: string, errors: ProjectConfigDiagnostic[]): void {
    if (value === undefined) {
        return;
    }
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        errors.push({ path: valuePath, message: "value must be an array of strings when present." });
    }
}

/**
 * Returns true when a path is workspace-relative and resolves inside the workspace root.
 */
function isWorkspaceRelativePathInsideRoot(relativePath: string, workspaceRoot: string): boolean {
    if (path.isAbsolute(relativePath)) {
        return false;
    }
    const resolvedRoot = path.resolve(workspaceRoot);
    const resolvedPath = path.resolve(workspaceRoot, relativePath);
    return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${path.sep}`);
}

/**
 * Returns true when the value is a non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
