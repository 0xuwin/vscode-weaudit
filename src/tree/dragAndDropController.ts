import * as vscode from "vscode";

import { TreeEntry, TreeViewMode, FullLocationEntry, FullEntry, isLocationEntry, isEntry, isPathOrganizerEntry } from "../types";

/** Subset of CodeMarker methods used by drag and drop operations. */
export interface DragAndDropDataProvider {
    getTreeViewMode(): TreeViewMode;
    addNewEntryFromLocationEntry(locationEntry: FullLocationEntry): void;
    refreshTree(): void;
    decorate(): void;
    updateSavedData(author: string): void;
    deleteFinding(entry: FullEntry): void;
}

/**
 * Handles drag and drop of findings and locations in the weAudit tree view.
 */
export class DragAndDropController implements vscode.TreeDragAndDropController<TreeEntry> {
    /* eslint-disable @typescript-eslint/naming-convention */
    private readonly MIME_TYPE = "application/vnd.code.tree.codemarker";
    private readonly LOCATION_MIME_TYPE = "application/vnd.code.tree.codemarker.locationentry";
    private readonly ENTRY_MIME_TYPE = "application/vnd.code.tree.codemarker.entry";
    /* eslint-enable @typescript-eslint/naming-convention */

    dragMimeTypes = [this.LOCATION_MIME_TYPE, this.ENTRY_MIME_TYPE];
    dropMimeTypes = [this.MIME_TYPE, this.LOCATION_MIME_TYPE, this.ENTRY_MIME_TYPE];

    /**
     * @param dataProvider The tree data provider that owns the entries.
     * @param getTreeView Returns the tree view used for reveal operations.
     */
    constructor(
        private readonly dataProvider: DragAndDropDataProvider,
        private readonly getTreeView: () => vscode.TreeView<TreeEntry>,
    ) {}

