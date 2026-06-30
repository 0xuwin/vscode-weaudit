import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { FromLocationResponse } from "./externalTypes";
import { userInfo } from "os";
import { spawnSync } from "child_process";
import { plot } from "asciichart";

import { ResolvedEntries } from "./resolvedFindings";
import { labelAfterFirstLineTextDecoration, hoverOnLabel, DecorationManager } from "./decorationManager";
import { activateFindingBoundaryCodeLens } from "./findingBoundaryCodeLens";
import {
    Entry,
    FullEntry,
    TreeEntry,
    TreeViewMode,
    Location,
    FullLocation,
    FullLocationEntry,
    isLocationEntry,
    isEntry,
    isOldEntry,
    Repository,
    createDefaultEntryDetails,
    createLocationEntry,
    isPathOrganizerEntry,
    EntryType,
    RemoteAndPermalink,
    DetailValue,
    createPathOrganizer,
    getEntryIndexFromArray,
    treeViewModeLabel,
    PartiallyAuditedFile,
    FullSerializedData,
    ConfigurationEntry,
    RootPathAndLabel,
} from "./types";
import { normalizePathForOS } from "./utilities/normalizePath";
import { generateSourcePermalink } from "./permalinks/permalink";
import { resolveProjectRepository } from "./projectConfig/resolution";
import { getProjectConfigPath, projectConfigExists, readProjectConfig } from "./projectConfig/storage";
import { isValidProjectConfig, validateProjectConfig } from "./projectConfig/validation";
import { loadFindingLabelTemplate, loadFindingSchema } from "./findingSchema/settings";
import { createEntryDetailsFromSchema } from "./findingSchema/defaults";
import { renderLabelTemplate } from "./findingSchema/labelTemplate";
import { renderFindingMarkdown } from "./markdown/findingMarkdown";
import { DragAndDropController } from "./tree/dragAndDropController";
import { WARoot } from "./workspace/workspaceRoot";
import { MultiRootManager } from "./workspace/multiRootManager";
import { isRecentlySelfWrittenAuditStateFile } from "./auditState/writeTracker";

export class CodeMarker implements vscode.TreeDataProvider<TreeEntry> {
    private static readonly reloadAuditStateDebounceMs = 500;

    // treeEntries contains the currently active entries: findings and notes
    private treeEntries: FullEntry[];

    // resolvedEntries contains all entries that have been resolved
    private resolvedEntries: FullEntry[];

    private workspaces: MultiRootManager;
    private username: string;

    // pathToEntryMap associates a path label with the actual tree entries (location entries) rendered for that file
    private pathToEntryMap: Map<string, FullLocationEntry[]>;
    private pathToEntryMapDirty = true;
    private locationEntryCache = new WeakMap<FullLocation, FullLocationEntry>();

    private treeViewMode: TreeViewMode;

    private _onDidChangeFileDecorationsEmitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorationsEmitter.event;

    private _onDidChangeTreeDataEmitter = new vscode.EventEmitter<FullEntry | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeDataEmitter.event;

    private resolvedEntriesTree: ResolvedEntries;

    private decorationManager: DecorationManager;
    private decorationsEnabled = true;

    // Cached configuration for sorting entries alphabetically
    private sortEntriesAlphabetically: boolean;

    // State for navigating through partially audited regions
    private currentPartiallyAuditedIndex = -1;
    private reloadAuditStateTimer: NodeJS.Timeout | undefined;

