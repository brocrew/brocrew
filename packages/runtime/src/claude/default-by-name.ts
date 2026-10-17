/**
 * Use the CLI's fixed default alias without fetching its model list. Fall back to medium effort
 * to limit usage; this is an app choice, since the model list reports no default effort per row.
 * It can be lower than the resolved model's own default. Apply it only when no conversation,
 * person, give, agent default or previous pick supplied an effort; preserve explicit choices.
 */
export const CLAUDE_DEFAULT_BY_NAME = { model: 'default', effort: 'medium' } as const
