namespace Umbraco.Mcp.Client;

/// <summary>Settings under <c>Umbraco:Mcp:McpJson</c> for the <c>.mcp.json</c> the site writes in Development.</summary>
public sealed class McpJsonOptions
{
    public const string Section = "Umbraco:Mcp:McpJson";

    /// <summary>Set to false to never write the file.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>The folder to write <c>.mcp.json</c> to, relative to the site's content root. Defaults to the content root.</summary>
    public string? Path { get; set; }

    /// <summary>Overrides the command that starts the server. Defaults to <c>npx</c>.</summary>
    public string? Command { get; set; }

    /// <summary>Overrides the command's arguments. Defaults to <c>-y umbrella-mcp@&lt;add-on version&gt;</c>.</summary>
    public string[]? Args { get; set; }
}