    constructor(context: vscode.ExtensionContext, decorationManager: DecorationManager) {
        this.treeEntries = [];
        this.resolvedEntries = [];

        this.workspaces = new MultiRootManager(context);

        this.decorationManager = decorationManager;

        this.pathToEntryMap = new Map<string, FullLocationEntry[]>();

        this.treeViewMode = TreeViewMode.List;
        this.loadTreeViewModeConfiguration();

        this.sortEntriesAlphabetically = this.loadSortEntriesConfiguration();

        this.username = this.setUsernameConfigOrDefault();
        this.findAndLoadConfigurationUsernames();
        this.resolvedEntriesTree = new ResolvedEntries(context, this.resolvedEntries);

        vscode.commands.executeCommand("weAudit.refreshSavedFindings", this.workspaces.getSelectedConfigurations());

        this.decorate();

        // Pushes the roots and currently selected configurations to the MultiConfig
        vscode.commands.registerCommand("weAudit.getMultiConfigRoots", () => {
            const rootPathsAndLabels = this.workspaces
                .getRoots()
                .map((root) => ({ rootPath: root.rootPath, rootLabel: root.getRootLabel() }) as RootPathAndLabel);
            vscode.commands.executeCommand("weAudit.setMultiConfigRoots", rootPathsAndLabels);
            vscode.commands.executeCommand("weAudit.refreshSavedFindings", this.workspaces.getSelectedConfigurations());
        });

        const registerInitializedCommand = <T extends unknown[]>(command: string, callback: (...args: T) => unknown): void => {
            context.subscriptions.push(
                vscode.commands.registerCommand(command, (...args: T) => {
                    if (!this.ensureActiveWorkspaceInitialized()) {
                        return;
                    }
                    return callback(...args);
                }),
            );
        };

        const registerInitializedTextEditorCommand = (command: string, callback: () => unknown): void => {
            context.subscriptions.push(
                vscode.commands.registerTextEditorCommand(command, () => {
                    if (!this.ensureActiveWorkspaceInitialized()) {
                        return;
                    }
                    return callback();
                }),
            );
        };

        registerInitializedCommand("weAudit.toggleAudited", () => {
            this.toggleAudited();
        });

        registerInitializedCommand("weAudit.addPartiallyAudited", () => {
            this.addPartiallyAudited();
        });

        registerInitializedCommand("weAudit.toggleFindingsHighlighting", () => {
            this.decorationsEnabled = !this.decorationsEnabled;
            this.decorate();
        });

        context.subscriptions.push(
            vscode.commands.registerCommand("weAudit.reloadFindingsFromDisk", () => {
                this.reloadFindingsFromDisk();
            }),
        );

        this.registerAuditStateWatcher(context);
        context.subscriptions.push({
            dispose: () => {
                if (this.reloadAuditStateTimer !== undefined) {
                    clearTimeout(this.reloadAuditStateTimer);
                    this.reloadAuditStateTimer = undefined;
                }
            },
        });

        registerInitializedCommand("weAudit.toggleTreeViewMode", () => {
            this.toggleTreeViewMode();
        });

        registerInitializedCommand("weAudit.addFinding", () => {
            this.addFinding();
        });

        registerInitializedCommand("weAudit.addNote", () => {
            this.addNote();
        });

        registerInitializedCommand("weAudit.navigateToNextPartiallyAuditedRegion", () => {
            this.navigateToNextPartiallyAuditedRegion();
        });

        registerInitializedCommand("weAudit.resolveFinding", (node: FullEntry) => {
            this.resolveFinding(node);
        });

        registerInitializedCommand("weAudit.deleteFinding", (node: FullEntry) => {
            this.deleteFinding(node);
        });

        registerInitializedCommand("weAudit.editLocationEntry", (node: FullLocationEntry) => {
            void this.editLocationEntryDescription(node);
        });

        registerInitializedCommand("weAudit.restoreFinding", (node: FullEntry) => {
            this.restoreFinding(node);
        });

        registerInitializedCommand("weAudit.deleteResolvedFinding", (node: FullEntry) => {
            this.deleteResolvedFinding(node);
        });

        registerInitializedCommand("weAudit.deleteAllResolvedFinding", () => {
            this.deleteAllResolvedFindings();
        });

        registerInitializedCommand("weAudit.restoreAllResolvedFindings", () => {
            this.restoreAllResolvedFindings();
        });

        registerInitializedCommand("weAudit.deleteLocationUnderCursor", () => {
            const entry = this.getLocationUnderCursor();
            if (entry) {
                const toDelete = isEntry(entry) ? createLocationEntry(entry.locations[0], entry) : entry;
                this.deleteLocation(toDelete);
            }
        });

        registerInitializedCommand("weAudit.copyEntryPermalink", (entry: FullEntry | FullLocationEntry) => {
            void this.copyEntryPermalink(entry);
        });

        registerInitializedCommand("weAudit.copyEntryPermalinks", (entry: FullEntry) => {
            void this.copyEntryPermalinks(entry);
        });

        registerInitializedTextEditorCommand("weAudit.copySelectedCodePermalink", () => {
            void this.copySelectedCodePermalink(Repository.Audit);
        });

        registerInitializedTextEditorCommand("weAudit.copySelectedCodeClientPermalink", () => {
            void this.copySelectedCodePermalink(Repository.Client);
        });

        /**
         * Copies finding Markdown. Warning: this command is used by Sarif Explorer and should at least accept Entry types.
         * Sarif explorer will always provide absolute paths as location paths, so it should be possible to find the corresponding workspace root.
         *  */
        registerInitializedCommand("weAudit.copyFindingAsMarkdown", (entry: Entry | FullEntry | FullLocationEntry) => {
            let actualEntries: FullEntry[];
            if (isOldEntry(entry)) {
                // This is the Sarif Explorer case. Location paths are absolute paths.

                // First check that all locations are inside one of the workspace roots:
                for (const loc of entry.locations) {
                    const [wsRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(loc.path);
                    if (wsRoot === undefined) {
                        vscode.window.showErrorMessage(`Failed to copy finding as Markdown. The file ${loc.path} is not in any workspace root.`);
                        return;
                    }
                }

                const splitEntries = this.splitLocationsFromEntry(entry);
                actualEntries = splitEntries.map(
                    (entry) =>
                        ({
                            label: entry.label,
                            entryType: entry.entryType,
                            author: entry.author,
                            details: entry.details,
                            locations: entry.locations.map((loc) => {
                                // transform absolute paths to relative paths to the workspace path
                                const [wsRoot, relativePath] = this.workspaces.getCorrespondingRootAndPath(loc.path);
                                return {
                                    path: relativePath,
                                    startLine: loc.startLine,
                                    endLine: loc.endLine,
                                    label: loc.label,
                                    codeSnippet: loc.codeSnippet,
                                    rootPath: wsRoot!.rootPath,
                                } as FullLocation;
                            }),
                        }) as FullEntry,
                );
            } else {
                // This is the weAudit internal case, entries are either FullEntry or FullLocationEntry
                const actualEntry = isLocationEntry(entry) ? entry.parentEntry : entry;

                // First check that all locations are inside one of the workspace roots:
                for (const loc of actualEntry.locations) {
                    const fullPath = path.join(loc.rootPath, loc.path);
                    const [wsRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(loc.rootPath);
                    if (wsRoot === undefined) {
                        vscode.window.showErrorMessage(`Failed to copy finding as Markdown. The file ${fullPath} is not in any workspace root.`);
                        return;
                    }
                }

                actualEntries = [actualEntry];
            }

            void this.copyEntriesAsMarkdown(actualEntries);
        });

        // This command takes a configuration file, toggles its current selection, and shows/hides the corresponding findings
        vscode.commands.registerCommand("weAudit.toggleSavedFindings", (config: ConfigurationEntry) => {
            // Push configuration entry if not already in list, remove otherwise.

            // Toggle a specific config file
            const isSelected = this.workspaces.isConfigurationSelected(config);
            const savedData = this.loadSavedDataFromConfig(config, true, !isSelected);
            this.workspaces.toggleConfiguration(config);

            // refresh the currently selected files, findings tree and file decorations
            vscode.commands.executeCommand("weAudit.refreshSavedFindings", this.workspaces.getSelectedConfigurations());
            this.resolvedEntriesTree.setResolvedEntries(this.resolvedEntries);
            this.refreshTree();
            this.decorate();
            if (!savedData) {
                return;
            }
            // trigger the file decoration event so that the file decorations are updated
            for (const entry of savedData.treeEntries) {
                for (const loc of entry.locations) {
                    const uri = vscode.Uri.file(path.join(loc.rootPath, loc.path));
                    this._onDidChangeFileDecorationsEmitter.fire(uri);
                }
            }
        });

        registerInitializedCommand("weAudit.updateCurrentSelectedEntry", (field: string, value: DetailValue, isPersistent: boolean) => {
            this.updateCurrentlySelectedEntry(field, value, isPersistent);
        });

        // This command is used by Sarif Explorer and requires accepting Entry types.
        registerInitializedCommand("weAudit.externallyLoadFindings", (results: Entry[]) => {
            // First check that all locations are inside one of the workspace roots:
            for (const result of results) {
                for (const loc of result.locations) {
                    const [wsRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(loc.path);
                    if (wsRoot === undefined) {
                        vscode.window.showErrorMessage(`Failed to load external findings. The file ${loc.path} is not in any workspace root.`);
                        return;
                    }
                }
            }

            const indicesToRemove: number[] = [];
            const entriesToPush: Entry[] = [];

            results.forEach((result, ind) => {
                const splitEntries = this.splitLocationsFromEntry(result);

                // If it contains only one entry, there was nothing to split
                if (splitEntries.length > 1) {
                    indicesToRemove.push(ind);
                    entriesToPush.push(...splitEntries);
                }
            });

            for (const index of indicesToRemove.reverse()) {
                results.splice(index, 1);
            }

            results.push(...entriesToPush);

            const fullResults = results.map(
                (entry) =>
                    ({
                        label: entry.label,
                        entryType: entry.entryType,
                        author: entry.author,
                        details: entry.details,
                        locations: entry.locations.map((loc) => {
                            // transform absolute paths to relative paths to the workspace path
                            const [wsRoot, relativePath] = this.workspaces.getCorrespondingRootAndPath(loc.path);
                            return {
                                path: relativePath,
                                startLine: loc.startLine,
                                endLine: loc.endLine,
                                label: loc.label,
                                codeSnippet: loc.codeSnippet,
                                rootPath: wsRoot!.rootPath,
                            } as FullLocation;
                        }),
                    }) as FullEntry,
            );

            this.externallyLoadFindings(fullResults);
        });

        registerInitializedCommand("weAudit.showMarkedFilesDayLog", () => {
            this.showMarkedFilesDayLog();
        });

        // This command is only used by Sarif Explorer, which will provide a location with an absolute path
        registerInitializedCommand("weAudit.getClientPermalink", (location: Location) => {
            const [wsRoot, relativePath] = this.workspaces.getCorrespondingRootAndPath(location.path);
            if (wsRoot === undefined) {
                vscode.window.showErrorMessage(`Failed to get Client Permalink. The file ${location.path} is not in any workspace root.`);
                return;
            }

            const fullLocation = {
                path: relativePath,
                startLine: location.startLine,
                endLine: location.endLine,
                label: location.label,
                codeSnippet: location.codeSnippet,
                rootPath: wsRoot.rootPath,
            } as FullLocation;

            return this.getClientPermalink(fullLocation);
        });

        registerInitializedCommand("weAudit.addRegionToAnEntry", () => {
            void this.addRegionToAnEntry();
        });

        registerInitializedCommand("weAudit.addRegionToAnEntryWithLabel", () => {
            void this.addRegionToAnEntryWithLabel();
        });

        registerInitializedCommand("weAudit.deleteLocation", (entry: FullLocationEntry) => {
            this.deleteLocation(entry);
        });

        registerInitializedCommand("weAudit.showFindingsSearchBar", () => {
            void this.showFindingsSearchBar();
        });

        registerInitializedCommand("weAudit.exportFindingsInMarkdown", () => {
            void this.exportFindingsInMarkdown();
        });

        // Gets the filtered entries from the current tree that correspond to a specific username and workspace root
        vscode.commands.registerCommand("weAudit.getFilteredEntriesForSaving", (username: string, root: WARoot) => {
            return this.getFilteredEntriesForSaving(username, root);
        });

        // ======== PUBLIC INTERFACE ========
        registerInitializedCommand("weAudit.getCodeToCopyFromLocation", (entry: FullEntry | FullLocationEntry) => {
            return this.getCodeToCopyFromLocation(entry);
        });

        registerInitializedCommand("weAudit.getSelectedClientCodeAndPermalink", () => {
            return this.getSelectedClientCodeAndPermalink();
        });
    }

    /**
     * Watches .weaudit files so external edits can be reflected in the tree and editor decorations.
     */
    private registerAuditStateWatcher(context: vscode.ExtensionContext): void {
        const watcher = vscode.workspace.createFileSystemWatcher("**/.vscode/*.weaudit");
        context.subscriptions.push(watcher);

        watcher.onDidCreate((uri) => this.scheduleReloadFindingsFromDisk(uri, false), undefined, context.subscriptions);
        watcher.onDidChange((uri) => this.scheduleReloadFindingsFromDisk(uri, false), undefined, context.subscriptions);
        watcher.onDidDelete((uri) => this.scheduleReloadFindingsFromDisk(uri, true), undefined, context.subscriptions);
    }

    /**
     * Debounces external .weaudit changes before reloading them from disk.
     */
    private scheduleReloadFindingsFromDisk(uri: vscode.Uri, isDelete: boolean): void {
        if (!isDelete && isRecentlySelfWrittenAuditStateFile(uri.fsPath)) {
            return;
        }

        if (this.reloadAuditStateTimer !== undefined) {
            clearTimeout(this.reloadAuditStateTimer);
        }

        this.reloadAuditStateTimer = setTimeout(() => {
            this.reloadAuditStateTimer = undefined;
            this.reloadFindingsFromDisk();
        }, CodeMarker.reloadAuditStateDebounceMs);
    }

    /**
     * Reloads currently selected .weaudit files from disk and refreshes all visible UI state.
     */
    reloadFindingsFromDisk(): void {
        const selectedConfigurations = [...this.workspaces.getSelectedConfigurations()];
        for (const config of selectedConfigurations) {
            if (!fs.existsSync(config.path)) {
                this.unloadSavedDataFromConfig(config);
                continue;
            }

            let parsedData: FullSerializedData | undefined;
            try {
                parsedData = this.loadSavedDataFromConfig(config, false, false);
            } catch (error) {
                vscode.window.showWarningMessage(`weAudit: Skipped reloading invalid audit state file ${config.path}: ${String(error)}`);
                continue;
            }
            if (parsedData === undefined) {
                vscode.window.showWarningMessage(`weAudit: Skipped reloading invalid audit state file ${config.path}.`);
                continue;
            }

            this.unloadSavedDataFromConfig(config);
            try {
                this.loadSavedDataFromConfig(config, true, true);
            } catch (error) {
                vscode.window.showWarningMessage(`weAudit: Failed to reload audit state file ${config.path}: ${String(error)}`);
            }
        }

        this.resolvedEntriesTree.setResolvedEntries(this.resolvedEntries);
        this.refreshTree();
        this.decorate();
        vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
    }

    /**
     * Removes the in-memory state associated with a saved .weaudit configuration.
     */
    private unloadSavedDataFromConfig(config: ConfigurationEntry): void {
        const [wsRoot] = this.workspaces.getCorrespondingRootAndPath(config.path);
        if (wsRoot === undefined) {
            return;
        }

        this.treeEntries = this.treeEntries.filter(
            (entry) =>
                entry.author !== config.username ||
                entry.locations.findIndex((loc) => this.workspaces.getUniqueLabel(loc.rootPath) !== config.root.label) !== -1,
        );
        wsRoot.filterAudited(config.username);
        wsRoot.filterPartiallyAudited(config.username);
        this.resolvedEntries = this.resolvedEntries.filter(
            (entry) =>
                entry.author !== config.username ||
                entry.locations.findIndex((loc) => this.workspaces.getUniqueLabel(loc.rootPath) !== config.root.label) !== -1,
        );
        this.markPathMapDirty();
    }

    /**
     * Ensures the active workspace root has been initialized with .vscode/info.json before user commands run.
     */
    ensureActiveWorkspaceInitialized(): boolean {
        const workspaceRoot = this.getActiveWorkspaceRootPath();
        if (workspaceRoot === undefined) {
            vscode.window.showErrorMessage("weAudit: Open a workspace folder and run 'weAudit: Initialize Project Config' before using weAudit commands.");
            return false;
        }

        if (!projectConfigExists(workspaceRoot)) {
            const root = this.workspaces.getRoots().find((item) => item.rootPath === workspaceRoot);
            const rootLabel = root?.getRootLabel() ?? workspaceRoot;
            vscode.window.showErrorMessage(`weAudit: Project config missing for ${rootLabel}. Run 'weAudit: Initialize Project Config' first.`);
            return false;
        }

        return true;
    }

    /**
     * Returns the workspace root for the active editor, falling back to the only opened root.
     */
    private getActiveWorkspaceRootPath(): string | undefined {
        const roots = this.workspaces.getRoots();
        if (roots.length === 0) {
            return;
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor !== undefined) {
            const [activeRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(activeEditor.document.fileName);
            if (activeRoot !== undefined) {
                return activeRoot.rootPath;
            }
        }

        if (roots.length === 1) {
            return roots[0].rootPath;
        }

        return;
    }

    public setUsernameConfigOrDefault(): string {
        this.username = vscode.workspace.getConfiguration("weAudit").get("general.username") || userInfo().username;
        return this.username;
    }

    /**
     * Exports the findings to a markdown file
     * allowing the user to select which findings to export
     */
    private async exportFindingsInMarkdown(): Promise<void> {
        if (this.treeEntries.length === 0) {
            vscode.window.showInformationMessage("No findings to export.");
            return;
        }

        const items = this.treeEntries.map((entry) => {
            return {
                label: entry.label,
                entry: entry,
                iconPath: entry.entryType === EntryType.Note ? new vscode.ThemeIcon("bookmark") : new vscode.ThemeIcon("bug"),
                picked: true,
            };
        });

        const selectedEntries = await vscode.window.showQuickPick(items, {
            ignoreFocusOut: true,
            title: "Select the findings to export to markdown",
            canPickMany: true,
        });

        if (selectedEntries === undefined || selectedEntries.length === 0) {
            return;
        }

        let markdown = "";
        for (const entry of selectedEntries) {
            const entryMarkdown = renderFindingMarkdown(entry.entry, loadFindingSchema());
            markdown += `---\n---\n---\n${entryMarkdown}\n\n`;
        }

        vscode.workspace
            .openTextDocument({
                language: "markdown",
                content: markdown,
            })
            .then((doc) => {
                vscode.window.showTextDocument(doc);
            });
    }

    private async showFindingsSearchBar(): Promise<void> {
        await vscode.commands.executeCommand("codeMarker.focus");
        // list.find opens the current view's search bar
        // https://stackoverflow.com/questions/68208883/filtering-a-treeview
        await vscode.commands.executeCommand("list.find");
    }

    getSelectedClientCodeAndPermalink(): FromLocationResponse | void {
        const locations = this.getActiveSelectionLocation();
        if (locations === undefined || locations.length === 0) {
            return;
        }

        // Use the first (primary) selection if more than one is present
        const location = locations[0];
        const editor = vscode.window.activeTextEditor!;

        const remoteAndPermalink = this.getRemoteAndPermalink(location);
        if (remoteAndPermalink === undefined) {
            return;
        }
        // we don't use editor.document.getText(selection) because we want to copy full lines
        const range = new vscode.Range(
            new vscode.Position(location.startLine, 0),
            new vscode.Position(location.endLine, editor.document.lineAt(location.endLine).text.length),
        );
        const codeToCopy = editor.document.getText(range);

        return { codeToCopy: codeToCopy, permalink: remoteAndPermalink.permalink };
    }

    async getCodeToCopyFromLocation(entry: FullEntry | FullLocationEntry): Promise<FromLocationResponse | void> {
        const location = isLocationEntry(entry) ? entry.location : entry.locations[0];
        const permalink = this.getClientPermalink(location);
        if (permalink === undefined) {
            return;
        }
        const codeToCopy = await this.getLocationCode(location);
        return { codeToCopy, permalink };
    }

    /**
     * When Sarif Explorer provides entries, it does not know anything about workspace roots.
     * So the locations inside the entries can correspond to multiple workspace roots.
     * This function splits out entries into one entry per workspace root.
     * @param entry The entry provided by Sarif Explorer
     * @returns An array containing one entry per workspace root in the locations of the original entry
     */
    splitLocationsFromEntry(entry: Entry): Entry[] {
        const splitEntries: Entry[] = [];

        const allRoots: Set<WARoot> = new Set(
            entry.locations.map((loc) => {
                const [wsRoot] = this.workspaces.getCorrespondingRootAndPath(loc.path);
                return wsRoot!;
            }),
        );

        if (allRoots.size > 1) {
            for (const root of allRoots) {
                const newLocations = entry.locations.filter((loc) => {
                    const [wsRoot] = this.workspaces.getCorrespondingRootAndPath(loc.path);
                    return root === wsRoot;
                });
                const newEntry = {
                    label: entry.label,
                    entryType: entry.entryType,
                    author: entry.author,
                    details: entry.details,
                    locations: newLocations,
                } as Entry;

                splitEntries.push(newEntry);
            }
        } else {
            splitEntries.push(entry);
        }

        return splitEntries;
    }

    externallyLoadFindings(entries: FullEntry[]): void {
        const authors = new Set<string>();

        for (const entry of entries) {
            // If we have the exact same entry in resolved entries, don't do anything
            const idxResolved = getEntryIndexFromArray(entry, this.resolvedEntries);
            if (idxResolved !== -1) {
                continue;
            }

            // If we have the exact same entry in tree entries, don't do anything
            const idx = getEntryIndexFromArray(entry, this.treeEntries);
            if (idx !== -1) {
                continue;
            }

            // If we have a similar entry (same author and title) in tree entries, modify the existing entry
            let foundSimilarEntry = false;
            for (const e of this.treeEntries) {
                if (e.author === entry.author && e.label === entry.label && e.locations[0]?.rootPath === entry.locations[0]?.rootPath) {
                    // We do not update the details because these may have been modified by the user
                    // We do not remove locations; we only add the ones that are missing
                    for (const loc of entry.locations) {
                        const idx = e.locations.findIndex((l) => l.path === loc.path && l.startLine === loc.startLine && l.endLine === loc.endLine);
                        if (idx === -1) {
                            e.locations.push(loc);
                        }
                    }
                    this.refreshAndDecorateEntry(e);
                    authors.add(e.author);
                    foundSimilarEntry = true;
                    break;
                }
            }

            // If we did not find a similar entry, add the entry to the tree entries
            if (!foundSimilarEntry) {
                this.treeEntries.push(entry);
                this.refreshAndDecorateEntry(entry);
                authors.add(entry.author);
                continue;
            }
        }

        if (authors.size > 0) {
            for (const author of authors) {
                void this.updateSavedData(author);
            }
            // call findAndLoadConfigurationFiles to refresh the Saved Finding Files list
            vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
        }
    }

    updateCurrentlySelectedEntry(field: string, value: DetailValue, isPersistent: boolean): void {
        if (treeView.selection.length === 0) {
            return;
        }

        let entry = treeView.selection[0];

        if (isPathOrganizerEntry(entry)) {
            return;
        }

        // Determine if it is an additional location;
        // if so, we need to find it's parent entry and update that instead
        if (isLocationEntry(entry)) {
            entry = entry.parentEntry;
        }

        switch (field) {
            case "title":
            case "label": {
                const title = String(value ?? "");
                entry.details.title = title;
                if (entry.entryType === EntryType.Finding) {
                    this.applyFindingLabelTemplate(entry);
                } else {
                    entry.label = title;
                }
                this.refreshTree();
                this.refreshAndDecorateEntry(entry);
                treeView.reveal(entry);
                break;
            }
            default:
                entry.details[field] = value;
                this.applyFindingLabelTemplate(entry);
                this.refreshTree();
                this.refreshAndDecorateEntry(entry);
                break;
        }

        if (field === "severity") {
            entry.details.severity = String(value ?? "");
        }
        if (field === "description") {
            entry.details.description = String(value ?? "");
        }

        if (isPersistent) {
            void this.updateSavedData(entry.author);
        }
    }

    /**
     * Applies the configured label template to findings while leaving notes unchanged.
     */
    private applyFindingLabelTemplate(entry: FullEntry): void {
        if (entry.entryType !== EntryType.Finding) {
            return;
        }
        const renderedLabel = renderLabelTemplate(loadFindingLabelTemplate(), entry.details).trim();
        entry.label = renderedLabel === "" ? entry.details.title : renderedLabel;
    }

    /**
     * Loads the tree view mode from the configuration and updates the tree view mode,
     * refreshing the tree.
     */
    loadTreeViewModeConfiguration(): void {
        const mode: string = vscode.workspace.getConfiguration("weAudit").get("general.treeViewMode")!;
        if (mode === "list") {
            this.treeViewMode = TreeViewMode.List;
        } else {
            this.treeViewMode = TreeViewMode.GroupByFile;
        }
        this.refreshTree();
    }

    /**
     * Loads the sort entries alphabetically setting from the configuration,
     * refreshing the tree.
     *
     * Returns the current value of the setting after loading it from the configuration.
     */
    loadSortEntriesConfiguration(): boolean {
        this.sortEntriesAlphabetically = vscode.workspace.getConfiguration("weAudit").get<boolean>("general.sortEntriesAlphabetically", false);
        this.refreshTree();
        return this.sortEntriesAlphabetically;
    }

    getTreeViewMode(): TreeViewMode {
        return this.treeViewMode;
    }

    /**
     * Toggles the tree view mode between linear and organized per file,
     * updates the configuration and
     * refreshes the tree.
     */
    toggleTreeViewMode(): void {
        if (this.treeViewMode === TreeViewMode.List) {
            this.treeViewMode = TreeViewMode.GroupByFile;
        } else {
            this.treeViewMode = TreeViewMode.List;
        }
        const label = treeViewModeLabel(this.treeViewMode);
        void vscode.workspace.getConfiguration("weAudit").update("general.treeViewMode", label, true);
        this.refreshTree();
    }

    /**
     * Because most of the handling is now done by the MultiRootManager
     * and the individual WARoot constructors, this function merely loads
     * saved data from all configuration files
     */
    findAndLoadConfigurationUsernames(): void {
        for (const configEntry of this.workspaces.getSelectedConfigurations()) {
            this.loadSavedDataFromConfig(configEntry, true, true);
        }
        vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
    }

    /**
     * Toggles the current active file as audited or not audited.
     * Fires the onDidChangeFileDecorationsEmitter event if applicable.
     */
    toggleAudited(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return;
        }
        const uri = editor.document.uri;

        const [urisToDecorate, relevantUsernames] = this.workspaces.toggleAudited(uri);
        if (urisToDecorate !== undefined) {
            for (const uriToDecorate of urisToDecorate) {
                this._onDidChangeFileDecorationsEmitter.fire(uriToDecorate);
            }
        }
        // update decorations
        this.decorateWithUri(uri);
        for (const relevantUsername of relevantUsernames) {
            void this.updateSavedData(relevantUsername);
        }
        this.refresh(uri);
    }

    addPartiallyAudited(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return;
        }
        const uri = editor.document.uri;

        // Since partially audited files are maintained separately for each workspace root, use the MultiRootManager
        this.workspaces.addPartiallyAudited(uri);
        // update decorations
        this.decorateWithUri(uri);
        void this.updateSavedData(this.username);
    }

    private navigateToNextPartiallyAuditedRegion(): void {
        // Collect all partially audited regions from all workspace roots
        const allPartiallyAuditedRegions: { file: PartiallyAuditedFile; rootPath: string }[] = [];

        for (const wsRoot of this.workspaces.getRoots()) {
            const partiallyAuditedFiles = wsRoot.getPartiallyAudited();
            for (const file of partiallyAuditedFiles) {
                allPartiallyAuditedRegions.push({
                    file,
                    rootPath: wsRoot.rootPath,
                });
            }
        }

        if (allPartiallyAuditedRegions.length === 0) {
            return;
        }

        // Sort regions by file path, then by start line for consistent navigation order
        allPartiallyAuditedRegions.sort((a, b) => {
            const pathComparison = a.file.path.localeCompare(b.file.path);
            if (pathComparison !== 0) {
                return pathComparison;
            }
            return a.file.startLine - b.file.startLine;
        });

        // Update navigation index
        this.currentPartiallyAuditedIndex = (this.currentPartiallyAuditedIndex + 1) % allPartiallyAuditedRegions.length;

        const targetRegion = allPartiallyAuditedRegions[this.currentPartiallyAuditedIndex];
        const uri = vscode.Uri.file(path.join(targetRegion.rootPath, targetRegion.file.path));

        // Navigate to the region using the same pattern as tree entries
        vscode.commands.executeCommand("weAudit.openFileLines", uri, targetRegion.file.startLine, targetRegion.file.endLine);
    }

    /**
     * Creates and shows a representation of
     * the marked files by daily log, in markdown format.
     */
    showMarkedFilesDayLog(): void {
        // Since audited files are maintained separately for each workspace root, use the MultiRootManager
        const markedFilesDayLog = this.workspaces.getMarkedFilesDayLog();

        // sort the keys of the map by date
        const sortedDates = new Map(Array.from(markedFilesDayLog).sort(([a], [b]) => Date.parse(a) - Date.parse(b)));
        const asciiArrayData = new Array(sortedDates.keys.length);
        let idxDataArray = 0;

        let logString = "";
        let totalLOC = 0;

        for (const [date, files] of sortedDates) {
            if (files && files.length > 0) {
                let filesString = `## ${date}\n - `;
                filesString += files.map(([fullPath, rootLabel]) => path.join(rootLabel, fullPath.path)).join("\n - ");
                logString += `${filesString}\n\n`;

                // count the LOC per day
                const fullPaths = files.map(([fullPath]) => path.join(fullPath.rootPath, fullPath.path));
                const wcProc = spawnSync("wc", ["-l", ...fullPaths]);
                const output = wcProc.output[1]!;
                // wc outputs a final total line.
                // We get the LOC from that line by finding the first newline from the end.
                const idx = output.length - " total\n".length;
                let i = idx;
                for (i = idx; i >= 0; --i) {
                    // 10 is the ascii code for newline
                    if (output[i] === 10) {
                        break;
                    }
                }
                const loc = parseInt(output.slice(i + 1, idx).toString());
                totalLOC += loc;
                logString += `Daily LOC: ${loc}\n\n`;

                // add a separator
                logString += "---\n\n";

                // add to the graph
                asciiArrayData[idxDataArray] = loc;

                idxDataArray++;
            }
        }

        // exit if no files have been marked yet
        if (logString === "") {
            vscode.window.showInformationMessage("No files have been marked as reviewed.");
            return;
        }

        // add the total LOC to the log
        logString += `Total LOC: ${totalLOC}\n\n`;

        logString += plot(asciiArrayData, { height: 8 });
        vscode.workspace
            .openTextDocument({
                language: "markdown",
                content: logString,
            })
            .then((doc) => {
                vscode.window.showTextDocument(doc).then((editor) => {
                    // reveal the last line of the document
                    const lastLine = doc.lineAt(doc.lineCount - 1);
                    editor.revealRange(lastLine.range);
                });
            });
    }

    async editLocationEntryDescription(locationEntry: FullLocationEntry): Promise<void> {
        const label = await vscode.window.showInputBox({
            title: `Edit location label`,
            value: locationEntry.location.label,
            ignoreFocusOut: true,
        });
        if (label === undefined) {
            return;
        }
        locationEntry.location.label = label;

        this.refreshTree();
        this.decorate();
        void this.updateSavedData(locationEntry.parentEntry.author);
    }

    /**
     * Get the git remote and the permalink for the given code region
     * @param startLine The start line of the code region
     * @param endLine The end line of the code region
     * @param path The path of the file
     * @returns The git remote and the permalink, or undefined if either could not be found
     */
    getRemoteAndPermalink(location: FullLocation): RemoteAndPermalink | undefined {
        const [wsRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(location.rootPath);

        if (wsRoot === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error retrieving link. Filepath: ${location.rootPath} is not a workspace root.`);
            return;
        }

        return this.getProjectConfigRemoteAndPermalink(wsRoot.rootPath, location);
    }

    /**
     * Resolves a permalink from .vscode/info.json when project config is available.
     */
    private getProjectConfigRemoteAndPermalink(workspaceRoot: string, location: FullLocation): RemoteAndPermalink | undefined {
        const projectConfigPath = getProjectConfigPath(workspaceRoot);
        if (!fs.existsSync(projectConfigPath)) {
            vscode.window.showErrorMessage("weAudit: Project config not found at .vscode/info.json. Run 'weAudit: Initialize Project Config' first.");
            return;
        }

        let projectConfig;
        try {
            projectConfig = readProjectConfig(projectConfigPath);
        } catch (error) {
            vscode.window.showErrorMessage(`weAudit: Failed to parse project config: ${String(error)}`);
            return;
        }
        const validationResult = validateProjectConfig(projectConfig, workspaceRoot);
        if (!isValidProjectConfig(validationResult)) {
            const firstError = validationResult.errors[0];
            const pathPrefix = firstError.path === undefined ? "" : `${firstError.path}: `;
            vscode.window.showErrorMessage(`weAudit: Project config is invalid. ${pathPrefix}${firstError.message}`);
            return;
        }

        const resolvedRepository = resolveProjectRepository(projectConfig, location);
        if (resolvedRepository === undefined) {
            vscode.window.showErrorMessage(`weAudit: No repository in .vscode/info.json matches ${location.path}.`);
            return;
        }
        if (resolvedRepository.repository.remote === undefined || resolvedRepository.repository.remote === "") {
            vscode.window.showErrorMessage(`weAudit: Repository '${resolvedRepository.repository.name}' is missing a remote in .vscode/info.json.`);
            return;
        }
        if (resolvedRepository.commit === undefined || resolvedRepository.commit === "") {
            vscode.window.showErrorMessage(`weAudit: Repository '${resolvedRepository.repository.name}' has no commit for this location in .vscode/info.json.`);
            return;
        }

        return {
            remote: resolvedRepository.repository.remote,
            permalink: generateSourcePermalink(
                resolvedRepository.repository.remote,
                resolvedRepository.commit,
                resolvedRepository.path,
                location.startLine,
                location.endLine,
            ),
        };
    }

    /**
     * Get the git remote and the permalink for the given location, in the audit repository
     * @param location The location to get the remote and permalink for
     * @returns The git remote and the permalink, or undefined if either could not be found
     */
    getEntryRemoteAndPermalink(location: FullLocation): RemoteAndPermalink | undefined {
        return this.getRemoteAndPermalink(location);
    }

    /**
     * Get the git remote and the permalink for the given entry, in the client repository
     * @param startLine The start line of the code region
     * @param endLine The end line of the code region
     * @param path The path of the file
     * @returns The permalink, or undefined if either could not be found
     */
    getClientPermalink(location: FullLocation): string | undefined {
        const remoteAndPermalink = this.getRemoteAndPermalink(location);
        if (remoteAndPermalink) {
            return remoteAndPermalink.permalink;
        }
    }

    /**
     * Copy a permalink to the currently selected text to the clipboard
     * @param repository If the repository is the Audit repository or the Client repository
     */
    copySelectedCodePermalink(_repository: Repository): void {
        const locations = this.getActiveSelectionLocation();
        if (locations === undefined || locations.length === 0) {
            return;
        }
        // Use the first selection
        const location = locations[0];

        const remoteAndPermalink = this.getRemoteAndPermalink(location);
        if (remoteAndPermalink === undefined) {
            return;
        }
        this.copyToClipboard(remoteAndPermalink.permalink);
    }

    /**
     * Copy the permalink of the given entry to the clipboard
     * @param entry The entry to copy the permalink of
     */
    copyEntryPermalink(entry: FullEntry | FullLocationEntry): void {
        const location = isLocationEntry(entry) ? entry.location : entry.locations[0];
        const remoteAndPermalink = this.getEntryRemoteAndPermalink(location);
        if (remoteAndPermalink === undefined) {
            return;
        }
        this.copyToClipboard(remoteAndPermalink.permalink);
    }

    /**
     * Copy all permalinks of the given entry to the clipboard
     * @param entry The entry to copy the permalinks of
     */
    copyEntryPermalinks(entry: FullEntry): void {
        const permalinkList = [];
        for (const location of entry.locations) {
            const remoteAndPermalink = this.getEntryRemoteAndPermalink(location);
            if (remoteAndPermalink === undefined) {
                return;
            }
            permalinkList.push(remoteAndPermalink.permalink);
        }

        // get separator from configuration
        const separator: string = vscode.workspace.getConfiguration("weAudit").get("general.permalinkSeparator") || "\n";
        // interpret \n as newline
        const interpretedSep = separator.replace(/\\n/g, "\n");
        // join the permalinks with the separator
        const permalinksString = permalinkList.join(interpretedSep);
        // copy the permalinks to the clipboard
        this.copyToClipboard(permalinksString);
    }

    /**
     * Copy the given text to the clipboard
     * @param txt The text to copy to the clipboard
     */
    copyToClipboard(text: string): void {
        vscode.env.clipboard.writeText(text);
    }

    /**
     * Gets the text corresponding to the given location
     * @param location the location to get the text for
     * @returns the text corresponding to the given entry
     */
    async getLocationCode(location: FullLocation): Promise<string> {
        await vscode.commands.executeCommand(
            "weAudit.openFileLines",
            vscode.Uri.file(path.join(location.rootPath, location.path)),
            location.startLine,
            location.endLine,
        );
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return "";
        }
        const document = editor.document;
        const startLine = location.startLine;
        const endLine = location.endLine;
        let code = "";
        for (let i = startLine; i <= endLine; i++) {
            code += document.lineAt(i).text + "\n";
        }
        return code;
    }

    /**
     * Copies one or more entries as formatted markdown.
     */
    async copyEntriesAsMarkdown(entries: FullEntry[]): Promise<void> {
        const markdownEntries: string[] = [];
        for (const entry of entries) {
            markdownEntries.push(renderFindingMarkdown(entry, loadFindingSchema()));
        }

        await vscode.env.clipboard.writeText(markdownEntries.join("\n\n---\n\n"));
        vscode.window.showInformationMessage(`weAudit: Copied ${entries.length === 1 ? "finding" : "findings"} as Markdown.`);
    }

    /**
     * Gets the index of the tree entry that matches the given path and intersects the provided line range.
     * This does not use entryEquals because we use it to find which tree entry intersects
     * the cursor position.
     * @param location The location to check
     * @returns The index of the entry in the tree entries list or -1 if it was not found
     */
    getIntersectingTreeEntryIndex(location: FullLocation, entryType: EntryType): number {
        const entryTree = new vscode.Range(location.startLine, 0, location.endLine, Number.MAX_SAFE_INTEGER);
        for (let i = 0; i < this.treeEntries.length; i++) {
            const entry = this.treeEntries[i];
            if (entry.entryType !== entryType) {
                continue;
            }
            for (const loc of entry.locations) {
                if (loc.path === location.path && loc.rootPath === location.rootPath) {
                    const range = new vscode.Range(loc.startLine, 0, loc.endLine, 0);
                    if (entryTree.intersection(range) !== undefined) {
                        return i;
                    }
                }
            }
        }
        return -1;
    }

    /**
     * Removes the entry from the tree entries list and optionally adds
     * it to the resolved entries list.
     * @param entry the entry to remove from the tree entries list
     * @param resolve whether to add the entry to the resolved entries list
     */
    deleteAndResolveFinding(entry: FullEntry, resolve: boolean): void {
        const idx = getEntryIndexFromArray(entry, this.treeEntries);
        if (idx === -1) {
            console.log("error in deleteAndResolveFinding");
            return;
        }
        const removed = this.treeEntries.splice(idx, 1)[0];
        // depending on resolve, add the entry to the resolved entries list and refresh the resolved tree
        if (resolve) {
            if (entry.details === undefined) {
                entry.details = createDefaultEntryDetails();
            }
            this.resolvedEntries.push(removed);
            this.resolvedEntriesTree.refresh();
        }

        void this.updateSavedData(removed.author);
        this.refreshAndDecorateEntry(removed);
    }

    /**
     * Deletes the entry from the tree entries list, but does not add it to the
     * resolved entries list.
     * @param entry the entry to remove from the tree entries list
     */
    deleteFinding(entry: FullEntry): void {
        this.deleteAndResolveFinding(entry, false);
    }

    /**
     * Deletes the entry from the tree entries list and adds it to the
     * resolved entries list.
     * @param entry the entry to resolve.
     */
    resolveFinding(entry: FullEntry): void {
        this.deleteAndResolveFinding(entry, true);
    }

    /**
     * Creates a new finding entry and adds it to the tree entries list,
     * or edits the entry if it already exists.
     *
     */
    addFinding(): void {
        void this.createOrEditEntry(EntryType.Finding);
    }

    /**
     * Creates a new note entry and adds it to the tree entries list,
     * or edits the entry if it already exists.
     */
    addNote(): void {
        void this.createOrEditEntry(EntryType.Note);
    }

    /**
     * Restores the entry to the tree entries list and removes it from the
     * resolved entries list.
     * @param entry the entry to restore
     */
    restoreFinding(entry: FullEntry): void {
        // consider the case of older entries without details
        if (entry.details === undefined) {
            entry.details = createDefaultEntryDetails();
        }

        this.treeEntries.push(entry);
        const idx = getEntryIndexFromArray(entry, this.resolvedEntries);
        if (idx === -1) {
            console.log("error in restoreFinding");
            return;
        }
        this.resolvedEntries.splice(idx, 1);
        this.resolvedEntriesTree.refresh();

        this.refreshAndDecorateEntry(entry);
        void this.updateSavedData(entry.author);
    }

    /**
     * Deletes the entry from the resolved entries list.
     * @param entry the entry to delete
     */
    deleteResolvedFinding(entry: FullEntry): void {
        const idx = getEntryIndexFromArray(entry, this.resolvedEntries);
        if (idx === -1) {
            console.log("error in deleteResolvedFinding");
            return;
        }
        this.resolvedEntries.splice(idx, 1);
        this.resolvedEntriesTree.refresh();
        void this.updateSavedData(entry.author);
    }

    /**
     * Deletes all resolved findings.
     */
    deleteAllResolvedFindings(): void {
        if (this.resolvedEntries.length === 0) {
            return;
        }

        // get the authors of the resolved findings without duplicates
        const authors = this.resolvedEntries.map((entry) => entry.author).filter((value, index, self) => self.indexOf(value) === index);

        this.resolvedEntries.splice(0, this.resolvedEntries.length);
        for (const author of authors) {
            void this.updateSavedData(author);
        }
        this.resolvedEntriesTree.refresh();
    }

    /**
     * Restores all resolved findings.
     */
    restoreAllResolvedFindings(): void {
        if (this.resolvedEntries.length === 0) {
            return;
        }

        this.treeEntries = this.treeEntries.concat(this.resolvedEntries);

        // get authors and paths tuples of the resolved findings
        const authorSet: Set<string> = new Set();
        for (const entry of this.resolvedEntries) {
            authorSet.add(entry.author);
        }

        // we share the same array as the resolvedFindings array, so we can't do `this.resolvedEntries = []`
        const spliced = this.resolvedEntries.splice(0, this.resolvedEntries.length);
        for (const author of authorSet) {
            void this.updateSavedData(author);
        }

        for (const entry of spliced) {
            this.refreshEntry(entry);
        }
        this.resolvedEntriesTree.refresh();
        this.decorate();
    }

    /**
     * Creates a new entry of the given type and adds it to the tree entries list,
     * or deletes an existing entry of the given type if the active selection
     * intersects with an existing entry of the given type.
     *
     * @param entryType the type of the entry to create
     */
    async createOrEditEntry(entryType: EntryType): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return;
        }
        const uri = editor.document.uri;
        const locations = this.workspaces.getActiveSelectionLocation(uri);

        if (locations === undefined) {
            vscode.window.showErrorMessage("Trying to add entries to a file outside this workspace: " + uri.fsPath);
            return;
        }
        if (locations.length === 0) {
            return;
        }

        const location = locations[0];

        const intersectedIdx = this.getIntersectingTreeEntryIndex(location, entryType);

        // If we found an entry, reveal it so its title can be edited in Finding Details.
        if (intersectedIdx !== -1) {
            const entry = this.treeEntries[intersectedIdx];
            void treeView.reveal(entry, { select: true });
        } else {
            // otherwise, add it to the tree entries
            // create title depending on the entry type
            const inputBoxTitle = entryType === EntryType.Finding ? "Add Finding Title" : "Add Note Title";
            const title = await vscode.window.showInputBox({ title: inputBoxTitle, ignoreFocusOut: true });
            if (title === undefined) {
                return;
            }

            const details =
                entryType === EntryType.Finding ? { ...createEntryDetailsFromSchema(loadFindingSchema()), title } : { ...createDefaultEntryDetails(), title };

            const entry: FullEntry = {
                label: title,
                entryType: entryType,
                author: this.username,
                locations: locations,
                details,
            };
            this.applyFindingLabelTemplate(entry);
            this.treeEntries.push(entry);
            void this.updateSavedData(this.username);
        }

        this.decorateWithUri(uri);
        this.refresh(uri);
    }

    addNewEntryFromLocationEntry(locationEntry: FullLocationEntry): void {
        const newLabel = locationEntry.location.label !== "" ? locationEntry.location.label : locationEntry.parentEntry.label;
        const details =
            locationEntry.parentEntry.entryType === EntryType.Finding
                ? { ...createEntryDetailsFromSchema(loadFindingSchema()), title: newLabel }
                : { ...createDefaultEntryDetails(), title: newLabel };

        const entry: FullEntry = {
            label: newLabel,
            entryType: locationEntry.parentEntry.entryType,
            author: this.username,
            locations: [locationEntry.location],
            details,
        };
        this.treeEntries.push(entry);
        void this.updateSavedData(this.username);

        const uri = vscode.Uri.file(path.join(locationEntry.location.rootPath, locationEntry.location.path));
        this.decorateWithUri(uri);
        this.refresh(uri);
    }

    getActiveSelectionLocation(): FullLocation[] | undefined {
        // the null assertion is never undefined because we check if the editor is undefined
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return undefined;
        }
        const uri = editor.document.uri;
        const locations = this.workspaces.getActiveSelectionLocation(uri);

        if (locations === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error determining location of selected code. Filepath: ${uri.fsPath} is not in any workspace root.`);
            return;
        }

        return locations;
    }

    /**
     * Deletes an additional location from an entry
     * @param entry the entry of type "AdditionalEntry" to remove from some main entry
     */
    deleteLocation(entry: FullLocationEntry): void {
        // find the treeEntry with this additional data
        const parentEntry = entry.parentEntry;
        if (parentEntry.locations === undefined) {
            console.log("error in deleteLocation");
            return;
        }

        for (let i = 0; i < parentEntry.locations.length; i++) {
            const location = parentEntry.locations[i];
            if (
                location.path === entry.location.path &&
                location.startLine === entry.location.startLine &&
                location.endLine === entry.location.endLine &&
                location.rootPath === entry.location.rootPath
            ) {
                parentEntry.locations.splice(i, 1);
                if (parentEntry.locations.length === 0) {
                    this.deleteFinding(parentEntry);
                    this.refreshAndDecorateFromPath(location);
                    return;
                }

                void this.updateSavedData(parentEntry.author);
                // we only need to refresh the URI for the deleted location
                this.refreshAndDecorateFromPath(entry.location);
                return;
            }
        }
    }

    /**
     * Updates the saved data for the given user.
     * @param username the username to update the saved data for
     */
    updateSavedData(username: string): void {
        this.workspaces.updateSavedData(username);
    }

    /**
     * This is a helper function that allows workspace roots to get the relevant entries from the
     * CodeMarker's treeEntries when saving data. The entries are filtered by username and workspace
     * root before handing them over.
     * @param username The username whose findings should be saved.
     * @param root The workspace root where the findings should be saved.
     * @returns
     */
    getFilteredEntriesForSaving(username: string, root: WARoot): [FullEntry[], FullEntry[]] {
        const filteredEntries = this.treeEntries.filter((entry) => {
            let inWs = false;
            for (const location of entry.locations) {
                if (location.rootPath === root.rootPath) {
                    inWs = true;
                    break;
                }
            }
            return entry.author === username && inWs;
        });
        const filteredResolvedEntries = this.resolvedEntries.filter((entry) => {
            let inWs = false;
            for (const location of entry.locations) {
                if (location.rootPath === root.rootPath) {
                    inWs = true;
                    break;
                }
            }
            return entry.author === username && inWs;
        });
        return [filteredEntries, filteredResolvedEntries];
    }

    /**
     * Shared helper that adds the current editor selection(s) to an existing entry.
     * Optionally prompts for a label that is applied to each new location.
     * @param getLabel function that resolves to the label to assign, or undefined to skip labeling
     */
    private async addRegionToEntryWithOptionalLabel(getLabel?: () => Promise<string | undefined>): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return;
        }
        const locations = this.getActiveSelectionLocation();
        if (locations === undefined || locations.length === 0) {
            return;
        }

        // create a quick pick to select the entry to add the region to
        const items = this.treeEntries
            .filter((entry) => {
                if (entry.locations.length === 0 || entry.locations[0].rootPath !== locations[0].rootPath) {
                    return false;
                }
                return true;
            })
            .map((entry) => {
                return {
                    label: entry.label,
                    entry: entry,
                };
            });

        // if we have no findings so far, create a new one
        if (items.length === 0) {
            this.addFinding();
            return;
        }

        const pickItem = await vscode.window.showQuickPick(items, {
            ignoreFocusOut: true,
            title: "Select the finding to add the region to",
        });

        if (pickItem === undefined) {
            return;
        }

        let label: string | undefined;
        if (getLabel) {
            label = await getLabel();
            if (label === undefined) {
                return;
            }
        }

        const entry = pickItem.entry;
        // Add each selection as a separate region, optionally tagging with the provided label
        for (const location of locations) {
            if (label !== undefined) {
                location.label = label;
            }
            entry.locations.push(location);
        }
        this.updateSavedData(entry.author);
        this.decorateWithUri(editor.document.uri);
        this.refresh(editor.document.uri);
        // reveal the entry in the tree view if the treeview is visible,
        // for some reason, it won't expand even if though it is created
        // with an expanded state
        if (treeView.visible) {
            treeView.reveal(entry, { expand: 1, select: false });
        }
    }

