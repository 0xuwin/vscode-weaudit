import * as vscode from "vscode";
import * as path from "path";

import { RootPathAndLabel, ConfigurationEntry, FullLocation, FullPath } from "../types";
import { WARoot } from "./workspaceRoot";

/**
 * This class helps manage a workspace with multiple root folders.
 * It maintains a list of root folders that it keeps up to date with user changes.
 * The functions in this class serve to transparently manage multiple root folders,
 * e.g. by taking taking filepaths and selecting the corresponding workspace root
 * that this file belongs to.
 */
export class MultiRootManager {
    private roots: WARoot[];
    private _onDidChangeRootsEmitter = new vscode.EventEmitter<[WARoot[], WARoot[]]>();
    private pathToRootMap: Map<string, [WARoot, string, boolean]>;
    private pathToMultipleRootMap: Map<string, [WARoot, string][]>;
    readonly onDidChangeRoots = this._onDidChangeRootsEmitter.event;

    constructor(context: vscode.ExtensionContext) {
        this.pathToRootMap = new Map<string, [WARoot, string, boolean]>();
        this.pathToMultipleRootMap = new Map<string, [WARoot, string][]>();
        this.roots = this.setupRoots();

        // Add a listener for changes to the roots
        const listener = async (event: vscode.WorkspaceFoldersChangeEvent): Promise<void> => {
            // Any removed or added roots will execute weAudit.toggleSavedFindings, which will cause a refresh
            // of the tree, and hence a recreation of the pathToEntryMap (which is important in case there is
            // only one workspace root left)
            for (const removed of event.removed) {
                await this.removeRoot(removed.uri.fsPath);
            }

            // Clear the pathToRootMap and pathToMultiRootMap after removing the roots,
            // but before adding the new ones because this change may (un)curse the roots
            this.pathToRootMap.clear();
            this.pathToMultipleRootMap.clear();

            const newRootPathList = this.roots.map((root) => root.rootPath).concat(event.added.map((added) => added.uri.fsPath));
            const newRootPathsAndLabels = this.createUniqueLabels(newRootPathList);
            let i;
            for (i = 0; i < this.roots.length; i++) {
                await this.roots[i].updateLabel(newRootPathsAndLabels[i].rootLabel);
            }
            for (; i < newRootPathsAndLabels.length; i++) {
                const root = new WARoot(newRootPathsAndLabels[i].rootPath, newRootPathsAndLabels[i].rootLabel);
                this.roots.push(root);
                for (const config of root.getConfigs()) {
                    // This is a quirk, because the WARoot constructor sets the configurations as active,
                    // but weAudit.toggleSavedFindings needs it to be inactive, we need to toggle it first
                    // a better solution would be to register another command that just loads findings into
                    // the tree for a specific incoming workspace root
                    root.toggleConfiguration(config);
                    // Add the findings of new roots to the MultiConfig and load them into the tree
                    await vscode.commands.executeCommand("weAudit.toggleSavedFindings", config);
                }
            }

            // Refresh the configuration files: This will request the roots and currently selected configurations
            await vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
        };
        const disposable = vscode.workspace.onDidChangeWorkspaceFolders(listener);
        context.subscriptions.push(disposable);
    }

