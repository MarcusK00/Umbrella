# Security policy

## Reporting a vulnerability

Please don't report security vulnerabilities in a public issue.

Report them privately through GitHub: **[Report a vulnerability](https://github.com/MarcusK00/Umbrella/security/advisories/new)** (the Security tab of this repository). Only the maintainer can see the report.

Include:

- the affected package (`Umbraco.Community.Umbrella` or `umbrella-mcp`) and version
- what an attacker can do, and what they need first (for example an API user, a backoffice login, access to the developer's machine)
- steps to reproduce, or a proof of concept

You'll get a reply as soon as possible. Umbrella is a community project maintained in spare time, so there is no guaranteed response time.

## Scope

In scope: the `Umbraco.Community.Umbrella` NuGet package and the `umbrella-mcp` npm package.

Out of scope, report these to the product's own maintainers:

- Umbraco CMS, Forms, Automate and Engage, and their Management APIs: [Umbraco's security policy](https://umbraco.com/trust-center/security-and-umbraco/how-to-report-a-vulnerability-in-umbraco/)
- The product MCP packages Umbrella loads (`@umbraco-cms/mcp-dev`, `@umbraco-forms/mcp`, `@umbraco-automate/mcp`, `@umbraco-engage/mcp`) and `@umbraco-cms/mcp-server-sdk`

Tool settings in the Umbrella dashboard (Off, Read-only, No deletes) are guardrails applied by the MCP server on the developer's machine, not access control. The API user's groups and sections in Umbraco are the security boundary, so bypassing a tool setting with the API user's own credentials is not a vulnerability.

## Supported versions

Only the latest release of both packages gets fixes.
