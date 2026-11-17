import type {
  AnyCapabilityField,
  CapabilityKey,
  ConversationAtLaunch,
  ProfileCapabilities,
} from '../../src/shared/capabilities'

function grantSays(
  field: AnyCapabilityField,
  allowed: ProfileCapabilities,
  at: ConversationAtLaunch | null,
): string {
  const says = field.says as (
    held: ProfileCapabilities[CapabilityKey],
    at: ConversationAtLaunch | null,
  ) => string
  return says(allowed[field.key], at)
}