    /**
     * Given a list of root paths and labels where all labels collide, this function
     * takes a directory from the root path and moves it to the label. It then checks
     * whether there are still any duplicates, and if so, it recurses on the remaining
     * root paths / label pairs where the labels have duplicates.
     * @param rootPathsAndLabels a list of root paths and labels where each label occurs
     * more than once.
     */
    private recurseUniqueLabels(rootPathsAndLabels: RootPathAndLabel[]): void {
        // We have called this function because all input elements have duplicates
        for (const rootPathAndLabel of rootPathsAndLabels) {
            const parsedRootPath = path.parse(rootPathAndLabel.rootPath);
            const labelPrefix = parsedRootPath.base ? parsedRootPath.base : "/";
            rootPathAndLabel.rootLabel = path.join(labelPrefix, rootPathAndLabel.rootLabel);
            rootPathAndLabel.rootPath = path.join(parsedRootPath.root, parsedRootPath.dir);
        }

        const rootLabels = rootPathsAndLabels.map((rootPathAndLabel) => rootPathAndLabel.rootLabel);
        if (new Set(rootLabels).size === rootPathsAndLabels.length) {
            return;
        } else {
            // We have duplicates
            const duplicateMap = new Map<string, string[]>();

            // First pass over the array to determine duplicates
            for (const rootPathAndLabel of rootPathsAndLabels) {
                const duplicateEntry = duplicateMap.get(rootPathAndLabel.rootLabel);
                if (duplicateEntry === undefined) {
                    duplicateMap.set(rootPathAndLabel.rootLabel, [rootPathAndLabel.rootPath]);
                } else {
                    duplicateMap.set(rootPathAndLabel.rootLabel, duplicateEntry.concat(rootPathAndLabel.rootPath));
                }
            }

            const duplicates = rootPathsAndLabels.filter(
                (rootPathAndLabel) => duplicateMap.get(rootPathAndLabel.rootLabel) !== undefined && duplicateMap.get(rootPathAndLabel.rootLabel)!.length > 1,
            );

            this.recurseUniqueLabels(duplicates);
        }
    }

    /**
     * Creates unique labels for a list of root paths, where Each label is a postfix of
     * the corresponding root path.
     * @param rootPaths the list of root paths that require unique labels
     * @returns a list of [root path, label] tuples where each label is unique
     */
    private createUniqueLabels(rootPaths: string[]): RootPathAndLabel[] {
        const rootPathsAndLabels: RootPathAndLabel[] = rootPaths.map(
            (rootPath) => ({ rootPath: rootPath, rootLabel: path.basename(rootPath) }) as RootPathAndLabel,
        );
        const rootLabels = rootPathsAndLabels.map((rootPathAndLabel) => rootPathAndLabel.rootLabel);

        if (new Set(rootLabels).size === rootPaths.length) {
            return rootPathsAndLabels;
        } else {
            // We have duplicates
            console.log("There are workspace root folders with the same name.");
            const duplicateMap = new Map<string, string[]>();

            // First pass over the array to determine duplicates
            for (const rootPathAndLabel of rootPathsAndLabels) {
                const duplicateEntry = duplicateMap.get(rootPathAndLabel.rootLabel);
                if (duplicateEntry === undefined) {
                    duplicateMap.set(rootPathAndLabel.rootLabel, [rootPathAndLabel.rootPath]);
                } else {
                    duplicateMap.set(rootPathAndLabel.rootLabel, duplicateEntry.concat(rootPathAndLabel.rootPath));
                }
            }

            // Second pass over the array to process duplicates
            const duplicates = rootPathsAndLabels.filter(
                (rootPathAndLabel) => duplicateMap.get(rootPathAndLabel.rootLabel) !== undefined && duplicateMap.get(rootPathAndLabel.rootLabel)!.length > 1,
            );
            for (const duplicateEntry of duplicates) {
                duplicateEntry.rootPath = path.parse(duplicateEntry.rootPath).dir;
            }

            this.recurseUniqueLabels(duplicates);
            for (const duplicateEntry of duplicates) {
                duplicateEntry.rootPath = path.join(duplicateEntry.rootPath, duplicateEntry.rootLabel);
            }
            return rootPathsAndLabels;
        }
    }

    /**
     * Get the unique label for a specific root path.
     * @param rootPath the path to the workspace root.
     * @returns the unique label of this workspace root.
     */
    getUniqueLabel(rootPath: string): string | undefined {
        const [wsRoot, _relativePath] = this.getCorrespondingRootAndPath(rootPath);
        return wsRoot?.getRootLabel();
    }

