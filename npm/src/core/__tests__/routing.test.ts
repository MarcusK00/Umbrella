import type { McpProductModule } from "../module-contract.js";
import { HEALTH_TOOL_NAME, buildRoutingInstructions, buildToolNameIndex, describeTool, prefixToolReferences } from "../routing.js";

const mod = (id: string, useWhen: string[]): McpProductModule => ({
  id, displayName: `Umbraco ${id}`, toolPrefix: `${id}--`, packageName: `@x/${id}`, expectedMajor: "17",
  description: `Umbraco ${id}: does ${id} things.`, useWhen,
  load: async () => { throw new Error("unused"); },
});

describe("describeTool", () => {
  it("prefixes the product display name", () => {
    expect(describeTool({ displayName: "Umbraco Forms" }, "Lists all forms.")).toBe("[Umbraco Forms] Lists all forms.");
  });
});

describe("buildRoutingInstructions", () => {
  const cms = mod("cms", ["content", "media"]);
  const forms = mod("forms", ["forms", "form workflows (after submit)"]);

  it("lists one line per module with prefix, description and useWhen", () => {
    const text = buildRoutingInstructions([cms, forms]);
    expect(text).toContain("- `cms--` Umbraco cms: does cms things. Use for: content; media.");
    expect(text).toContain("- `forms--` Umbraco forms: does forms things. Use for: forms; form workflows (after submit).");
  });

  it("only mentions the modules it is given", () => {
    expect(buildRoutingInstructions([cms])).not.toContain("forms--");
  });

  it("tells the agent to pick a product first and points to the health tool", () => {
    const text = buildRoutingInstructions([cms]);
    expect(text).toMatch(/Pick the product/);
    expect(text).toContain(HEALTH_TOOL_NAME);
  });

  it("only claims product tools are prefixed, since the health tool is not", () => {
    const text = buildRoutingInstructions([cms]);
    expect(text).toContain("Every product tool name starts with its product prefix.");
    expect(text).not.toContain("Every tool name starts");
  });

  it("tells the agent to read a tool's input schema first and never probe with empty arguments", () => {
    const text = buildRoutingInstructions([cms]);
    expect(text).toMatch(/input schema/i);
    expect(text).toMatch(/never call a tool with empty or guessed arguments/i);
  });

  it("appends non-null extras and skips null ones", () => {
    const text = buildRoutingInstructions([cms], [null, "Version mismatch: 18 vs 17"]);
    expect(text.endsWith("\n\nVersion mismatch: 18 vs 17")).toBe(true);
    expect(text).not.toContain("null");
  });
});

describe("prefixToolReferences", () => {
  const forms = { toolPrefix: "forms--" };
  const automate = { toolPrefix: "automate--" };
  const cms = { toolPrefix: "cms--" };
  const index = buildToolNameIndex([
    { module: cms, toolNames: ["create-document-type", "empty-recycle-bin"] },
    { module: forms, toolNames: ["list-forms", "get-form", "get-form-by-id", "empty-recycle-bin", "get-server-info"] },
    { module: automate, toolNames: ["list-workspaces", "get-server-info"] },
  ]);

  it("points a mention of a sibling tool at its registered name", () => {
    expect(prefixToolReferences("Use list-forms first, then get-form.", forms, index))
      .toBe("Use forms--list-forms first, then forms--get-form.");
  });

  it("matches whole tool names only", () => {
    expect(prefixToolReferences("See get-form-by-id.", forms, index)).toBe("See forms--get-form-by-id.");
  });

  it("leaves names that are already prefixed alone", () => {
    expect(prefixToolReferences("Call forms--list-forms.", forms, index)).toBe("Call forms--list-forms.");
  });

  it("prefers the module's own tool when two products share a name", () => {
    expect(prefixToolReferences("Run empty-recycle-bin.", forms, index)).toBe("Run forms--empty-recycle-bin.");
  });

  it("points at another product's tool when only that product has it", () => {
    expect(prefixToolReferences("Add it with create-document-type.", forms, index))
      .toBe("Add it with cms--create-document-type.");
  });

  it("leaves a name alone when it is ambiguous across other products", () => {
    expect(prefixToolReferences("Check get-server-info.", cms, index)).toBe("Check get-server-info.");
  });

  it("leaves hyphenated words that are not tool names alone", () => {
    expect(prefixToolReferences("A read-only, case-insensitive list.", forms, index))
      .toBe("A read-only, case-insensitive list.");
  });
});
