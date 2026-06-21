import * as fs from "fs";
import * as path from "path";

import { PROJECT_CONFIG_FILENAME, ProjectConfig } from "./types";

/**
 * Returns the project config path for a workspace root.
 */
export function getProjectConfigPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, ".vscode", PROJECT_CONFIG_FILENAME);
}

/**
 * Reads a project config JSON file from disk.
 */
export function readProjectConfig(filePath: string): ProjectConfig {
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data) as ProjectConfig;
}

/**
 * Writes a project config JSON file to disk, creating the parent directory if needed.
 */
export function writeProjectConfig(filePath: string, config: ProjectConfig): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), { flag: "w+" });
}

/**
 * Returns true when the project config file exists for a workspace root.
 */
export function projectConfigExists(workspaceRoot: string): boolean {
    return fs.existsSync(getProjectConfigPath(workspaceRoot));
}