    /**
     * Sets up the workspace root folders, which are each instances of the WARoot class.
     * @returns An array of current the current WARoot instances.
     */
    private setupRoots(): WARoot[] {
        this.pathToRootMap.clear();
        this.pathToMultipleRootMap.clear();
        const roots: WARoot[] = [];
        if (vscode.workspace.workspaceFolders === undefined) {
            return roots;
        }

        const rootPathsAndLabels = this.createUniqueLabels(vscode.workspace.workspaceFolders.map((folder) => folder.uri.fsPath));
        for (const rootPathAndLabel of rootPathsAndLabels) {
            const root = new WARoot(rootPathAndLabel.rootPath, rootPathAndLabel.rootLabel);
            roots.push(root);
        }

        return roots;
    }

    /**
     * Checks whether there is more than one workspace root
     * @returns `true` if there is more than one workspace root and `false` otherwise
     */
    moreThanOneRoot(): boolean {
        return this.roots.length > 1;
    }

    /**
     * This function provides direct access to the current workspace roots.
     * @returns The array of the current WARoot instances.
     */
    getRoots(): WARoot[] {
        return this.roots;
    }

    /**
     * Removes a root based on its root path and removes all the corresponding
     * data from the CodeMarker.
     * @param rootPath The path to the workspace root.
     */
    private async removeRoot(rootPath: string): Promise<void> {
        for (const root of this.roots.filter((root) => root.rootPath === rootPath)) {
            for (const config of root.getConfigs()) {
                if (root.manageConfiguration(config, false)) {
                    // Remove the findings of outgoing roots from the MultiConfig and remove them from the tree
                    await vscode.commands.executeCommand("weAudit.toggleSavedFindings", config);
                }
            }
        }
        this.roots = this.roots.filter((root) => root.rootPath !== rootPath);
    }

    /**
     * Prompts the user to select a WARoot based on the root paths.
     * @returns The WARoot selected by the user or undefined.
     */
    private async selectRoot(): Promise<WARoot | undefined> {
        const allRootPaths = this.roots.map((root) => root.rootPath);
        const wsRootPath = await vscode.window.showQuickPick(allRootPaths, {
            ignoreFocusOut: true,
            title: "Choose workspace",
            placeHolder: "Choose workspace",
            canPickMany: false,
        });
        if (wsRootPath === undefined) {
            return;
        }
        const [wsRoot, _relativePath] = this.getCorrespondingRootAndPath(wsRootPath);
        return wsRoot;
    }

    /**
     * Checks whether the following path is contained in any of the current workspace roots.
     * @param path The absolute path to be checked.
     * @returns A triple containing the corresponding WARoot if it exists (undefined otherwise),
     * a string with the relative path to this root folder ("" otherwise), and a boolean stating
     * whether the path is in multiple workspace roots. If so, the path to the closest root is returned.
     */
    getCorrespondingRootAndPath(path: string): [WARoot | undefined, string, boolean] {
        const cached = this.pathToRootMap.get(path);
        if (cached !== undefined) {
            return cached;
        }

        // It is possible that there are multiple workspace roots containing each other.
        // While this is deeply cursed, let's try to handle it by returning the root that is closest.
        // This corresponds to the shortest relative path.
        let currentBest: [WARoot | undefined, string] = [undefined, ""];
        let currentDistance = -1;
        let inMultipleRoots = false;
        for (const root of this.roots) {
            const [inWS, relativePath] = root.isInThisWorkspaceRoot(path);
            if (inWS) {
                if (currentBest[0] === undefined) {
                    currentBest = [root, relativePath];
                    currentDistance = relativePath.length;
                    this.pathToRootMap.set(path, [root, relativePath, false]);
                } else {
                    console.log("Path is present in multiple workspace roots.");
                    inMultipleRoots = true;
                    if (relativePath.length < currentDistance) {
                        currentBest = [root, relativePath];
                        currentDistance = relativePath.length;
                        this.pathToRootMap.set(path, [root, relativePath, true]);
                    }
                }
            }
        }
        return [...currentBest, inMultipleRoots];
    }

