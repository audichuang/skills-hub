export type OnboardingVariant = {
  tool: string
  name: string
  path: string
  fingerprint?: string | null
  is_link: boolean
  link_target?: string | null
}

export type OnboardingGroup = {
  name: string
  variants: OnboardingVariant[]
  has_conflict: boolean
}

export type OnboardingPlan = {
  total_tools_scanned: number
  total_skills_found: number
  groups: OnboardingGroup[]
}

export type ToolOption = {
  id: string
  label: string
}

export type ManagedSkill = {
  id: string
  name: string
  source_type: string
  source_ref?: string | null
  central_path: string
  created_at: number
  updated_at: number
  last_sync_at?: number | null
  status: string
  targets: {
    tool: string
    mode: string
    status: string
    target_path: string
    synced_at?: number | null
  }[]
}

export type GitSkillCandidate = {
  name: string
  description?: string | null
  subpath: string
}

export type LocalSkillCandidate = {
  name: string
  description?: string | null
  subpath: string
  valid: boolean
  reason?: string | null
}

export type InstallResultDto = {
  skill_id: string
  name: string
  central_path: string
  content_hash?: string | null
}

export type ToolInfoDto = {
  key: string
  label: string
  installed: boolean
  skills_dir: string
}

export type ToolStatusDto = {
  tools: ToolInfoDto[]
  installed: string[]
  newly_installed: string[]
}

export type UpdateResultDto = {
  skill_id: string
  name: string
  content_hash?: string | null
  source_revision?: string | null
  updated_targets: string[]
}

export type ClawHubSkill = {
  slug: string
  displayName: string
  summary?: string | null
  version?: string | null
  score: number
  updatedAt?: number | null
}

export type SkillUpdateStatus = {
  skill_id: string
  name: string
  has_update: boolean
  current_rev?: string | null
  remote_rev?: string | null
  error?: string | null
}

export type RemoteHost = {
  id: string
  label: string
  host: string
  port: number
  username: string
  auth_method: string
  key_path?: string | null
  created_at: number
  updated_at: number
  last_sync_at?: number | null
  status: string
}

export type RemoteToolInfoDto = {
  key: string
  label: string
  installed: boolean
}

export type RemoteToolStatusDto = {
  hostId: string
  tools: RemoteToolInfoDto[]
}

export type RemoteSyncResultDto = {
  syncedSkills: string[]
}

export type RemoteSkillsDto = {
  hostId: string
  skills: string[]
}
