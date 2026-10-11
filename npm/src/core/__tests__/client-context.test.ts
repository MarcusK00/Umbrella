import { getApiClient } from "@umbraco-cms/mcp-server-sdk";
import { bindClient, installClientContext } from "../client-context.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("client context", () => {
  beforeEach(() => installClientContext(() => "default-client"));

  it("falls back to the default client outside any bound call", () => {
    expect(getApiClient()).toBe("default-client");
  });

  it("gives each concurrent, interleaved call its own client", async () => {
    const slowForms = bindClient(() => "forms-client", async () => {
      await sleep(20);
      return getApiClient();
    });
    const fastAutomate = bindClient(() => "automate-client", async () => {
      await sleep(5);
      const first = getApiClient();
      await sleep(20);
      return [first, getApiClient()];
    });

    const [forms, automate] = await Promise.all([slowForms(), fastAutomate()]);

    expect(forms).toBe("forms-client");
    expect(automate).toEqual(["automate-client", "automate-client"]);
    expect(getApiClient()).toBe("default-client");
  });

  it("passes arguments and return values through", async () => {
    const handler = bindClient(() => "x", async (a: number, b: number) => a + b);
    await expect(handler(2, 3)).resolves.toBe(5);
  });
});
