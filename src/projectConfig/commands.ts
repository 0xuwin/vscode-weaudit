import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import * as vscode from "vscode";

import { PROJECT_CONFIG_SCHEMA_VERSION, ProjectConfig, ProjectConfigValidationResult } from "./types";
import { getProjectConfigPath, projectConfigExists, readProjectConfig, writeProjectConfig } from "./storage";
import { isValidProjectConfig, validateProjectConfig } from "./validation";

/**
 * Registers project config commands on extension activation.
 */
export function activateProjectConfigCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.commands.registerCommand("weAudit.initializeProjectConfig", () => initializeProjectConfig()));
    context.subscriptions.push(vscode.commands.registerCommand("weAudit.validateProjectConfig", () => validateActiveProjectConfig()));
}

/**
 * Initializes .vscode/info.json for the selected workspace root and opens it.
 */
export async function initializeProjectConfig(): Promise<void> {
    const workspaceFolder = await chooseWorkspaceFolder("Initialize project config for workspace folder");
    if (workspaceFolder === undefined) {
        return;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    const filePath = getProjectConfigPath(workspaceRoot);
    if (projectConfigExists(workspaceRoot)) {
        const overwrite = await vscode.window.showWarningMessage("Project config already exists. Overwrite .vscode/info.json?", "Overwrite", "Open Existing");
        if (overwrite === "Open Existing") {
            await openProjectConfig(filePath);
            return;
        }
        if (overwrite !== "Overwrite") {
            return;
        }
    }

    const config = createInitialProjectConfig(workspaceFolder);
    writeProjectConfig(filePath, config);
    await openProjectConfig(filePath);
    vscode.window.showInformationMessage("weAudit: Project config initialized at .vscode/info.json.");
}

/**
 * Validates .vscode/info.json for the selected workspace root.
 */
export async function validateActiveProjectConfig(): Promise<void> {
    const workspaceFolder = await chooseWorkspaceFolder("Validate project config for workspace folder");
    if (workspaceFolder === undefined) {
        return;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    const filePath = getProjectConfigPath(workspaceRoot);
    if (!fs.existsSync(filePath)) {
        vscode.window.showErrorMessage("weAudit: Project config not found at .vscode/info.json.");
        return;
    }

    let config: ProjectConfig;
    try {
        config = readProjectConfig(filePath);
    } catch (error) {
        vscode.window.showErrorMessage(`weAudit: Failed to parse project config: ${String(error)}`);
        return;
    }

    const result = validateProjectConfig(config, workspaceRoot);
    showValidationResult(result);
}

/**
 * Creates an initial project config from workspace and Git metadata.
 */
export function createInitialProjectConfig(workspaceFolder: vscode.WorkspaceFolder): ProjectConfig {
    const workspaceRoot = workspaceFolder.uri.fsPath;
    const currentCommit = readCurrentGitCommit(workspaceRoot);
    const version = currentCommit === undefined ? [] : [{ name: "Current", commit: currentCommit }];

    return {
        schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
        project: {
            client: "",
            target: workspaceFolder.name,
            description: "",
        },
        repositories: [
            {
                name: path.basename(workspaceRoot),
                root: ".",
                remote: readGitRemote(workspaceRoot) ?? "",
                versions: version,
            },
        ],
    };
}

/**
 * Shows validation diagnostics to the user.
 */
function showValidationResult(result: ProjectConfigValidationResult): void {
    if (isValidProjectConfig(result)) {
        const warningSuffix = result.warnings.length === 0 ? "" : ` (${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"})`;
        vscode.window.showInformationMessage(`weAudit: Project config is valid${warningSuffix}.`);
        return;
    }

    const firstError = result.errors[0];
    const pathPrefix = firstError.path === undefined ? "" : `${firstError.path}: `;
    vscode.window.showErrorMessage(`weAudit: Project config is invalid. ${pathPrefix}${firstError.message}`);
}

/**
 * Opens a project config file in the editor.
 */
async function openProjectConfig(filePath: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(document);
}

/**
 * Lets the user pick a workspace folder when more than one is open.
 */
async function chooseWorkspaceFolder(placeHolder: string): Promise<vscode.WorkspaceFolder | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders === undefined || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("weAudit: Open a workspace folder before using project config commands.");
        return;
    }
    if (workspaceFolders.length === 1) {
        return workspaceFolders[0];
    }

    const selected = await vscode.window.showQuickPick(
        workspaceFolders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
        { placeHolder },
    );
    return selected?.folder;
}

/**
 * Reads the first Git remote URL from .git/config, preferring origin.
 */
function readGitRemote(workspaceRoot: string): string | undefined {
    const gitConfigPath = path.join(workspaceRoot, ".git", "config");
    if (!fs.existsSync(gitConfigPath)) {
        return;
    }

    const gitConfig = fs.readFileSync(gitConfigPath, "utf8");
    const originRemote = gitConfig.match(/\[remote "origin"\][\s\S]*?url = (.*)/);
    const fallbackRemote = gitConfig.match(/url = (.*)/);
    return normalizeGitRemote((originRemote ?? fallbackRemote)?.[1]?.trim());
}

/**
 * Normalizes common Git remote URL forms for project config storage.
 */
function normalizeGitRemote(remote: string | undefined): string | undefined {
    if (remote === undefined) {
        return;
    }
    let normalized = remote;
    if (normalized.startsWith("git@github.com:")) {
        normalized = normalized.replace("git@github.com:", "https://github.com/");
    }
    if (normalized.endsWith(".git")) {
        normalized = normalized.slice(0, -".git".length);
    }
    return normalized;
}

/**
 * Reads the current Git commit for a workspace root.
 */
function readCurrentGitCommit(workspaceRoot: string): string | undefined {
    const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" });
    if (result.status !== 0) {
        return;
    }
    const commit = result.stdout.trim();
    return commit === "" ? undefined : commit;
}
