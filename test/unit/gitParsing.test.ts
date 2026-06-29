import * as assert from "node:assert";

import { normalizeGitRemote } from "../../src/projectConfig/gitRemote";

describe("Git Config Parsing Logic", () => {
    const remoteUrlPattern = /url = (.*)/g;

    describe("remote URL extraction", () => {
        it("should extract HTTPS URL from git config", () => {
            const gitConfig = `[remote "origin"]
    url = https://example.com/trailofbits/vscode-weaudit.git
    fetch = +refs/heads/*:refs/remotes/origin/*`;

            const matches = gitConfig.match(remoteUrlPattern);
            assert.ok(matches);
            assert.strictEqual(matches.length, 1);
            assert.ok(matches[0].includes("https://example.com/trailofbits/vscode-weaudit.git"));
        });

        it("should extract SSH URL from git config", () => {
            const gitConfig = `[remote "origin"]
    url = git@example.com:trailofbits/vscode-weaudit.git
    fetch = +refs/heads/*:refs/remotes/origin/*`;

            const matches = gitConfig.match(remoteUrlPattern);
            assert.ok(matches);
            assert.strictEqual(matches.length, 1);
            assert.ok(matches[0].includes("git@example.com:trailofbits/vscode-weaudit.git"));
        });

        it("should extract multiple remotes from git config", () => {
            const gitConfig = `[remote "origin"]
    url = https://example.com/trailofbits/vscode-weaudit.git
    fetch = +refs/heads/*:refs/remotes/origin/*
[remote "upstream"]
    url = git@gitlab.com:client/vscode-weaudit.git
    fetch = +refs/heads/*:refs/remotes/upstream/*`;

            const matches = gitConfig.match(remoteUrlPattern);
            assert.ok(matches);
            assert.strictEqual(matches.length, 2);
        });
    });

    describe("remote normalization", () => {
        it("should convert generic SSH remote URLs to HTTPS URLs", () => {
            assert.strictEqual(normalizeGitRemote("git@example.com:trailofbits/vscode-weaudit.git"), "https://example.com/trailofbits/vscode-weaudit");
            assert.strictEqual(normalizeGitRemote("git@gitlab.com:org/repo.git"), "https://gitlab.com/org/repo");
            assert.strictEqual(normalizeGitRemote("git@bitbucket.org:team/repo.git"), "https://bitbucket.org/team/repo");
        });

        it("should preserve HTTPS URLs while removing .git suffix", () => {
            assert.strictEqual(normalizeGitRemote("https://example.com/trailofbits/vscode-weaudit.git"), "https://example.com/trailofbits/vscode-weaudit");
        });

        it("should preserve URLs without .git suffix", () => {
            assert.strictEqual(normalizeGitRemote("https://example.com/trailofbits/vscode-weaudit"), "https://example.com/trailofbits/vscode-weaudit");
        });
    });
});
