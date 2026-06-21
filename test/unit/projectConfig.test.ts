import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expect } from "chai";

import { getProjectConfigPath, readProjectConfig, writeProjectConfig } from "../../src/projectConfig/storage";
import { PROJECT_CONFIG_SCHEMA_VERSION, ProjectConfig } from "../../src/projectConfig/types";
import { isValidProjectConfig, validateProjectConfig } from "../../src/projectConfig/validation";
import { resolveProjectRepository } from "../../src/projectConfig/resolution";

/**
 * Creates a valid project config for validation tests.
 */
function createValidProjectConfig(): ProjectConfig {
    return {
        schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
        project: {
            client: "Client",
            target: "Target",
            description: "Description",
        },
        repositories: [
            {
                name: "core",
                root: "packages/core",
                remote: "https://github.com/example/core",
                scope: {
                    include: ["contracts/**/*.sol"],
                    exclude: ["test/**"],
                },
                versions: [
                    { name: "Version 0", commit: "abc123" },
                    { name: "Version 1", commit: "def456" },
                ],
            },
        ],
    };
}

describe("projectConfig", () => {
    let workspaceRoot: string;

    beforeEach(() => {
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "weaudit-project-config-"));
        fs.mkdirSync(path.join(workspaceRoot, "packages", "core"), { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    describe("storage", () => {
        it("returns the fixed .vscode/info.json path", () => {
            expect(getProjectConfigPath(workspaceRoot)).to.equal(path.join(workspaceRoot, ".vscode", "info.json"));
        });

        it("writes and reads project config JSON", () => {
            const filePath = getProjectConfigPath(workspaceRoot);
            const config = createValidProjectConfig();

            writeProjectConfig(filePath, config);
            const parsed = readProjectConfig(filePath);

            expect(parsed).to.deep.equal(config);
        });
    });

    describe("validation", () => {
        it("accepts a valid project config", () => {
            const result = validateProjectConfig(createValidProjectConfig(), workspaceRoot);
            expect(isValidProjectConfig(result)).to.equal(true);
            expect(result.warnings).to.deep.equal([]);
        });

        it("rejects missing schemaVersion", () => {
            const config: any = createValidProjectConfig();
            delete config.schemaVersion;

            const result = validateProjectConfig(config, workspaceRoot);

            expect(result.errors.map((error) => error.path)).to.include("schemaVersion");
        });

        it("rejects empty repositories", () => {
            const config = createValidProjectConfig();
            config.repositories = [];

            const result = validateProjectConfig(config, workspaceRoot);

            expect(result.errors.map((error) => error.path)).to.include("repositories");
        });

        it("rejects duplicate repository names", () => {
            const config = createValidProjectConfig();
            config.repositories.push({ ...config.repositories[0] });

            const result = validateProjectConfig(config, workspaceRoot);

            expect(result.errors.some((error) => error.message.includes("duplicated"))).to.equal(true);
        });

        it("rejects repository roots outside the workspace", () => {
            const config = createValidProjectConfig();
            config.repositories[0].root = "../outside";

            const result = validateProjectConfig(config, workspaceRoot);

            expect(result.errors.map((error) => error.path)).to.include("repositories[0].root");
        });

        it("rejects duplicate version names within a repository", () => {
            const config = createValidProjectConfig();
            config.repositories[0].versions?.push({ name: "Version 0", commit: "789abc" });

            const result = validateProjectConfig(config, workspaceRoot);

            expect(result.errors.some((error) => error.path === "repositories[0].versions[2].name")).to.equal(true);
        });

        it("warns when project client or target is missing", () => {
            const config = createValidProjectConfig();
            config.project = {};

            const result = validateProjectConfig(config, workspaceRoot);

            expect(isValidProjectConfig(result)).to.equal(true);
            expect(result.warnings.map((warning) => warning.path)).to.include("project.client");
            expect(result.warnings.map((warning) => warning.path)).to.include("project.target");
        });
    });

    describe("resolution", () => {
        it("resolves repositories with the longest root-prefix match", () => {
            const config = createValidProjectConfig();
            config.repositories.push({ name: "root", root: ".", remote: "https://github.com/example/root", versions: [{ name: "Current", commit: "root" }] });

            const resolved = resolveProjectRepository(config, {
                path: "packages/core/contracts/Token.sol",
                startLine: 1,
                endLine: 2,
                label: "",
            });

            expect(resolved?.repository.name).to.equal("core");
            expect(resolved?.path).to.equal("contracts/Token.sol");
            expect(resolved?.commit).to.equal("abc123");
        });

        it("honors explicit repository and version hints on locations", () => {
            const config = createValidProjectConfig();
            const resolved = resolveProjectRepository(config, {
                path: "packages/core/contracts/Token.sol",
                startLine: 1,
                endLine: 2,
                label: "",
                repo: "core",
                version: "Version 1",
            });

            expect(resolved?.repository.name).to.equal("core");
            expect(resolved?.version?.name).to.equal("Version 1");
            expect(resolved?.commit).to.equal("def456");
        });

        it("lets location commit override the configured version commit", () => {
            const config = createValidProjectConfig();
            const resolved = resolveProjectRepository(config, {
                path: "packages/core/contracts/Token.sol",
                startLine: 1,
                endLine: 2,
                label: "",
                commit: "override",
            });

            expect(resolved?.commit).to.equal("override");
        });

        it("returns undefined when no repository matches", () => {
            const config = createValidProjectConfig();
            const resolved = resolveProjectRepository(config, {
                path: "packages/other/contracts/Token.sol",
                startLine: 1,
                endLine: 2,
                label: "",
            });

            expect(resolved).to.equal(undefined);
        });
    });
});