    /**
     * Returns all workspace roots that contain this path. This function only exists to deal
     * with the deeply cursed scenario when a user adds workspace roots that are contained in
     * other workspace roots.
     * @param path The absolute path to be checked.
     * @returns A an array of tuples containing a WARoot and a string with the relative path
     * to that root folder.
     */
    getAllCorrespondingRootsAndPaths(path: string): [WARoot, string][] {
        const cached = this.pathToMultipleRootMap.get(path);
        if (cached !== undefined) {
            return cached;
        }

        const correspondingRootsAndPaths: [WARoot, string][] = [];

        for (const root of this.roots) {
            const [inWS, relativePath] = root.isInThisWorkspaceRoot(path);
            if (inWS) {
                correspondingRootsAndPaths.push([root, relativePath]);
            }
        }

        this.pathToMultipleRootMap.set(path, correspondingRootsAndPaths);
        return correspondingRootsAndPaths;
    }

    /**
     * Get the selected configurations of all workspace roots
     * @returns the selected configurations of all workspace roots
     */
    getSelectedConfigurations(): ConfigurationEntry[] {
        const currentlySelectedConfigs: ConfigurationEntry[] = [];
        for (const wsRoot of this.roots) {
            currentlySelectedConfigs.push(...wsRoot.getSelectedConfigurations());
        }
        return currentlySelectedConfigs;
    }

    /**
     * Given a configuration, checks whether it is selected
     * @param config the target configuration.
     * @returns true if it is selected, false if not.
     */
    isConfigurationSelected(config: ConfigurationEntry): boolean {
        const [wsRoot, _relativePath] = this.getCorrespondingRootAndPath(config.path);
        if (wsRoot === undefined) {
            return false;
        }
        return wsRoot.manageConfiguration(config, false);
    }

    /**
     * Given a configuration, toggle its selection status.
     * @param config the target configuration.
     */
    toggleConfiguration(config: ConfigurationEntry): void {
        const [wsRoot, _relativePath] = this.getCorrespondingRootAndPath(config.path);
        if (wsRoot === undefined) {
            return;
        }
        wsRoot.toggleConfiguration(config);
    }

    /**
     * Given the uri of the current file, finds the corresponding workspace root and returns a FullLocation
     * corresponding to the current selection of the user.
     * @param uri The uri of the current file.
     * @returns A FullLocation corresponding to the selection or undefined if the current file is not in any workspace root.
     */
    getActiveSelectionLocation(uri: vscode.Uri): FullLocation[] | undefined {
        const [wsRoot, _relativePath] = this.getCorrespondingRootAndPath(uri.fsPath);
        const result = wsRoot?.getActiveSelectionLocation();
        if (result === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error getting the current location. The file at ${uri.fsPath} is not in any workspace root.`);
        }
        return result;
    }

    /**
     * Given the `uri` of the current file, finds the corresponding workspace root and toggles the file as audited.
     * @param uri The `uri` of the current file.
     * @returns A list of `uri`s to be decorated and a list of relevant usernames
     * (or `undefined` and "" if the `uri` is not in any workspace root.)
     */
    toggleAudited(uri: vscode.Uri): [vscode.Uri[] | undefined, string[]] {
        const [closestRoot, closestRelativePath, inMultipleRoots] = this.getCorrespondingRootAndPath(uri.fsPath);
        if (closestRoot === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error marking a file as audited. The file at ${uri.fsPath} is not in any workspace root.`);
            // This file was not in any workspace root. No URIs to update.
            return [undefined, []];
        }

