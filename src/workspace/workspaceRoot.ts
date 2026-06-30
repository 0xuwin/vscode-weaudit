import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { userInfo } from "os";
import { spawnSync } from "child_process";

import {
    AuditedFile,
    PartiallyAuditedFile,
    ConfigurationEntry,
    WorkspaceRootEntry,
    Entry,
    FullEntry,
    Location,
    FullLocation,
    SerializedData,
    configEntryEquals,
    AUDIT_STATE_SCHEMA_VERSION,
    mergeTwoEntryArrays,
    mergeTwoAuditedFileArrays,
    mergeTwoPartiallyAuditedFileArrays,
} from "../types";
import { readAuditState, writeAuditState } from "../auditState/storage";
import { markAuditStateFileAsSelfWritten } from "../auditState/writeTracker";

export const SERIALIZED_FILE_EXTENSION = ".weaudit";
const DAY_LOG_FILENAME = ".weauditdaylog";

/**
 * Class representing a WeAudit workspace root. Each root maintains its own set of
 * configuration files (configs) with treeEntries, auditedFiles,
 * and resolvedEntries. Additionally, it maintains a markedFilesDayLog.
 */
export class WARoot {
    private auditedFiles: AuditedFile[];
    private partiallyAuditedFiles: PartiallyAuditedFile[];
    readonly rootPath: string;
    private rootLabel: string;
    private username: string;

    // An array corresponding to all .weaudit file in the .vscode folder of this workspace root
    private configs: ConfigurationEntry[];
    private currentlySelectedConfigs: ConfigurationEntry[];

    // markedFilesDayLog contains a map associating a string representing a date to a file path.
    public markedFilesDayLog: Map<string, string[]>;

    constructor(wsPath: string, wsLabel: string) {
        this.auditedFiles = [];
        this.partiallyAuditedFiles = [];
        this.rootPath = wsPath;
        this.rootLabel = wsLabel;
        if (this.rootLabel === "") {
            vscode.window.showWarningMessage(
                `weAudit: Warning! It looks like your root path ${this.rootPath} is at the root of your filesystem. This is deeply cursed.`,
            );
        }

        this.markedFilesDayLog = new Map<string, string[]>();
        this.loadDayLogFromFile();

        this.username = vscode.workspace.getConfiguration("weAudit").get("general.username") || userInfo().username;
        this.configs = [];
        this.currentlySelectedConfigs = [];
        this.loadConfigurations();
    }

