import * as path from "path";

import { Location } from "../types";
import { ProjectConfig, RepositoryConfig, VersionConfig } from "./types";

/** Resolved repository and version facts for a location. */
export interface ResolvedProjectRepository {
    repository: RepositoryConfig;
    version?: VersionConfig;
    commit?: string;
    path: string;
}

/**
 * Resolves repository metadata for a location using repo/version hints or longest root-prefix matching.
 */
export function resolveProjectRepository(config: ProjectConfig, location: Location): ResolvedProjectRepository | undefined {
    const repository = findRepository(config.repositories, location);
    if (repository === undefined) {
        return;
    }

    const version = findVersion(repository, location.version);
    const commit = location.commit ?? version?.commit;
    return {
        repository,
        version,
        commit,
        path: getRepositoryRelativePath(location.path, repository.root),
    };
}

/**
 * Finds the best repository match for a location.
 */
function findRepository(repositories: RepositoryConfig[], location: Location): RepositoryConfig | undefined {
    if (location.repo !== undefined) {
        return repositories.find((repository) => repository.name === location.repo);
    }

    return repositories
        .filter((repository) => pathMatchesRepositoryRoot(location.path, repository.root))
        .sort((left, right) => normalizeRoot(right.root).length - normalizeRoot(left.root).length)[0];
}

/**
 * Finds the requested version or the first configured version.
 */
function findVersion(repository: RepositoryConfig, versionName: string | undefined): VersionConfig | undefined {
    if (repository.versions === undefined || repository.versions.length === 0) {
        return;
    }
    if (versionName !== undefined) {
        return repository.versions.find((version) => version.name === versionName);
    }
    return repository.versions[0];
}

/**
 * Returns true when a workspace-relative path belongs to a repository root.
 */
function pathMatchesRepositoryRoot(filePath: string, root: string | undefined): boolean {
    const normalizedPath = normalizeWorkspacePath(filePath);
    const normalizedRoot = normalizeRoot(root);
    if (normalizedRoot === "") {
        return true;
    }
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

/**
 * Converts a workspace-relative path to a repository-relative path.
 */
function getRepositoryRelativePath(filePath: string, root: string | undefined): string {
    const normalizedPath = normalizeWorkspacePath(filePath);
    const normalizedRoot = normalizeRoot(root);
    if (normalizedRoot === "" || normalizedPath === normalizedRoot) {
        return normalizedRoot === "" ? normalizedPath : path.posix.basename(normalizedPath);
    }
    return normalizedPath.slice(normalizedRoot.length + 1);
}

/**
 * Normalizes a repository root from project config for prefix matching.
 */
function normalizeRoot(root: string | undefined): string {
    if (root === undefined || root === ".") {
        return "";
    }
    return normalizeWorkspacePath(root).replace(/\/$/, "");
}

/**
 * Normalizes workspace-relative paths to forward-slash form.
 */
function normalizeWorkspacePath(value: string): string {
    return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}
