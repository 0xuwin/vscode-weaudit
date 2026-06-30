<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/trailofbits/vscode-weaudit/main/media/banner-dark-mode.png">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/trailofbits/vscode-weaudit/main/media/banner-light-mode.png">
  <img alt="weAudit banner" src="https://raw.githubusercontent.com/trailofbits/vscode-weaudit/main/media/banner-dark-mode.png">
</picture>

[![Tests](https://github.com/trailofbits/vscode-weaudit/actions/workflows/test.yml/badge.svg)](https://github.com/trailofbits/vscode-weaudit/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/trailofbits/vscode-weaudit/branch/main/graph/badge.svg)](https://codecov.io/gh/trailofbits/vscode-weaudit)

# weAudit - A collaborative code review tool for VSCode

### [Release Blogpost](https://blog.trailofbits.com/2024/03/19/read-code-like-a-pro-with-our-weaudit-vscode-extension/) | [Installation](#installation) | [Features](#features)

WeAudit is an essential extension in the arsenal of any code auditor.

With weAudit, you can bookmark regions of code to highlight issues, add notes, mark files as reviewed, and collaborate with your fellow auditors. Enhance your reporting workflow by writing findings directly in VS Code, copying formatted Markdown, and copying links. For the stats lovers, analyze your audit progress with the daily log, showing the number of files and LOC audited per day.

![Screenshot](media/readme/screenshot.png)

## Installation

Install weAudit directly from [weAudit @ VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=trailofbits.weaudit).

See the [Build and install](#build-and-install) section below for how to build and install from source.



## Features

-   [**Findings and Notes**](#findings-and-notes) - Bookmark regions of code to identify findings or to add audit notes.
-   [**Audited Files**](#audited-files) - Mark an entire file as reviewed.
-   [**Partially Audited Files**](#partially-audited-files) - Mark a region of code as reviewed.
-   [**Detailed Findings**](#detailed-findings) - Fill detailed information about a finding.
-   [**Copy as Markdown**](#copy-as-markdown) - Copy formatted finding details as Markdown.
-   [**Multi-region Findings**](#multi-region-findings) - Group multiple locations under a single finding.
-   [**Resolve and Restore**](#resolve-and-restore) - Resolved findings will not be highlighted in the editor but are still visible in the sidebar.
-   [**Copy Permalinks**](#copy-permalinks) - Copy source permalinks to findings, or to a selected code region.
-   [**Daily Log**](#daily-log) - View a daily log of all the marked files and LOC per day.
-   [**View Mode**](#view-mode) - View findings in a list, or grouped by filename.
-   [**Multiple Users**](#multiple-users) - Findings can be viewed from multiple different users.
-   [**Hide Findings**](#hide-findings) - Hide all findings associated with a specific user.
-   [**Search & Filter Findings**](#search--filter-findings) - Search and filter the findings in the _List of Findings_ panel.
-   [**Export Findings**](#export-findings) - Export findings to a markdown file.
-   [**External Finding Edits**](#external-finding-edits) - Keep the UI in sync when tools edit `.weaudit` files.
-   [**Drag & drop Findings and Locations**](#drag--drop-findings-and-locations) - Drag and drop findings and locations in the _List of Findings_ panel.
-   [**Project Config**](#project-config) - Configure repositories, versions, and project metadata in `.vscode/info.json`.
-   [**Finding Schema**](#finding-schema) - Customize finding detail fields, severity options, and tree labels.
-   [**Settings**](#settings) - Customize colors and general preferences.

---

### Findings and Notes

Findings and notes can be added to the current selection by calling the `weAudit: New Finding from Selection` or `weAudit: New Note from Selection` commands, or their respective keyboard shortcuts. The selected code will be highlighted in the editor, and an item added to the _List of Findings_ view in the sidebar.

![Create Finding](media/readme/gifs/create_finding.gif)

Clicking on a finding in the _List of Findings_ view will navigate to the region of code previously marked.

A file with a finding will have a `!` annotation that is visible both in the file tree, and in the file name above the editor.

![File annotation](media/readme/finding_marker.png)

The highlighted colors can be customized in the [settings](#settings).

### Audited Files

After reviewing a file, you can mark it as audited by calling the `weAudit: Mark File as Reviewed` command, or its respective keyboard shortcut. The whole file will be highlighted and annotated with a `✓` in the file tree, and in the file name above the editor.

![Mark File as Reviewed](media/readme/gifs/mark_audited.gif)

The highlighted color can be customized in the [settings](#settings).

### Partially Audited Files

You can also partially mark a file as reviewed by selecting a region of code and calling the `weAudit: Mark Region as Reviewed` command. Partially reviewed regions can be merged together by calling the same command on a region containing.
If called on a region:
 - that matches an already audited region, the region will be unmarked.
 - containing an already audited region, the region will be extended.
 - contained in an already audited region, the region will be split into two regions.

Once a file is marked as audited with the `weAudit: Mark File as Reviewed` command, all partial regions will be discarded.

The following gif showcases all the scenarios described:
![Mark Region as Reviewed](media/readme/gifs/mark_region_audited.gif)

The highlighted color can be customized in the [settings](#settings).

#### Navigation Between Partially Audited Regions

You can quickly navigate through all partially audited regions in your workspace using the `weAudit: Navigate to Next Partially Audited Region` command. This command will cycle through each partially audited region across all files, helping you efficiently review your progress.

### Detailed Findings

You can fill detailed information about a finding by clicking on it in the _List of Findings_ view in the sidebar. The respective _Finding Details_ panel will open, where you can fill the information.

![Finding Details](media/readme/finding_details.png)

### Copy as Markdown

You can copy a finding's detailed information as Markdown by clicking the `Copy as Markdown` button in the _List of Findings_ panel or the same button in the _Finding Details_ view. The copied Markdown includes the finding detail fields (rendered from the configured schema) followed by code references with file paths, line ranges, and code snippets.

![Copy as Markdown](media/readme/gifs/create_gh_issue.gif)

### Multi-region Findings

You can add multiple regions to a single finding or note. Once you select the code region to be added, call the `weAudit: Add Region to a Finding` and select the finding to add the region to from the quick pick menu. The regions will be highlighted in the editor, and the finding will be updated in the _List of Findings_ panel.

![Add Region to a Finding](media/readme/gifs/multi_region_finding.gif)

### Boundary Editing

Need to tweak the highlighted range for an existing finding? Run the `weAudit: Edit Finding Boundary` command to enter boundary editing mode. weAudit shows a set of inline CodeLens controls at the top and bottom of the region so you can expand, shrink, or move the selection and click `Done` when you are satisfied.

You can also use the dedicated keyboard shortcuts to make quick adjustments without touching the mouse. These shortcuts automatically focus the relevant finding, so you can adjust boundaries from the keyboard only.

### Resolve and Restore

You can resolve a finding by clicking on the corresponding `Resolve` button in the _List of Findings_ panel. The finding will no longer be highlighted in the editor, but will still be visible in the _Resolved Findings_ panel. You can restore a resolved finding by clicking on the corresponding `Restore` button in the _Resolved Findings_ panel.

![Resolve and Restore](media/readme/gifs/resolve_finding.gif)

### Copy Permalinks

Copy a source permalink by clicking on the corresponding `Copy Audit Permalink` button in the _List of Findings_ panel. Permalinks are resolved from `.vscode/info.json` — the matching repository's remote and version commit are used to generate the URL.

![Copy Audit Permalink](media/readme/copy_permalink.png)

Copy a permalink to any code region by right clicking and selecting one of the `weAudit: Copy Permalink` options in the context menu.

![Copy Audit Permalink](media/readme/copy_permalink_context.png)

### Daily Log

You can view a daily log of all the marked files and LOC per day by clicking on the `Daily Log` button in the _List of Findings_ panel.

![Daily Log](media/readme/daily_log.png)

You can also view the daily log by calling the `weAudit: Show Daily Log` command in the command pallette, or its respective keyboard shortcut.

### View Mode

You can view findings in a list, or grouped by filename by clicking on the `View Mode` button in the _List of Findings_ panel.

![View Mode](media/readme/view_mode.png)

![View Mode](media/readme/view_mode_grouped.png)

### Multiple Users

You can share the weAudit file with your co-auditors to share findings. This JSON file is located in the `.vscode` folder in your workspace named `$USERNAME.weaudit`. It stores user-level audit state such as findings, notes, locations, resolved findings, audited files, partially audited ranges, and finding detail fields.

In the `weAudit Files` panel, you can toggle to show or hide the findings from each user by clicking on the entries.
There are color settings for other user's findings and notes, and for your own findings and notes.

![Multiple Users](media/readme/multi_user.png)

### Project Config

Project-level metadata can be stored in `.vscode/info.json`. This JSON file is intended for shared facts such as client/target metadata, repositories, repository roots, audit scope, and named versions/commits.

Run `weAudit: Initialize Project Config` from the Command Palette to create `.vscode/info.json` for the current workspace. Run `weAudit: Validate Project Config` to check that the file has the expected schema, unique repository names, workspace-relative repository roots, and unique version names within each repository.

When `.vscode/info.json` is present and valid, permalink commands resolve repository remotes and commits from the matching repository/version in that file. Locations are matched by explicit `repo`/`version` metadata when available, otherwise by the longest repository `root` prefix.

### Finding Schema

The Finding Details panel renders fixed `title` and `description` fields plus any additional fields configured in `weAudit.findingSchema.fields`. Severity is a configurable schema field; the default configuration includes a `severity` select field, but workspaces can replace it with their own options. Finding labels in the tree can be rendered from `weAudit.findingSchema.labelTemplate`, using placeholders such as `${title}`, `${severity}`, and custom detail fields. Dynamic fields support `text`, `textarea`, `select`, `checkbox`, and `number` controls, with optional `visibleWhen` rules for conditionally showing fields based on other detail values.

### Hide Findings
You can hide all findings associated with a specific user by clicking on that user's name on the  `weAudit Files` panel.

![Hide Findings associated to a user](media/readme/gifs/hide_findings.gif)

### Toggle Highlights
Hide every findings/notes highlight in the editor by running the `weAudit: Toggle Findings Highlighting` command from the Command Palette. Run the command again to bring the highlights back whenever you need to review them.

### Search & Filter Findings
You can search for and filter the findings in the `List of Findings` panel by calling the `weAudit: Search and Filter Findings` command.

![Filter Findings](media/readme/gifs/filter_findings.gif)

### Export Findings
You can export the findings to a markdown file by calling the `weAudit: Export Findings as Markdown` command.

### External Finding Edits

weAudit watches `.vscode/*.weaudit` files for external edits. This lets LLM agents and other tools update saved finding JSON directly; when a watched file changes, weAudit reloads the currently visible finding files from disk and refreshes the tree, resolved findings, and editor highlights. You can also run `weAudit: Reload Findings from Disk` manually if a file watcher event is missed.

When editing `.weaudit` files directly, note that line numbers are zero-based, `entryType` is `0` for findings and `1` for notes, and serialized location snippets use the `code_snippet` field name.

### Drag & Drop Findings and Locations
You can drag and drop findings and locations in the _List of Findings_ panel to:
- drag a location (from a multi location finding) into another finding;
- drag a location (from a multi location finding) to create a separate finding;
- drag a multi-location finding into another finding, moving all locations into it;
- reorder locations within a single finding.

![Drag & Drop Findings and Locations](media/readme/gifs/drag_drop.gif)

### Settings

#### General settings

-   `weAudit.general.treeViewMode`: The List of Findings display mode ("list" or "byFile")
-   `weAudit.general.username`: Username to use as finding's author (defaults to system username if empty)
-   `weAudit.general.permalinkSeparator`: Separator to use in permalinks (\\n is interpreted as newline)
-   `weAudit.general.sortEntriesAlphabetically`: Sort findings and notes alphabetically by name in the tree view

#### Finding Schema settings

-   `weAudit.findingSchema.fields`: Additional finding detail fields rendered after title and description. Supports `text`, `textarea`, `select`, `checkbox`, and `number` types with optional `visibleWhen` conditional visibility rules.
-   `weAudit.findingSchema.labelTemplate`: Template for rendering finding labels in the tree view (e.g. `[${severity}] ${title}`). Notes are not affected.

#### Background colors

Each background color is customizable via the VSCode settings page. Write as #RGB, #RGBA, #RRGGBB or #RRGGBBAA:

-   `weAudit.auditedColor`: Background color for files marked as audited
-   `weAudit.{other,own}findingColor`: Background color for findings
-   `weAudit.{other,own}noteColor`: Background color for notes

#### Keybindings

You can configure the keybindings to any of the extension's commands in the VSCode settings. The default shortcuts are:

-   `weAudit.addFinding`: New Finding from Selection: `cmd + 3`
-   `weAudit.addNote`: New Note from Selection: `cmd + 4`
-   `weAudit.addRegionToAnEntry`: Add Region to a Finding: `cmd + 5`
-   `weAudit.deleteLocationUnderCursor`: Delete Location Under Cursor: `cmd + 6`
-   `weAudit.addPartiallyAudited`: Mark Region as Reviewed: `cmd + 7`
-   `weAudit.navigateToNextPartiallyAuditedRegion`: Navigate to Next Partially Audited Region: `cmd + 0`
-   `weAudit.boundaryExpandUp`: Expand Finding Up: `cmd + shift + numpad7`
-   `weAudit.boundaryMoveUp`: Move Finding Up: `cmd + shift + numpad8`
-   `weAudit.boundaryShrinkTop`: Shrink Finding from Top: `cmd + shift + numpad9`
-   `weAudit.boundaryExpandDown`: Expand Finding Down: `cmd + shift + numpad1`
-   `weAudit.boundaryMoveDown`: Move Finding Down: `cmd + shift + numpad2`
-   `weAudit.boundaryShrinkBottom`: Shrink Finding from Bottom: `cmd + shift + numpad3`
-   `weAudit.editFindingBoundary`: Start Boundary Editing (when not editing): `cmd + shift + numpad5`
-   `weAudit.stopEditingBoundary`: Finish Boundary Editing (when editing): `cmd + shift + numpad5`

## WeAudit Concepts

-   **Findings and Notes**: A region of code that is of interest. Findings can be marked as "Resolved" or "Restored". There is no actual difference between findings and notes, except that they can be assigned different colors. By default, findings are displayed before notes in the _List of Findings_ panel.
-   **Audited Files**: A file that has been reviewed. This is a binary state, either a file is audited or it is not.
-   **Project Repositories**: Repositories are declared in `.vscode/info.json`, including their workspace-relative roots, remotes, and named versions/commits. weAudit uses this project config to resolve source permalinks and reporting metadata.


## Development

### Build and install

To build and install a new vsix file run the following script:

```bash
npm install
./install.sh
```

### Linting and Formatting

We use ESLint and Biome to enforce a consistent code style.

```bash
# run ESLint
npx eslint -c .eslintrc.cjs .

# run Biome formatter
npx biome format --write .
```