    /**
     * A function to check whether a file is in this workspace root and the relative path to the root folder
     * @param filePath an absolute path to a file
     * @returns a tuple of a `boolean` whether the file is in this workspace,
     * and the relative path (which is the empty string if it is not in this workspace).
     */
    isInThisWorkspaceRoot(filePath: string): [boolean, string] {
        const relativePath = path.relative(this.rootPath, filePath);
        if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
            return [false, ""];
        }
        return [true, relativePath];
    }

    /**
     * A function that returns the unique label for this root.
     * @returns the unique root label.
     */
    getRootLabel(): string {
        return this.rootLabel;
    }

    /**
     * Loads the day log from storage.
     */
    loadDayLogFromFile(): void {
        const vscodeFolder = path.join(this.rootPath, ".vscode");
        if (!fs.existsSync(vscodeFolder)) {
            return;
        }
        if (!fs.existsSync(path.join(vscodeFolder, DAY_LOG_FILENAME))) {
            return;
        }

        const dayLogPath = path.join(vscodeFolder, DAY_LOG_FILENAME);
        const data = JSON.parse(fs.readFileSync(dayLogPath, "utf8")) as Iterable<readonly [string, string[]]>;
        this.markedFilesDayLog = new Map(data);
    }

    /**
     * Loads the configurations (.weaudit files) from the .vscode folder.
     */
    loadConfigurations(): void {
        this.configs = [];
        this.currentlySelectedConfigs = [];
        const vscodeFolder = path.join(this.rootPath, ".vscode");
        if (!fs.existsSync(vscodeFolder)) {
            return;
        }

        fs.readdirSync(vscodeFolder).forEach((file) => {
            if (path.extname(file) === SERIALIZED_FILE_EXTENSION) {
                const parsedPath = path.parse(file);

                const configEntry = {
                    path: path.join(vscodeFolder, file),
                    username: parsedPath.name,
                    root: { label: this.rootLabel } as WorkspaceRootEntry,
                } as ConfigurationEntry;
                this.configs.push(configEntry);
                this.currentlySelectedConfigs.push(configEntry);
            }
        });
    }

    /**
     * Get the configurations (.weaudit files) of this workspace root.
     * @returns The configuration entries corresponding to the .weaudit
     * files from the .vscode folder in this workspace root.
     */
    getConfigs(): ConfigurationEntry[] {
        return this.configs;
    }

    /**
     * Get the currently selected configurations (.weaudit files) of this
     * workspace root.
     * @returns The currently selectedconfiguration entries
     */
    getSelectedConfigs(): ConfigurationEntry[] {
        return this.currentlySelectedConfigs;
    }

    /**
     * Returns whether a config is currently selected, and optionally selects it if not.
     */
    manageConfiguration(config: ConfigurationEntry, select: boolean): boolean {
        if (this.currentlySelectedConfigs.findIndex((entry) => configEntryEquals(entry, config)) === -1) {
            if (select) {
                this.currentlySelectedConfigs.push(config);
            }
            return false;
        }
        return true;
    }

    /**
     * Deselect the provided configuration if it is selected, and select it if not
     * @param config the configuration to be (de)selected
     * @returns whether the configuration was selected
     */
    toggleConfiguration(config: ConfigurationEntry): boolean {
        const idx = this.currentlySelectedConfigs.findIndex((entry) => configEntryEquals(entry, config));
        const excluded = idx === -1;
        if (excluded) {
            this.currentlySelectedConfigs.push(config);
        } else {
            this.currentlySelectedConfigs.splice(idx, 1);
        }
        return !excluded;
    }

    /**
     * Returns the currently selected configurations in this workspace root
     * @returns the currently selected configurations
     */
    getSelectedConfigurations(): ConfigurationEntry[] {
        return this.currentlySelectedConfigs;
    }

    /**
     * Update the unique workspace root label to the provided label.
     * Updates all the configuration entries to use the new label
     * @param label the new unique label for this workspace root.
     */
    async updateLabel(label: string): Promise<void> {
        if (label !== this.rootLabel) {
            for (const configEntry of this.configs) {
                const isSelected = this.manageConfiguration(configEntry, false);
                if (isSelected) {
                    // We need to unselect it first
                    await vscode.commands.executeCommand("weAudit.toggleSavedFindings", configEntry);
                    // Now we modify the configEntry root
                    configEntry.root.label = label;
                    // Now we toggle it back
                    await vscode.commands.executeCommand("weAudit.toggleSavedFindings", configEntry);
                } else {
                    // It is not selected, so we can just modify it and no one will notice
                    configEntry.root.label = label;
                }
            }
            this.rootLabel = label;
        }
    }

    /**
     * Toggle a file as audited.
     * @param uri the `uri` of the target file.
     * @param relativePath the relative path of the target file to this workspace root.
     * @returns A list of `uri`s to decorate and the relevant username.
     */
    toggleAudited(uri: vscode.Uri, relativePath: string): [vscode.Uri[], string] {
        let relevantUsername = "";

        let urisToDecorate: vscode.Uri[] = [];

        // check if file is already in list
        const index = this.auditedFiles.findIndex((file) => file.path === relativePath);
        if (index > -1) {
            // if it exists, remove it
            const auditedEntry = this.auditedFiles.splice(index, 1);
            relevantUsername = auditedEntry[0].author;
            urisToDecorate = this.checkIfAllSiblingFilesAreAudited(uri);
        } else {
            // if it doesn't exist, add it
            this.auditedFiles.push({ path: relativePath, author: this.username });
            relevantUsername = this.username;
            urisToDecorate = this.checkIfAllSiblingFilesAreAudited(uri);
        }

        // clean out any partially audited file entries
        this.cleanPartialAudits(uri);

        // update day log structure
        const isAdd = index === -1;
        this.updateDayLog(relativePath, isAdd);

        return [urisToDecorate, relevantUsername];
    }

    /**
     * Concatenates an array of AuditedFiles to the AuditedFiles of this workspace root.
     * @param files The array of audited files to be concatenated.
     */
    concatAudited(files: AuditedFile[]): void {
        this.auditedFiles = this.auditedFiles.concat(files);
    }

    /**
     * Concatenates an array of PartiallyAuditedFiles to the PartiallyAuditedFiles
     * of this workspace root.
     * @param files The array of audited files to be concatenated.
     */
    concatPartiallyAudited(files: PartiallyAuditedFile[]): void {
        this.partiallyAuditedFiles = this.partiallyAuditedFiles.concat(files);
    }

    /**
     * Remove the AuditedFiles of this workspace root for a specific username.
     * @param username The username whose AuditedFiles entries need to be removed.
     */
    filterAudited(username: string): void {
        this.auditedFiles = this.auditedFiles.filter((entry) => entry.author !== username);
    }

    /**
     * Remove the PartiallyAuditedFiles of this workspace root for a specific username.
     * @param username The username whose PartiallyAuditedFiles entries need to be removed.
     */
    filterPartiallyAudited(username: string): void {
        this.partiallyAuditedFiles = this.partiallyAuditedFiles.filter((entry) => entry.author !== username);
    }

    /**
     * Checks whether the file at a particular path is in the AuditedFiles of this workspace root.
     * @param path The path of the file to be checked.
     * @returns `true` if the file is in the AuditedFiles, `false` if not.
     */
    isAudited(path: string): boolean {
        return this.auditedFiles.findIndex((entry) => entry.path === path) !== -1;
    }

    /**
     * Get the PartiallyAuditedFiles of this workspace root.
     * @returns The PartiallyAuditedFiles of this workspace root.
     */
    getPartiallyAudited(): PartiallyAuditedFile[] {
        return this.partiallyAuditedFiles;
    }

    /**
     * Checks if all sibling files of the file that was audit-toggle are audited.
     * If they are, the containing folder is added to the list of audited files.
     * If they are not, the containing folder is removed from the list of audited files.
     * TODO: too many findIndex calls, maybe use a map instead of an array
     * @param uri The uri of the file that was audit-toggle
     */
    checkIfAllSiblingFilesAreAudited(uri: vscode.Uri): vscode.Uri[] {
        const urisToDecorate: vscode.Uri[] = [];
        // iterate over all the files in the same folder as the file that was audited
        const folder = path.dirname(uri.fsPath);
        const files = fs.readdirSync(folder);
        let allFilesAudited = true;
        for (const file of files) {
            // if any file is not audited, set allFilesAudited to false
            const relativePath = path.relative(this.rootPath, path.join(folder, file));
            if (this.auditedFiles.findIndex((file) => file.path === relativePath) === -1) {
                allFilesAudited = false;
                break;
            }
        }
        const folderUri = vscode.Uri.file(folder);

        // if all files are audited, add the folder to the list of audited files
        if (allFilesAudited) {
            this.auditedFiles.push({ path: path.relative(this.rootPath, folder), author: this.username });
            urisToDecorate.push(folderUri);
            // additionally, call checkIfAllSiblingFilesAreAudited on the parent folder
            urisToDecorate.push(...this.checkIfAllSiblingFilesAreAudited(folderUri));
        } else {
            // if not all files are audited, remove the folder from the list of audited files
            const index = this.auditedFiles.findIndex((file) => file.path === path.relative(this.rootPath, folder));
            if (index > -1) {
                this.auditedFiles.splice(index, 1);
                urisToDecorate.push(folderUri);
                // additionally, call checkIfAllSiblingFilesAreAudited on the parent folder for recursive removal
                urisToDecorate.push(...this.checkIfAllSiblingFilesAreAudited(folderUri));
            }
        }
        return urisToDecorate;
    }

    private cleanPartialAudits(uriToRemove: vscode.Uri): void {
        const relative = path.relative(this.rootPath, uriToRemove.fsPath);
        this.partiallyAuditedFiles = this.partiallyAuditedFiles.filter((file) => file.path !== relative);
    }

    /**
     * Updates the daily log with the marked/unmarked file
     * for today's date.
     * @param relativePath the relative path of the file
     * @param add whether to add or remove the file from the list
     */
    updateDayLog(relativePath: string, add: boolean): void {
        const today = new Date();
        const todayString = today.toDateString();
        const todayFiles = this.markedFilesDayLog.get(todayString);
        if (todayFiles === undefined) {
            this.markedFilesDayLog.set(todayString, [relativePath]);
        } else {
            // check if file is already in list
            const index = todayFiles.findIndex((file) => file === relativePath);
            if (index > -1 && !add) {
                // if it exists, remove it
                todayFiles.splice(index, 1);
            } else if (index === -1 && add) {
                todayFiles.push(relativePath);
            }
        }
        this.persistDayLog();
    }

    /**
     * Persist the day log to a file.
     */
    persistDayLog(): void {
        const vscodeFolder = path.join(this.rootPath, ".vscode");
        if (!fs.existsSync(vscodeFolder)) {
            fs.mkdirSync(vscodeFolder);
        }
        const dayLogPath = path.join(vscodeFolder, DAY_LOG_FILENAME);
        fs.writeFileSync(dayLogPath, JSON.stringify(Array.from(this.markedFilesDayLog), null, 2));
    }

    /**
     * Adds a file in this workspace root to the array of PartiallyAuditedFiles.
     * @param relativePath The relative path of the file to the folder of this root
     */
    addPartiallyAudited(relativePath: string): void {
        // check if file is already in list
        const index = this.auditedFiles.findIndex((file) => file.path === relativePath);
        // if file is already audited ignore
        if (index > -1) {
            return;
        }

        const locations = this.getActiveSelectionLocation();

        // Process each selection/location separately
        for (const location of locations) {
            const alreadyMarked = this.partiallyAuditedFiles.findIndex(
                (file) => file.path === relativePath && file.startLine <= location.startLine && file.endLine >= location.endLine,
            );

            // this section is already marked. Remove it then
            if (alreadyMarked > -1) {
                // Splits the existing entry into 2 and remove the location marked by the user
                const previousMarkedEntry = this.partiallyAuditedFiles[alreadyMarked];

                // same area has been selected so lets delete it
                if (previousMarkedEntry.startLine === location.startLine && previousMarkedEntry.endLine === location.endLine) {
                    this.partiallyAuditedFiles.splice(alreadyMarked, 1);
                } else {
                    // not the same area so we need to split the entry or change it

                    const locationClone = { ...previousMarkedEntry };

                    // if either the end line or the start line is the same we don't need
                    // to split the entry but can just adjust the current one
                    let splitNeeded = true;
                    if (previousMarkedEntry.endLine === location.endLine) {
                        previousMarkedEntry.endLine = location.startLine - 1;
                        splitNeeded = false;
                    }

                    if (previousMarkedEntry.startLine === location.startLine) {
                        previousMarkedEntry.startLine = location.endLine + 1;
                        splitNeeded = false;
                    }

                    if (splitNeeded) {
                        previousMarkedEntry.endLine = location.startLine - 1;
                        locationClone.startLine = location.endLine + 1;

                        this.partiallyAuditedFiles.push(locationClone);
                    }

                    this.partiallyAuditedFiles[alreadyMarked] = previousMarkedEntry;
                }
            } else {
                this.partiallyAuditedFiles.push({
                    path: relativePath,
                    author: this.username,
                    startLine: location.startLine,
                    endLine: location.endLine,
                });
            }
        }

        this.mergePartialAudits();
    }

    /**
     * Gets the active selection locations, supporting multiple selections.
     * @returns An array of FullLocations corresponding to all active selections.
     */
    getActiveSelectionLocation(): FullLocation[] {
        // the null assertion is never undefined because we check if the editor is undefined
        const editor = vscode.window.activeTextEditor!;
        const uri = editor.document.uri;
        const relativePath = path.relative(this.rootPath, uri.fsPath);
        const commit = this.getCurrentGitCommit();

        return editor.selections.map((selection) => {
            const startLine = selection.start.line;
            let endLine = selection.end.line;

            // vscode sets the end of a fully selected line as the first character of the next line
            // so we decrement the end line if the end character is 0 and the end line is not the same as the start line
            if (endLine > selection.start.line && selection.end.character === 0) {
                endLine--;
            }

            // Markdown previews do not show the preview if the last document line is empty,
            // so we decrement it by one.
            if (endLine === editor.document.lineCount - 1 && editor.document.lineAt(endLine).text === "") {
                // ensure that we don't go before the start line
                endLine = Math.max(endLine - 1, startLine);
            }

            const codeSnippet = [];
            for (let line = startLine; line <= endLine; line++) {
                codeSnippet.push(editor.document.lineAt(line).text);
            }

            // TODO: error if not in this workspace root?
            return { path: relativePath, startLine, endLine, label: "", codeSnippet: codeSnippet.join("\n"), rootPath: this.rootPath, commit };
        });
    }

    /**
     * Returns the current git commit hash for this workspace root, or undefined if not a git repo.
     */
    private getCurrentGitCommit(): string | undefined {
        const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: this.rootPath, encoding: "utf8" });
        if (result.status !== 0) {
            return;
        }
        const commit = result.stdout.trim();
        return commit === "" ? undefined : commit;
    }

    /**
     * Merge the PartiallyAuditedFiles in this workspace root.
     */
    private mergePartialAudits(): void {
        const cleanedEntries: PartiallyAuditedFile[] = [];
        // sort first by path and startLine for the merge to work
        const sortedEntries = this.partiallyAuditedFiles.sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine);
        for (const entry of sortedEntries) {
            // check if the current location is already partially audited
            const partIdx = cleanedEntries.findIndex(
                (file) =>
                    // only merge entries for the same file
                    file.path === entry.path &&
                    // checks if the start is within bounds but the end is not
                    ((file.startLine <= entry.startLine && file.endLine >= entry.startLine) ||
                        // checks if the end is within bounds but the start is not
                        (file.startLine <= entry.endLine && file.endLine >= entry.endLine) ||
                        // checks if the location includes the entry
                        (file.startLine >= entry.startLine && file.endLine <= entry.endLine) ||
                        // checks adjacent entries
                        file.endLine === entry.startLine - 1),
            );
            // update entry if necessary
            if (partIdx > -1) {
                const foundLocation = cleanedEntries[partIdx];
                if (foundLocation.endLine < entry.endLine) {
                    foundLocation.endLine = entry.endLine;
                }
                if (foundLocation.startLine > entry.startLine) {
                    foundLocation.startLine = entry.startLine;
                }

                cleanedEntries[partIdx] = foundLocation;
            } else {
                cleanedEntries.push(entry);
            }
        }

        this.partiallyAuditedFiles = cleanedEntries;
    }

    /**
     * Loads the saved findings from a configuration
     * @param config  the configuration entry to load from
     * @returns the parsed entries in the file
     */
    loadSavedDataFromConfig(config: ConfigurationEntry): SerializedData | undefined {
        if (!fs.existsSync(config.path)) {
            return;
        }
        const parsedEntries = readAuditState(config.path);
        if (parsedEntries === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error loading serialized data for ${config.username}. Filepath: ${config.path}`);
            return;
        }

        if (!this.isInThisWorkspaceRoot(config.path)) {
            vscode.window.showErrorMessage(
                `weAudit: Error loading data for ${config.username}. Filepath: ${config.path} is not in the expected workspace root.`,
            );
            return;
        }

        for (const entry of parsedEntries.treeEntries) {
            for (const location of entry.locations) {
                const absoluteEntryPath = path.resolve(this.rootPath, location.path);
                if (path.isAbsolute(location.path) || path.relative(this.rootPath, absoluteEntryPath).startsWith("..")) {
                    vscode.window.showWarningMessage("Trying to import entries with regions outside this workspace: " + location.path);
                    // We cannot reject this because the region may be in another workspace root
                }
            }
        }
        return parsedEntries;
    }

    /**
     * Update the saved data of a specific user in the .weaudit file of that user in
     * the .vscode folder of this workspace root.
     * @param username The username of the target user.
     */
    async updateSavedData(username: string): Promise<void> {
        const vscodeFolder = path.join(this.rootPath, ".vscode");

        let existsFolder = true;
        let existsFile = true;
        let toCreateData = false;

        if (!fs.existsSync(vscodeFolder)) {
            existsFolder = false;
        }

        const fileName = path.join(vscodeFolder, username + SERIALIZED_FILE_EXTENSION);
        const wsRootEntry = { label: this.rootLabel } as WorkspaceRootEntry;
        const configEntry = { path: fileName, username: username, root: wsRootEntry };
        if (!fs.existsSync(fileName)) {
            existsFile = false;
        }

        // filter local entries of the affected user
        let filteredAuditedFiles = this.auditedFiles.filter((file) => file.author === username);
        let filteredPartiallyAuditedEntries = this.partiallyAuditedFiles.filter((entry) => entry.author === username);

        // get filtered entries from the CodeMarker
        const [filteredEntries, filteredResolvedEntries]: [FullEntry[], FullEntry[]] = await vscode.commands.executeCommand(
            "weAudit.getFilteredEntriesForSaving",
            username,
            this,
        );

        // Remove rootPath before saving. It is implicit in the location of the saved file.
        let reducedEntries = filteredEntries.map(
            (fullEntry) =>
                ({
                    label: fullEntry.label,
                    entryType: fullEntry.entryType,
                    author: fullEntry.author,
                    details: fullEntry.details,
                    locations: fullEntry.locations.map(
                        (location) =>
                            ({
                                path: location.path,
                                startLine: location.startLine,
                                endLine: location.endLine,
                                label: location.label,
                                codeSnippet: location.codeSnippet,
                                commit: location.commit,
                            }) as Location,
                    ),
                }) as Entry,
        );
        let reducedResolvedEntries = filteredResolvedEntries.map(
            (fullEntry) =>
                ({
                    label: fullEntry.label,
                    entryType: fullEntry.entryType,
                    author: fullEntry.author,
                    details: fullEntry.details,
                    locations: fullEntry.locations.map(
                        (location) =>
                            ({
                                path: location.path,
                                startLine: location.startLine,
                                endLine: location.endLine,
                                label: location.label,
                                codeSnippet: location.codeSnippet,
                                commit: location.commit,
                            }) as Location,
                    ),
                }) as Entry,
        );

        if (existsFile) {
            // if we are not seeing the current user's findings, we can't simply overwrite the file
            // we need to merge the findings of the current user with their saved findings
            if (!this.manageConfiguration(configEntry, false)) {
                const previousEntries = this.loadSavedDataFromConfig(configEntry);
                if (previousEntries !== undefined) {
                    reducedEntries = mergeTwoEntryArrays(reducedEntries, previousEntries.treeEntries);
                    filteredAuditedFiles = mergeTwoAuditedFileArrays(filteredAuditedFiles, previousEntries.auditedFiles);
                    filteredPartiallyAuditedEntries = mergeTwoPartiallyAuditedFileArrays(
                        filteredPartiallyAuditedEntries,
                        previousEntries.partiallyAuditedFiles ?? [],
                    );
                    reducedResolvedEntries = mergeTwoEntryArrays(reducedResolvedEntries, previousEntries.resolvedEntries);
                }
            }
        }

        if (
            reducedEntries.length !== 0 ||
            filteredAuditedFiles.length !== 0 ||
            filteredPartiallyAuditedEntries.length !== 0 ||
            reducedResolvedEntries.length !== 0
        ) {
            toCreateData = true;
        }

        if (toCreateData) {
            // create .vscode folder if it doesn't exist
            if (!existsFolder) {
                fs.mkdirSync(vscodeFolder);
            }

            // create a new config file if it doesn't exist
            if (!existsFile) {
                this.configs.push(configEntry);
                this.currentlySelectedConfigs.push(configEntry);
            }
        }

        // If the file already exists but toCreateData is false,
        // this means we are deleting the last element
        if (toCreateData || existsFile) {
            // save findings to file
            const serializedObj: SerializedData = {
                schemaVersion: AUDIT_STATE_SCHEMA_VERSION,
                treeEntries: reducedEntries,
                auditedFiles: filteredAuditedFiles,
                partiallyAuditedFiles: filteredPartiallyAuditedEntries,
                resolvedEntries: reducedResolvedEntries,
            };
            markAuditStateFileAsSelfWritten(fileName);
            writeAuditState(fileName, serializedObj);
        }
    }
}
