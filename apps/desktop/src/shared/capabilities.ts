/** How standing rules change, as every agent is told it. */
export const RULE_WRITING_POLICY =
  'Only the person and the profile that created an agent can change its standing rules; any conversation of that profile counts, and when no creating profile is recorded, only the person can. Being the same profile as the agent gives no right to change its rules: an agent never writes its own, and keeps its own notes instead. Anyone else, the agent included, can propose a change, and the person decides a proposal. Each version keeps its author and reason, and can be undone.'

/** What `list_profiles` counts, said beside the number. */
export const EVERY_AGENT_THIS_APP_HOLDS =
  'This counts every agent this app holds; any of them can be named to give_work.'
