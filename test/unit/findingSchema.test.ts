import { expect } from "chai";

import { createDefaultFindingSchemaFields, createFixedFindingSchemaFields } from "../../src/findingSchema/defaults";
import { validateFindingSchemaFields } from "../../src/findingSchema/validation";

describe("findingSchema", () => {
    describe("defaults", () => {
        it("creates fixed title, severity, and description fields", () => {
            const fields = createFixedFindingSchemaFields();

            expect(fields.map((field) => field.key)).to.deep.equal(["title", "severity", "description"]);
        });

        it("creates default configurable fields for the previous details form", () => {
            const fields = createDefaultFindingSchemaFields();

            expect(fields.map((field) => field.key)).to.deep.equal(["difficulty", "type", "exploit", "recommendation"]);
            expect(fields.every((field) => field.visibleWhen?.field === "severity")).to.equal(true);
        });
    });

    describe("validation", () => {
        it("accepts valid field definitions", () => {
            const result = validateFindingSchemaFields([
                { key: "confirmed", label: "Confirmed", type: "checkbox" },
                { key: "impact", label: "Impact", type: "textarea", rows: 6 },
                { key: "category", label: "Category", type: "select", options: ["", "A", "B"] },
            ]);

            expect(result.errors).to.deep.equal([]);
        });

        it("rejects duplicate keys", () => {
            const result = validateFindingSchemaFields([
                { key: "impact", label: "Impact", type: "text" },
                { key: "impact", label: "Impact Again", type: "text" },
            ]);

            expect(result.errors.some((error) => error.includes("duplicated"))).to.equal(true);
        });

        it("requires options for select fields", () => {
            const result = validateFindingSchemaFields([{ key: "category", label: "Category", type: "select" }]);

            expect(result.errors.some((error) => error.includes("options is required"))).to.equal(true);
        });

        it("validates visibleWhen rules", () => {
            const result = validateFindingSchemaFields([{ key: "extra", label: "Extra", type: "text", visibleWhen: { field: "severity" } }]);

            expect(result.errors.some((error) => error.includes("equals or notEquals"))).to.equal(true);
        });
    });
});
