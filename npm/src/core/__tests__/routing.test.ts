import type { McpProductModule } from "../module-contract.js";
import { HEALTH_TOOL_NAME, buildRoutingInstructions, describeTool } from "../routing.js";

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

  it("appends non-null extras and skips null ones", () => {
    const text = buildRoutingInstructions([cms], [null, "Version mismatch: 18 vs 17"]);
    expect(text.endsWith("\n\nVersion mismatch: 18 vs 17")).toBe(true);
    expect(text).not.toContain("null");
  });
});