    handleDrag(source: readonly TreeEntry[], dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void | Thenable<void> {
        // drag and drop in the TreeViewMode.GroupByFile does not make sense unless we wanted to reorder the file list
        if (this.dataProvider.getTreeViewMode() === TreeViewMode.GroupByFile) {
            return;
        }

        if (source.length === 0 || source.length > 1) {
            return;
        }

        const entry = source[0];
        if (isPathOrganizerEntry(entry)) {
            return;
        }
        if (isLocationEntry(entry)) {
            dataTransfer.set(this.LOCATION_MIME_TYPE, new vscode.DataTransferItem(entry));
        } else if (isEntry(entry)) {
            dataTransfer.set(this.ENTRY_MIME_TYPE, new vscode.DataTransferItem(entry));
        }
    }

    async handleDrop(target: TreeEntry | undefined, dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        // drag and drop in the TreeViewMode.GroupByFile does not make sense unless we wanted to reorder the file list
        if (this.dataProvider.getTreeViewMode() === TreeViewMode.GroupByFile) {
            return;
        }

        let data = dataTransfer.get(this.LOCATION_MIME_TYPE);
        if (data === undefined) {
            return;
        }

        if (isLocationEntry(data.value as TreeEntry)) {
            // A LocationEntry is being dragged
            const locationEntry = data.value as FullLocationEntry;

            if (target === undefined) {
                // dragged a location entry into the empty space
                // create a new finding from it

                // remove from previous parent
                locationEntry.parentEntry.locations = locationEntry.parentEntry.locations.filter((loc) => loc !== locationEntry.location);

                // create a new finding with it
                this.dataProvider.addNewEntryFromLocationEntry(locationEntry);

                if (locationEntry.parentEntry.locations.length === 1) {
                    const singleLabel = locationEntry.parentEntry.locations[0].label;
                    if (singleLabel !== "" && !locationEntry.parentEntry.label.includes(singleLabel)) {
                        // if we now only have 1 location, we add the label from the location into the finding
                        locationEntry.parentEntry.label += ` ${singleLabel}`;
                    }
                }

                return;
            }

            if (isPathOrganizerEntry(target)) {
                return;
            }

            const authorSet: Set<string> = new Set();
            authorSet.add(locationEntry.parentEntry.author);

            // Target is an Entry (a finding with only one location, or the root element of a multi-location finding)
            if (isEntry(target)) {
                if (target === locationEntry.parentEntry) {
                    return;
                }

                // Prevent mixing findings that belong to different workspace roots, because it is a headache to synchronize this.
                if (target.locations[0].rootPath !== locationEntry.location.rootPath) {
                    vscode.window.showErrorMessage(
                        "weAudit: Error moving a location to a different finding, as this finding is in a different workspace root.",
                    );
                    return;
                }

                // add the other author
                authorSet.add(target.author);

                // remove from previous parent
                locationEntry.parentEntry.locations = locationEntry.parentEntry.locations.filter((loc) => loc !== locationEntry.location);

                if (locationEntry.parentEntry.locations.length === 1) {
                    const singleLabel = locationEntry.parentEntry.locations[0].label;
                    if (singleLabel !== "" && !locationEntry.parentEntry.label.includes(singleLabel)) {
                        // if we now only have 1 location, we add the label from the location into the finding
                        locationEntry.parentEntry.label += ` ${singleLabel}`;
                    }
                }

                // push at the end of the locations of the target
                target.locations.push(locationEntry.location);
                locationEntry.parentEntry = target;
            } else if (isLocationEntry(target)) {
                // Target is a LocationEntry (a location of a multi-location finding)

                // do nothing if the target is the same as the source
                if (target === locationEntry) {
                    return;
                }

                // Prevent mixing findings that belong to different workspace roots, because it is a headache to synchronize this.
                if (target.location.rootPath !== locationEntry.location.rootPath) {
                    vscode.window.showErrorMessage(
                        "weAudit: Error moving a location to a different finding, as this finding is in a different workspace root.",
                    );
                    return;
                }

                // add the other author
                authorSet.add(target.parentEntry.author);

                // find the source before we remove it
                const sourceIndex = locationEntry.parentEntry.locations.indexOf(locationEntry.location);

                // remove from previous parent
                locationEntry.parentEntry.locations = locationEntry.parentEntry.locations.filter((loc) => loc !== locationEntry.location);

                // find target index
                const targetIndex = target.parentEntry.locations.indexOf(target.location);

                // if the entry is the same as the source, and the source is after the target,
                // insert it before the target. Basically, it prepends to the target location if you dragged from below, and
                // appends if you dragged from above.
                if (locationEntry.parentEntry === target.parentEntry && sourceIndex >= targetIndex + 1) {
                    target.parentEntry.locations.splice(targetIndex, 0, locationEntry.location);
                } else {
                    // otherwise, insert it after the target
                    target.parentEntry.locations.splice(targetIndex + 1, 0, locationEntry.location);
                }

                if (locationEntry.parentEntry.locations.length === 1) {
                    const singleLabel = locationEntry.parentEntry.locations[0].label;
                    if (singleLabel !== "" && !locationEntry.parentEntry.label.includes(singleLabel)) {
                        // if we now only have 1 location, we add the label from the location into the finding
                        locationEntry.parentEntry.label += ` ${singleLabel}`;
                    }
                }
            }
            this.dataProvider.refreshTree();
            this.dataProvider.decorate();

            for (const author of authorSet) {
                this.dataProvider.updateSavedData(author);
            }

            // if the target was an Entry (only one location), we need to expand the dropdown after adding an extra location
            if (isEntry(target) && this.getTreeView().visible) {
                this.getTreeView().reveal(target, { expand: 1, select: false });
            }

            return;
        }

        // if the data is not a location, check if it is an entry
        data = dataTransfer.get(this.ENTRY_MIME_TYPE);
        const value = data?.value as TreeEntry;
        if (data !== undefined && isEntry(value)) {
            // An Entry is being dragged
            const entry = value;

            // an undefined target means we dragged an Entry to the empty space
            // that would move it to the bottom.
            // We currently don't support reordering the entries
            if (target === undefined) {
                return;
            }

            if (isPathOrganizerEntry(target)) {
                return;
            }

            // if we drop it on a location,
            // get its parent entry and continue to the next if statement
            if (isLocationEntry(target)) {
                target = target.parentEntry;
            }

            // Prevent mixing findings that belong to different workspace roots, because it is a headache to synchronize this.
            if (target.locations[0].rootPath !== entry.locations[0].rootPath) {
                vscode.window.showErrorMessage("weAudit: Error merging findings, as this finding is in a different workspace root.");
                return;
            }

            if (isEntry(target)) {
                // don't do anything if the target is the same as the source
                if (target === entry) {
                    return;
                }

                // decide what to do if the source entry has details
                // - join the details to the new one
                // - discard the details but drag
                // - discard the drag and drop action
                const entryDescription = String(entry.details.description ?? "");
                const entryExploit = String(entry.details.exploit ?? "");
                if (entryDescription !== "" || entryExploit !== "") {
                    const choice = await vscode.window
                        .showWarningMessage(
                            "The item being dragged contains detailed information. Do you want to...",
                            "Join details",
                            "Discard old details",
                            "Cancel",
                        )
                        .then((choice) => {
                            return choice;
                        });

                    // if the user discarded the dialog cancel handling the drag
                    if (choice === undefined) {
                        return;
                    }

                    switch (choice) {
                        case "Join details": {
                            const targetDescription = String(target.details.description ?? "");
                            const targetExploit = String(target.details.exploit ?? "");
                            if (targetDescription !== "") {
                                target.details.description = `${targetDescription}\n`;
                            }
                            target.details.description = `${String(target.details.description ?? "")}${entryDescription}`;

                            if (targetExploit !== "") {
                                target.details.exploit = `${targetExploit}\n`;
                            }
                            target.details.exploit = `${String(target.details.exploit ?? "")}${entryExploit}`;
                            break;
                        }

                        case "Discard old details":
                            break;

                        case "Cancel":
                            return;
                    }
                }

                if (target.locations.length === 1 && target.locations[0].label === "") {
                    target.locations[0].label = target.label;
                }

                // add the authors
                const authorSet: Set<string> = new Set();
                authorSet.add(entry.author);
                authorSet.add(target.author);

                for (const loc of entry.locations) {
                    target.locations.push(loc);
                }

                this.dataProvider.deleteFinding(entry);
                this.dataProvider.refreshTree();
                this.dataProvider.decorate();

                if (this.getTreeView().visible) {
                    this.getTreeView().reveal(target, { expand: 1, select: false });
                }

                for (const author of authorSet) {
                    this.dataProvider.updateSavedData(author);
                }
            }
            return;
        }
    }
}
