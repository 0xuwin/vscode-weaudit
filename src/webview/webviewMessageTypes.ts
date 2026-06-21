import type { DetailValue } from "../types";
import type { FindingSchema } from "../findingSchema/types";

export type WebviewMessage =
    | UpdateEntryMessage
    | UpdateRepositoryMessage
    | WebviewIsReadyMessage
    | ChooseWorkspaceRootMessage
    | SetWorkspaceRootsMessage
    | SetFindingDetailsMessage;

export interface SetFindingDetailsMessage {
    command: "set-finding-details";
    title: string;
    details: Record<string, DetailValue | undefined>;
    schema: FindingSchema;
}

export interface UpdateEntryMessage {
    command: "update-entry";
    field: string;
    value: DetailValue;
    isPersistent: boolean;
}

export interface UpdateRepositoryMessage {
    command: "update-repository-config";
    rootLabel: string;
    clientURL: string;
    auditURL: string;
    commitHash: string;
    cqIssueNumber: string;
}

export interface ChooseWorkspaceRootMessage {
    command: "choose-workspace-root";
    rootLabel: string;
}

export interface SetWorkspaceRootsMessage {
    command: "set-workspace-roots";
    rootLabels: string[];
}

export interface WebviewIsReadyMessage {
    command: "webview-ready";
}
