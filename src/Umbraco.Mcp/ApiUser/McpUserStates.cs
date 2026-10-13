using Umbraco.Cms.Core.Models.Membership;

namespace Umbraco.Mcp.ApiUser;

internal static class McpUserStates
{
    /// <summary>The state name the dashboard uses: "disabled", "lockedOut", otherwise "active".</summary>
    public static string Name(UserState state) => state switch
    {
        UserState.Disabled => "disabled",
        UserState.LockedOut => "lockedOut",
        _ => "active",
    };
}