        if (!inMultipleRoots) {
            // Only in one workspace root: default behavior
            const [urisToDecorate, relevantUsername] = closestRoot.toggleAudited(uri, closestRelativePath);
            return [urisToDecorate, [relevantUsername]];
        } else {
            // In multiple workspace roots: stupid behavior
            const allRootsAndPaths = this.getAllCorrespondingRootsAndPaths(uri.fsPath);
            let isAudited = false;
            const urisToDecorateMultiple: vscode.Uri[] = [];
            const relevantUsernamesMultiple: string[] = [];

            // Check if the file is audited anywhere and remove it from there
            for (const [wsRoot, relativePath] of allRootsAndPaths) {
                if (wsRoot.isAudited(relativePath)) {
                    isAudited = true;
                    const [urisToAdd, relevantUsernameToAdd] = wsRoot.toggleAudited(uri, relativePath);
                    urisToDecorateMultiple.push(...urisToAdd);
                    relevantUsernamesMultiple.push(relevantUsernameToAdd);
                }
            }

            // If it was not audited anywhere, toggle it everywhere
            if (!isAudited) {
                for (const [wsRoot, relativePath] of allRootsAndPaths) {
                    const [urisToAdd, relevantUsernameToAdd] = wsRoot.toggleAudited(uri, relativePath);
                    urisToDecorateMultiple.push(...urisToAdd);
                    relevantUsernamesMultiple.push(relevantUsernameToAdd);
                }
            }

            return [urisToDecorateMultiple, relevantUsernamesMultiple];
        }
    }

    /**
     * Given the `uri` of the current file, finds the corresponding workspace root and toggles the file as partially audited.
     * @param uri The `uri` of the current file.
     */
    addPartiallyAudited(uri: vscode.Uri): void {
        const [wsRoot, relativePath] = this.getCorrespondingRootAndPath(uri.fsPath);
        if (wsRoot === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error adding a partially audited file. The file at ${uri.fsPath} is not in any workspace root.`);
            return;
        }
        wsRoot.addPartiallyAudited(relativePath);
    }

    /**
     * Updates the saved data for the given user.
     * @param username the username to update the saved data for
     */
    updateSavedData(username: string): void {
        //Iterate over all workspace roots
        for (const root of this.roots) {
            void root.updateSavedData(username);
        }
    }

    /**
     * Gives the merged marked files by daily log for all roots.
     * The paths are all extended to full.
     */
    getMarkedFilesDayLog(): Map<string, [FullPath, string][]> {
        const mergedMarkedFilesDayLog: Map<string, [FullPath, string][]> = new Map<string, [FullPath, string][]>();
        for (const root of this.roots) {
            root.markedFilesDayLog.forEach((value, key) => {
                const currentValue = mergedMarkedFilesDayLog.get(key);
                const updateValue = value.map((path) => [{ rootPath: root.rootPath, path: path } as FullPath, root.getRootLabel()] as [FullPath, string]);
                if (currentValue === undefined) {
                    mergedMarkedFilesDayLog.set(key, updateValue);
                } else {
                    mergedMarkedFilesDayLog.set(key, currentValue.concat(updateValue));
                }
            });
        }
        return mergedMarkedFilesDayLog;
    }

    /**
     * Creates a unique path in case of a multi-root workspace.
     * This assumes that there are no workspace roots with the same folder name.
     * @param rootPath the path of the workspace root
     * @param relativePath the relative path of the target
     * @returns the unique path or undefined if the rootPath does not correspond to a current workspace root
     */
    createUniquePath(rootPath: string, relativePath: string): string | undefined {
        const [wsRoot, _relativePath] = this.getCorrespondingRootAndPath(rootPath);
        if (wsRoot === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error creating unique path. Filepath: ${rootPath} is not a workspace root.`);
            return undefined;
        }
        const rootLabel = wsRoot.getRootLabel();
        if (rootLabel !== "") {
            return path.join(rootLabel, relativePath);
        } else {
            vscode.window.showWarningMessage(
                `weAudit: Warning! It looks like your root path ${rootPath} is at the root of your filesystem. This is deeply cursed.`,
            );
            return path.join("/", relativePath);
        }
    }
}
