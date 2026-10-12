/** "Destructive" is exactly what a product flags with `destructiveHint`; Umbrella keeps no list of its own. */
export function isDestructive(tool: { annotations?: { destructiveHint?: boolean } }): boolean {
  return tool.annotations?.destructiveHint === true;
}