    /**
     * Add the selected code region to an existing entry
     */
    async addRegionToAnEntry(): Promise<void> {
        await this.addRegionToEntryWithOptionalLabel();
    }

    /**
     * Add the selected code region to an existing entry, prompting for a label
     */
    async addRegionToAnEntryWithLabel(): Promise<void> {
        await this.addRegionToEntryWithOptionalLabel(async () =>
            vscode.window.showInputBox({
                title: "Enter a label for this location",
                ignoreFocusOut: true,
            }),
        );
    }

    /**
     * Loads the saved findings from a file
     * @param config  the configuration to load from
     * @param update  whether to update the tree entries
     * @param add  whether to add the findings to the tree entries
     * @returns the parsed entries in the file
     */
    loadSavedDataFromConfig(config: ConfigurationEntry, update: boolean, add: boolean): FullSerializedData | undefined {
        if (!fs.existsSync(config.path)) {
            return;
        }

        // TODO: can be better?
        const [wsRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(config.path);

        if (wsRoot === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error loading data for ${config.username}. Filepath: ${config.path} is not in any workspace root.`);
            return;
        }

        const parsedEntries = wsRoot.loadSavedDataFromConfig(config);
        if (parsedEntries === undefined) {
            return;
        }

        // rootPath is runtime-only and is derived from the .weaudit file's workspace root.
        const rootPath = wsRoot.rootPath;
        const fullParsedEntries = {
            schemaVersion: parsedEntries.schemaVersion,
            treeEntries: parsedEntries.treeEntries.map(
                (entry) =>
                    ({
                        label: entry.label,
                        entryType: entry.entryType,
                        author: entry.author,
                        details: entry.details,
                        locations: entry.locations.map(
                            (loc) =>
                                ({
                                    path: loc.path,
                                    startLine: loc.startLine,
                                    endLine: loc.endLine,
                                    label: loc.label,
                                    codeSnippet: loc.codeSnippet,
                                    rootPath: rootPath,
                                }) as FullLocation,
                        ),
                    }) as FullEntry,
            ),
            auditedFiles: parsedEntries.auditedFiles,
            partiallyAuditedFiles: parsedEntries.partiallyAuditedFiles,
            resolvedEntries: parsedEntries.resolvedEntries.map(
                (entry) =>
                    ({
                        label: entry.label,
                        entryType: entry.entryType,
                        author: entry.author,
                        details: entry.details,
                        locations: entry.locations.map(
                            (loc) =>
                                ({
                                    path: loc.path,
                                    startLine: loc.startLine,
                                    endLine: loc.endLine,
                                    label: loc.label,
                                    codeSnippet: loc.codeSnippet,
                                    rootPath: rootPath,
                                }) as FullLocation,
                        ),
                    }) as FullEntry,
            ),
        } as FullSerializedData;

        // Normalize all the paths from loaded files. These can come from different OSes with different path
        // conventions. We do a best effort to match them to the current OS format.
        fullParsedEntries.treeEntries.forEach((entry) => {
            entry.locations.forEach((loc) => {
                loc.path = normalizePathForOS(rootPath, loc.path);
            });
        });

        fullParsedEntries.resolvedEntries.forEach((entry) => {
            entry.locations.forEach((loc) => {
                loc.path = normalizePathForOS(rootPath, loc.path);
            });
        });

        fullParsedEntries.auditedFiles.forEach((auditedFile) => {
            auditedFile.path = normalizePathForOS(rootPath, auditedFile.path);
        });

        fullParsedEntries.partiallyAuditedFiles?.forEach((partiallyAuditedFile) => {
            partiallyAuditedFile.path = normalizePathForOS(rootPath, partiallyAuditedFile.path);
        });

        if (update) {
            if (add) {
                // Remove potential entries of username which appear on the tree.
                // This is to avoid duplicates
                // However, in a multi-root setting it is possible that this username is active in multiple roots
                // In that case, we only remove findings where all locations correspond to the workspace root of the
                // config file whose data is loaded
                if (
                    !this.workspaces
                        .getSelectedConfigurations()
                        .map((selectedConfig) => selectedConfig.username)
                        .includes(config.username)
                ) {
                    this.treeEntries = this.treeEntries.filter(
                        (entry) =>
                            entry.author !== config.username ||
                            entry.locations.findIndex((loc) => this.workspaces.getUniqueLabel(loc.rootPath) !== config.root.label) !== -1,
                    );
                    wsRoot.filterAudited(config.username);
                    wsRoot.filterPartiallyAudited(config.username);
                    this.resolvedEntries = this.resolvedEntries.filter(
                        (entry) =>
                            entry.author !== config.username ||
                            entry.locations.findIndex((loc) => this.workspaces.getUniqueLabel(loc.rootPath) !== config.root.label) !== -1,
                    );
                }

                const newTreeEntries = fullParsedEntries.treeEntries;

                this.treeEntries = this.treeEntries.concat(newTreeEntries);
                wsRoot.concatAudited(fullParsedEntries.auditedFiles);
                if (fullParsedEntries.partiallyAuditedFiles !== undefined) {
                    wsRoot.concatPartiallyAudited(fullParsedEntries.partiallyAuditedFiles);
                }

                if (fullParsedEntries.resolvedEntries !== undefined) {
                    this.resolvedEntries = this.resolvedEntries.concat(fullParsedEntries.resolvedEntries);
                }
            } else {
                this.treeEntries = this.treeEntries.filter(
                    (entry) =>
                        entry.author !== config.username ||
                        entry.locations.findIndex((loc) => this.workspaces.getUniqueLabel(loc.rootPath) !== config.root.label) !== -1,
                );
                wsRoot.filterAudited(config.username);
                wsRoot.filterPartiallyAudited(config.username);
                this.resolvedEntries = this.resolvedEntries.filter(
                    (entry) =>
                        entry.author !== config.username ||
                        entry.locations.findIndex((loc) => this.workspaces.getUniqueLabel(loc.rootPath) !== config.root.label) !== -1,
                );
            }
        }

        this.markPathMapDirty();

        return fullParsedEntries;
    }

    /**
     * Implicitly called in this._onDidChangeFileDecorationsEmitter.fire(uri);
     * which is called on this.refresh(uri)
     * @param uri the uri of the file to decorate
     * @returns the decoration for the file
     */
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        const [wsRoot, relativePath, inMultipleRoots] = this.workspaces.getCorrespondingRootAndPath(uri.fsPath);

        if (wsRoot === undefined) {
            return;
        }

        let hasFindings = false;
        let isAudited = false;

        const allRootsAndPaths: [WARoot, string][] = [];
        if (!inMultipleRoots) {
            // There is only one root, so we use it
            allRootsAndPaths.push([wsRoot, relativePath]);
        } else {
            // There are multiple roots, we need to look up all of them
            allRootsAndPaths.push(...this.workspaces.getAllCorrespondingRootsAndPaths(uri.fsPath));
        }

        outer: for (const entry of this.treeEntries) {
            // if any of the locations is on this file, badge it
            if (entry.entryType === EntryType.Finding && entry.locations) {
                for (const location of entry.locations) {
                    for (const [wsRoot, relativePath] of allRootsAndPaths) {
                        if (location.path === relativePath && location.rootPath === wsRoot.rootPath) {
                            hasFindings = true;
                            break outer;
                        }
                    }
                }
            }
        }
        // check if there is an entry for this file in the audited files
        for (const [wsRoot, relativePath] of allRootsAndPaths) {
            if (wsRoot.isAudited(relativePath)) {
                isAudited = true;
            }
        }

        if (isAudited) {
            if (hasFindings) {
                return {
                    badge: "✓!",
                    tooltip: "Audited but has findings to review",
                };
            } else {
                return {
                    badge: "✓",
                    tooltip: "Audited",
                };
            }
        } else if (hasFindings) {
            return {
                badge: "!",
                tooltip: "Has findings to review",
            };
        }
    }

    /**
     * Redecorates all currently visible editors based on the current treeEntries.
     */
    decorate(): void {
        vscode.window.visibleTextEditors.forEach((editor) => {
            this.decorateEditor(editor);
        });
    }

    /**
     * Redecorates all currently visible editors matching the given uri.
     * @param uri the uri of the file to decorate
     */
    decorateWithUri(uri: vscode.Uri): void {
        vscode.window.visibleTextEditors.forEach((editor) => {
            if (editor.document.uri.fsPath === uri.fsPath) {
                this.decorateEditor(editor);
            }
        });
    }

    /**
     * Redecorates the given editor based on the current treeEntries
     *  - decorate each region with the region decoration type
     *  - decorate the first line of each entry with its description and author
     * @param editor the editor to decorate
     */
    decorateEditor(editor: vscode.TextEditor): void {
        if (editor === undefined) {
            return;
        }

        // If highlights were disabled, clear the decorations and return
        if (!this.decorationsEnabled) {
            this.decorationManager.clearEditorDecorations(editor);
            return;
        }

        const [wsRoot, relativePath, inMultipleRoots] = this.workspaces.getCorrespondingRootAndPath(editor.document.fileName);

        if (wsRoot === undefined || relativePath === undefined) {
            return;
        }

        const allRootsAndPaths: [WARoot, string][] = [];
        if (!inMultipleRoots) {
            // There is only one root, so we use it
            allRootsAndPaths.push([wsRoot, relativePath]);
        } else {
            // There are multiple roots, we need to look up all of them
            allRootsAndPaths.push(...this.workspaces.getAllCorrespondingRootsAndPaths(editor.document.fileName));
        }

        const ownDecorations: vscode.Range[] = [];
        const otherDecorations: vscode.Range[] = [];
        const ownNoteDecorations: vscode.Range[] = [];
        const otherNoteDecorations: vscode.Range[] = [];
        const labelDecorations: vscode.DecorationOptions[] = [];

        for (const treeItem of this.treeEntries) {
            const isOwnEntry = this.username === treeItem.author;
            const findingDecoration = isOwnEntry ? ownDecorations : otherDecorations;
            const noteDecoration = isOwnEntry ? ownNoteDecorations : otherNoteDecorations;

            // decorate additional locations for that entry
            for (const location of treeItem.locations) {
                for (const [wsRoot, fname] of allRootsAndPaths) {
                    if (location.path !== fname || location.rootPath !== wsRoot.rootPath) {
                        continue;
                    }
                    const range = new vscode.Range(location.startLine, 0, location.endLine, Number.MAX_SAFE_INTEGER);
                    if (treeItem.entryType === EntryType.Finding) {
                        findingDecoration.push(range);
                    } else if (treeItem.entryType === EntryType.Note) {
                        noteDecoration.push(range);
                    }
                    // add the author information
                    const extraLabel = isOwnEntry ? "(you)" : "(" + treeItem.author + ")";
                    const labelString =
                        treeItem.label === location.label ? `${treeItem.label}  ${extraLabel}` : `${treeItem.label} ${location.label}  ${extraLabel}`;

                    labelDecorations.push(labelAfterFirstLineTextDecoration(location.startLine, labelString));

                    const afterLineRange = new vscode.Range(location.startLine, Number.MAX_SAFE_INTEGER, location.startLine, Number.MAX_SAFE_INTEGER);
                    labelDecorations.push(hoverOnLabel(afterLineRange, treeItem.label));
                }
            }
        }

        editor.setDecorations(this.decorationManager.ownFindingDecorationType, ownDecorations);
        editor.setDecorations(this.decorationManager.otherFindingDecorationType, otherDecorations);
        editor.setDecorations(this.decorationManager.ownNoteDecorationType, ownNoteDecorations);
        editor.setDecorations(this.decorationManager.otherNoteDecorationType, otherNoteDecorations);

        editor.setDecorations(this.decorationManager.emptyDecorationType, labelDecorations);

        // check if editor is audited, and mark it as such
        let range: vscode.Range[] = [];
        const partiallyAuditedFiles: PartiallyAuditedFile[] = [];
        for (const [wsRoot, fname] of allRootsAndPaths) {
            if (wsRoot.isAudited(fname)) {
                range = [new vscode.Range(0, 0, editor.document.lineCount, 0)];
            }
            partiallyAuditedFiles.push(...wsRoot.getPartiallyAudited().filter((entry) => entry.path === fname));
        }

        // check if editor is partially audited, and mark locations as such
        const partiallyAuditedDecorations = partiallyAuditedFiles.map((r) => new vscode.Range(r.startLine, 0, r.endLine, 0));
        editor.setDecorations(this.decorationManager.auditedFileDecorationType, range.concat(partiallyAuditedDecorations));
    }

    /**
     * Part of the TreeDataProvider interface.
     * This is the case where the findings are organized by file.
     * So,
     *  - the root elements are the unique file paths
     *  - the children of a file path are the findings and notes with that file path
     * Root elements are sorted alphabetically and
     * entries per file are sorted by their start line.
     * @param element the element to get the children of
     * @returns the children of the element
     */
    getChildrenPerFile(element?: TreeEntry): TreeEntry[] {
        this.ensurePathToEntryMap();

        if (element === undefined) {
            const pathLabels = Array.from(this.pathToEntryMap.keys()).sort();
            return pathLabels.map((label) => createPathOrganizer(label));
        } else {
            // get entries with same path as element
            if (isPathOrganizerEntry(element)) {
                const entries = this.pathToEntryMap.get(element.pathLabel) ?? [];
                if (this.sortEntriesAlphabetically) {
                    return [...entries].sort((a, b) => {
                        // Sort by entry type first (findings before notes), then by label
                        if (a.parentEntry.entryType !== b.parentEntry.entryType) {
                            if (a.parentEntry.entryType === EntryType.Finding) {
                                return -1;
                            }
                            if (b.parentEntry.entryType === EntryType.Finding) {
                                return 1;
                            }
                            return 0; // Stable sort for any future entry types
                        }
                        return a.parentEntry.label.localeCompare(b.parentEntry.label);
                    });
                }
                return entries;
            } else {
                return [];
            }
        }
    }

    /**
     * Part of the TreeDataProvider interface.
     * This is the case where the findings are organized linearly.
     * So,
     *  - the root element are all findings and notes
     *  - if findings and notes have multiple locations, these will be their children
     *
     * @param entry the element to get the children of
     * @returns the children of the element
     */
    getChildrenLinear(entry?: TreeEntry): TreeEntry[] {
        this.ensurePathToEntryMap();

        if (entry !== undefined) {
            if (isLocationEntry(entry) || isPathOrganizerEntry(entry) || !entry.locations) {
                return [];
            }

            return entry.locations
                .filter((location) => this.isLocationVisible(entry, location))
                .map((location) => this.getOrCreateLocationEntry(entry, location));
        }

        const entries: FullEntry[] = [];
        const notes: FullEntry[] = [];
        for (const entry of this.treeEntries) {
            if (entry.entryType === EntryType.Finding) {
                entries.push(entry);
            } else {
                notes.push(entry);
            }
        }

        if (this.sortEntriesAlphabetically) {
            entries.sort((a, b) => a.label.localeCompare(b.label));
            notes.sort((a, b) => a.label.localeCompare(b.label));
        }

        return entries.concat(notes).filter((entry) => this.hasVisibleLocation(entry));
    }

    /**
     * Part of the TreeDataProvider interface.
     * @param element the element to get the children of
     * @returns the children of the element
     */
    getChildren(element?: TreeEntry): TreeEntry[] {
        if (this.treeViewMode === TreeViewMode.List) {
            return this.getChildrenLinear(element);
        } else {
            return this.getChildrenPerFile(element);
        }
    }

    /**
     * Part of the TreeDataProvider interface.
     * @param element the element to get the parent of
     * @returns the parent of the element
     */
    getParent(e: TreeEntry): FullEntry | undefined {
        if (isLocationEntry(e)) {
            return e.parentEntry;
        }
        return undefined;
    }

    /**
     * Part of the TreeDataProvider interface.
     * If the entry is of type PathOrganizer, it is separator-like and can be expanded.
     * Otherwise, it is a leaf and cannot be expanded.
     * @param element the element to get the tree item for
     * @returns the tree item for the element
     */
    getTreeItem(entry: TreeEntry): vscode.TreeItem {
        if (isLocationEntry(entry)) {
            const state = vscode.TreeItemCollapsibleState.None;
            let description = path.basename(entry.location.path) + ":" + (entry.location.startLine + 1).toString();
            if (entry.location.endLine !== entry.location.startLine) {
                description += "-" + (entry.location.endLine + 1).toString();
            }
            let mainLabel: string;
            if (this.treeViewMode === TreeViewMode.List) {
                mainLabel = entry.location.label;
            } else {
                mainLabel = entry.parentEntry.label;
                if (entry.location.label) {
                    mainLabel += " - " + entry.location.label;
                }
            }
            const treeItem = new vscode.TreeItem(mainLabel, state);
            treeItem.description = description;
            treeItem.iconPath = new vscode.ThemeIcon("location");
            treeItem.contextValue = "additionalLocation";
            treeItem.command = {
                command: "weAudit.openFileLines",
                title: "Open File",
                arguments: [vscode.Uri.file(path.join(entry.location.rootPath, entry.location.path)), entry.location.startLine, entry.location.endLine],
            };
            return treeItem;
        } else if (isPathOrganizerEntry(entry)) {
            const state = vscode.TreeItemCollapsibleState.Expanded;
            const treeItem = new vscode.TreeItem(entry.pathLabel, state);
            treeItem.contextValue = "pathOrganizer";
            return treeItem;
        }

        // if it's not a location entry or a path organizer entry, it's a normal entry
        const state =
            entry.locations && entry.locations.length > 1 && this.treeViewMode === TreeViewMode.List
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None;
        const treeItem = new vscode.TreeItem(entry.label, state);

        if (entry.entryType === EntryType.Note) {
            treeItem.iconPath = new vscode.ThemeIcon("bookmark");
        } else {
            treeItem.iconPath = new vscode.ThemeIcon("bug");
        }

        const mainLocation = entry.locations[0];

        const basePath = path.basename(mainLocation.path);
        treeItem.description = basePath + ":" + (mainLocation.startLine + 1).toString();

        if (entry.author !== this.username) {
            treeItem.description += " (" + entry.author + ")";
        }

        treeItem.command = {
            command: "weAudit.openFileLines",
            title: "Open File",
            arguments: [vscode.Uri.file(path.join(mainLocation.rootPath, mainLocation.path)), mainLocation.startLine, mainLocation.endLine],
        };

        return treeItem;
    }

    /**
     * Finds the entry under the cursor in the active text editor.
     * @returns the entry under the cursor, or undefined if there is none
     */
    getLocationUnderCursor(): FullEntry | FullLocationEntry | undefined {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return;
        }
        const [wsRoot, relativePath] = this.workspaces.getCorrespondingRootAndPath(editor.document.fileName);

        if (wsRoot === undefined || relativePath === undefined) {
            return;
        }

        let pathLabel: string;
        // If there is more than one root, relative paths may not be unique
        // Therefore, we create unique paths by prepending the workspace root directory name
        if (this.workspaces.moreThanOneRoot()) {
            // We know that the unique path creation succeeds, because we are calling it directly on a WARoot's path
            pathLabel = this.workspaces.createUniquePath(wsRoot.rootPath, relativePath)!;
        } else {
            pathLabel = relativePath;
        }

        this.ensurePathToEntryMap();

        const locationEntries = this.pathToEntryMap.get(pathLabel);
        if (locationEntries === undefined) {
            return;
        }

        for (const locationEntry of locationEntries) {
            const region = new vscode.Range(locationEntry.location.startLine, 0, locationEntry.location.endLine, Number.MAX_SAFE_INTEGER);
            if (editor.selection.intersection(region) !== undefined) {
                if (locationEntry.parentEntry.locations.length === 1) {
                    return locationEntry.parentEntry;
                }
                return locationEntry;
            }
        }
    }

    private ensurePathToEntryMap(): void {
        if (!this.pathToEntryMapDirty) {
            return;
        }
        this.rebuildPathToEntryMap();
    }

    private rebuildPathToEntryMap(): void {
        this.pathToEntryMap.clear();

        for (const entry of this.treeEntries) {
            for (const location of entry.locations) {
                if (!this.isLocationVisible(entry, location)) {
                    continue;
                }

                const pathLabel = this.getPathLabelForLocation(location);
                if (pathLabel === undefined) {
                    continue;
                }

                const locationEntry = this.getOrCreateLocationEntry(entry, location);
                const entriesForPath = this.pathToEntryMap.get(pathLabel);
                if (entriesForPath === undefined) {
                    this.pathToEntryMap.set(pathLabel, [locationEntry]);
                } else {
                    entriesForPath.push(locationEntry);
                }
            }
        }

        for (const entries of this.pathToEntryMap.values()) {
            entries.sort((a, b) => a.location.startLine - b.location.startLine);
        }

        this.pathToEntryMapDirty = false;
    }

    private getOrCreateLocationEntry(entry: FullEntry, location: FullLocation): FullLocationEntry {
        const cached = this.locationEntryCache.get(location);
        if (cached !== undefined && cached.parentEntry === entry) {
            return cached;
        }
        const locationEntry = createLocationEntry(location, entry);
        this.locationEntryCache.set(location, locationEntry);
        return locationEntry;
    }

    private isLocationVisible(entry: FullEntry, location: FullLocation): boolean {
        const absolutePath = path.join(location.rootPath, location.path);
        const [wsRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(absolutePath);
        if (wsRoot === undefined) {
            return false;
        }
        return (
            this.workspaces
                .getSelectedConfigurations()
                .findIndex((config) => config.username === entry.author && config.root.label === wsRoot.getRootLabel()) !== -1
        );
    }

    private getPathLabelForLocation(location: FullLocation): string | undefined {
        if (this.workspaces.moreThanOneRoot()) {
            return this.workspaces.createUniquePath(location.rootPath, location.path) ?? undefined;
        }
        return location.path;
    }

    private hasVisibleLocation(entry: FullEntry): boolean {
        for (const location of entry.locations) {
            if (this.isLocationVisible(entry, location)) {
                return true;
            }
        }
        return false;
    }

    private markPathMapDirty(): void {
        this.pathToEntryMapDirty = true;
    }

    /**
     * Refreshes the decorations for a file and the finding tree. This is to change file decorations related to
     * a particular URI.
     * @param uri the URI of the file to refresh
     */
    refresh(uri: vscode.Uri): void {
        this.markPathMapDirty();
        this._onDidChangeFileDecorationsEmitter.fire(uri);
        this._onDidChangeTreeDataEmitter.fire();
    }

    /**
     * Refreshes the decorations for an entry.
     * @param entry the entry to refresh
     */
    refreshEntry(entry: FullEntry): void {
        for (const location of entry.locations) {
            const uri = vscode.Uri.file(path.join(location.rootPath, location.path));
            this._onDidChangeFileDecorationsEmitter.fire(uri);
        }
        this.refreshTree();
    }

    /**
     * Refreshes the finding tree.
     * This is used to change the tree view when a finding is added, resolved, or removed,
     * and also,
     *  - when the tree view mode is changed.
     *  - when the user changes the list of usernames to show.
     */
    refreshTree(): void {
        this.markPathMapDirty();
        this._onDidChangeTreeDataEmitter.fire();
    }

    /**
     * Refreshes and decorates and entry, including its additional locations
     * @param entry the entry to refresh and decorate
     */
    refreshAndDecorateEntry(entry: FullEntry): void {
        for (const loc of entry.locations) {
            const uri = vscode.Uri.file(path.join(loc.rootPath, loc.path));
            this.decorateWithUri(uri);
            this.refresh(uri);
        }
    }

    refreshAndDecorateFromPath(location: FullLocation): void {
        const uri = vscode.Uri.file(path.join(location.rootPath, location.path));
        this.decorateWithUri(uri);
        this.refresh(uri);
    }

    /**
     * Modifies the boundary (startLine and/or endLine) of a specific location within an entry.
     * Used by the boundary editing CodeLens feature.
     * @param entry the entry containing the location to modify
     * @param locationIndex the index of the location within entry.locations
     * @param startLineDelta the change to apply to startLine (negative = expand up, positive = shrink from top)
     * @param endLineDelta the change to apply to endLine (negative = shrink from bottom, positive = expand down)
     * @param document the document to validate line bounds against
     * @returns true if the modification was successful, false otherwise
     */
    modifyLocationBoundary(entry: FullEntry, locationIndex: number, startLineDelta: number, endLineDelta: number, document: vscode.TextDocument): boolean {
        if (locationIndex < 0 || locationIndex >= entry.locations.length) {
            return false;
        }

        const location = entry.locations[locationIndex];
        const newStartLine = location.startLine + startLineDelta;
        const newEndLine = location.endLine + endLineDelta;

        // Validate bounds
        if (newStartLine < 0) {
            return false;
        }
        if (newEndLine >= document.lineCount) {
            return false;
        }
        if (newStartLine > newEndLine) {
            return false;
        }

        // Apply the changes
        location.startLine = newStartLine;
        location.endLine = newEndLine;

        // Update decorations and save
        this.refreshAndDecorateFromPath(location);
        this.updateSavedData(entry.author);

        return true;
    }
}

let treeView: vscode.TreeView<TreeEntry>;
let treeDataProvider: CodeMarker;

export class AuditMarker {
    private previousVisibleTextEditors: string[] = [];
    private decorationManager: DecorationManager;

    constructor(context: vscode.ExtensionContext) {
        this.decorationManager = new DecorationManager(context);

        treeDataProvider = new CodeMarker(context, this.decorationManager);
        const dragAndDropController = new DragAndDropController(treeDataProvider, () => treeView);
        treeView = vscode.window.createTreeView("codeMarker", { treeDataProvider, dragAndDropController });
        context.subscriptions.push(treeView);

        vscode.window.onDidChangeTextEditorSelection((e) => this.checkSelectionEventAndRevealEntryUnderCursor(e));

        // call revealEntryUnderCursor when the extension separator becomes visible
        treeView.onDidChangeVisibility((e: vscode.TreeViewVisibilityChangeEvent) => {
            if (!e.visible) {
                return;
            }

            void this.revealEntryUnderCursor();
        });

        treeView.onDidChangeSelection((e: vscode.TreeViewSelectionChangeEvent<TreeEntry>) => {
            if (e.selection.length === 0) {
                vscode.commands.executeCommand("weAudit.hideFindingDetails");
                return;
            }
            const entry = e.selection[0];
            this.showEntryInFindingDetails(entry);
        });

        vscode.window.onDidChangeActiveTextEditor((e: vscode.TextEditor | undefined) => {
            if (e === undefined) {
                return;
            }
            for (const editor of this.previousVisibleTextEditors) {
                // if the active editor is already visible, do nothing
                // because it should already be decorated
                if (editor === e.document.fileName) {
                    return;
                }
            }

            this.decorate();
        });

        vscode.window.registerFileDecorationProvider(treeDataProvider);
        vscode.window.onDidChangeActiveColorTheme(() => this.decorationManager.reloadAllDecorationConfigurations());
        vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
            this.selectivelyReloadConfigurations(e);
        });

        // This event is triggered several times when dragging a file into a new column.
        vscode.window.onDidChangeVisibleTextEditors((newVisibleTextEditors: readonly vscode.TextEditor[]) => {
            // compare previousVisibleTextEditors with newVisibleTextEditors
            // if they are the same, do nothing
            // if they are different, decorate
            if (newVisibleTextEditors.length === 0) {
                return;
            }

            if (newVisibleTextEditors.length === this.previousVisibleTextEditors.length) {
                // check if they all match
                for (const newEditor of newVisibleTextEditors) {
                    let found = false;
                    for (const oldEditor of this.previousVisibleTextEditors) {
                        if (oldEditor === newEditor.document.fileName) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        // TODO: only decorate the new editors
                        // However, to do this you need to keep track of which editors are new
                        // and which are old, and only decorate the new ones. This needs to take
                        // into account that new editors can be for the same file as old editors, e.g., when you
                        // split the editor in two.
                        this.decorate();
                        break;
                    }
                }
            } else {
                this.decorate();
            }
            this.previousVisibleTextEditors = newVisibleTextEditors.map((e) => e.document.fileName);
        });

        vscode.commands.registerCommand("weAudit.showSelectedEntryInFindingDetails", () => {
            if (treeView.selection.length === 0) {
                vscode.commands.executeCommand("weAudit.hideFindingDetails");
                return;
            }
            const entry = treeView.selection[0];
            this.showEntryInFindingDetails(entry);
        });

        vscode.commands.registerCommand("weAudit.copyFindingAsMarkdownFromDetails", () => {
            if (!treeDataProvider.ensureActiveWorkspaceInitialized()) {
                return;
            }
            const entry = this.getCurrentlySelectedFullEntry();
            if (entry === undefined) {
                return;
            }
            void treeDataProvider.copyEntriesAsMarkdown([entry]);
        });

        // Activate the finding boundary CodeLens feature
        activateFindingBoundaryCodeLens(
            context,
            () => treeDataProvider.getLocationUnderCursor(),
            (entry, locationIndex, startLineDelta, endLineDelta, document) =>
                treeDataProvider.modifyLocationBoundary(entry, locationIndex, startLineDelta, endLineDelta, document),
        );
    }

    private showEntryInFindingDetails(entry: TreeEntry): void {
        if (isPathOrganizerEntry(entry)) {
            vscode.commands.executeCommand("weAudit.hideFindingDetails");
            return;
        }

        if (isLocationEntry(entry)) {
            entry = entry.parentEntry;
        }

        // Ensure details exist before populating the webview
        if (entry.details === undefined) {
            entry.details = createDefaultEntryDetails();
        }

        // Fills the Finding details webview with the currently selected entry details
        vscode.commands.executeCommand("weAudit.setWebviewFindingDetails", entry.details, entry.entryType);
    }

    /**
     * Returns the currently selected tree entry as a FullEntry, ignoring grouping and location-only nodes.
     */
    private getCurrentlySelectedFullEntry(): FullEntry | undefined {
        if (treeView.selection.length === 0) {
            return;
        }

        let entry = treeView.selection[0];
        if (isPathOrganizerEntry(entry)) {
            return;
        }
        if (isLocationEntry(entry)) {
            entry = entry.parentEntry;
        }
        if (!isEntry(entry)) {
            return;
        }

        return entry;
    }

    /**
     * Selectively reload configurations: if the treeViewMode configuration changed, reload only that.
     * Otherwise, reload all decoration configurations.
     * TODO: make it possible to reload only one decoration type
     * @param e the configuration change event
     */
    private selectivelyReloadConfigurations(e: vscode.ConfigurationChangeEvent): void {
        if (e.affectsConfiguration("weAudit.general.treeViewMode")) {
            treeDataProvider.loadTreeViewModeConfiguration();
        } else if (e.affectsConfiguration("weAudit.general.sortEntriesAlphabetically")) {
            treeDataProvider.loadSortEntriesConfiguration();
        } else if (e.affectsConfiguration("weAudit.general.username")) {
            treeDataProvider.setUsernameConfigOrDefault();
        } else {
            this.decorationManager.reloadAllDecorationConfigurations();
            this.decorate();
        }
    }

    /**
     * Reveal the entry under the cursor, in the treeView.
     */
    private async revealEntryUnderCursor(): Promise<void> {
        const entry = treeDataProvider.getLocationUnderCursor();
        if (entry !== undefined) {
            try {
                await treeView.reveal(entry);
            } catch (error) {
                const message = (error as Error).message ?? "";
                if (message.startsWith("TreeError") || message.includes("Cannot resolve tree item")) {
                    return;
                }
                throw error;
            }
        }
    }

    /**
     * Reveal the entry under the cursor if:
     *  - the selection event is a command
     *  - the treeView widget is visible
     * @param e the text editor selection change event
     */
    private checkSelectionEventAndRevealEntryUnderCursor(e: vscode.TextEditorSelectionChangeEvent): void {
        // bail on command; this allows mouse and keyboard navigation to reveal the entry under the cursor
        if (e.kind === vscode.TextEditorSelectionChangeKind.Command) {
            return;
        }

        // prevent switching if the treeView widget is not visible
        if (!treeView.visible) {
            return;
        }

        void this.revealEntryUnderCursor();
    }

    /**
     * Decorate the visible text editors.
     */
    private decorate(): void {
        treeDataProvider.decorate();
    }

    /**
     * Decorate text editors with uri.
     * @param uri the uri of the text editor
     */
    private decorateWithUri(uri: vscode.Uri): void {
        treeDataProvider.decorateWithUri(uri);
    }
}
