import { memo, useState } from 'react'
import { ArrowUpCircle, Box, Cloud, Copy, Folder, Github, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import type { CustomTarget, ManagedSkill, RemoteHost, RemoteSkillsDto, RemoteToolInfoDto, ToolOption } from './types'

type GithubInfo = {
  label: string
  href: string
}

type SkillCardProps = {
  skill: ManagedSkill
  installedTools: ToolOption[]
  loading: boolean
  getGithubInfo: (url: string | null | undefined) => GithubInfo | null
  getSkillSourceLabel: (skill: ManagedSkill) => string
  formatRelative: (ms: number | null | undefined) => string
  hasUpdate?: boolean
  onUpdate: (skill: ManagedSkill) => void
  onDelete: (skillId: string) => void
  onToggleTool: (skill: ManagedSkill, toolId: string) => void
  onViewDetail: (skill: ManagedSkill) => void
  remoteHosts: RemoteHost[]
  remoteSkillStatuses: Record<string, RemoteSkillsDto>
  remoteToolStatuses: Record<string, RemoteToolInfoDto[]>
  onSyncToRemote: (skill: ManagedSkill, hostId: string) => void
  remoteSyncing: string | null
  customTargets: CustomTarget[]
  onToggleCustomTarget: (skill: ManagedSkill, customTargetId: string) => void
  t: TFunction
}

const SkillCard = ({
  skill,
  installedTools,
  loading,
  getGithubInfo,
  getSkillSourceLabel,
  formatRelative,
  hasUpdate,
  onUpdate,
  onDelete,
  onToggleTool,
  onViewDetail,
  remoteHosts,
  remoteSkillStatuses,
  remoteToolStatuses,
  onSyncToRemote,
  remoteSyncing,
  customTargets,
  onToggleCustomTarget,
  t,
}: SkillCardProps) => {
  const [showRemoteMenu, setShowRemoteMenu] = useState(false)
  const typeKey = skill.source_type.toLowerCase()
  const iconNode = typeKey.includes('git') ? (
    <Github size={20} />
  ) : typeKey.includes('local') ? (
    <Folder size={20} />
  ) : (
    <Box size={20} />
  )
  const github = getGithubInfo(skill.source_ref)
  const copyValue = (github?.href ?? skill.source_ref ?? '').trim()

  // Which remote hosts have this skill?
  const syncedHosts = remoteHosts.filter((host) => {
    const status = remoteSkillStatuses[host.id]
    return status?.skills?.includes(skill.name)
  })

  // Unsync'd remote hosts (for sync menu)
  const unsyncedHosts = remoteHosts.filter((host) => {
    const status = remoteSkillStatuses[host.id]
    return !status?.skills?.includes(skill.name)
  })

  const handleCopy = async () => {
    if (!copyValue) return
    try {
      await navigator.clipboard.writeText(copyValue)
      toast.success(t('copied'))
    } catch {
      toast.error(t('copyFailed'))
    }
  }

  return (
    <div className="skill-card" onClick={() => onViewDetail(skill)}>
      <div className="skill-icon">{iconNode}</div>
      <div className="skill-main">
        <div className="skill-header-row">
          <div className="skill-name">
            {skill.name}
            {hasUpdate ? (
              <span className="update-dot" title={t('updateAvailable')} />
            ) : null}
          </div>
        </div>

        <div className="skill-meta-row">
          {github ? (
            <div className="skill-source">
              <button
                className="repo-pill copyable"
                type="button"
                title={t('copy')}
                aria-label={t('copy')}
                onClick={(e) => { e.stopPropagation(); void handleCopy() }}
                disabled={!copyValue}
              >
                {github.label}
                <span className="copy-icon" aria-hidden="true">
                  <Copy size={12} />
                </span>
              </button>
            </div>
          ) : (
            <div className="skill-source">
              <button
                className="repo-pill copyable"
                type="button"
                title={t('copy')}
                aria-label={t('copy')}
                onClick={(e) => { e.stopPropagation(); void handleCopy() }}
                disabled={!copyValue}
              >
                <span className="mono">{getSkillSourceLabel(skill)}</span>
                <span className="copy-icon" aria-hidden="true">
                  <Copy size={12} />
                </span>
              </button>
            </div>
          )}
          <div className="skill-source time">
            <span className="dot">•</span>
            {formatRelative(skill.updated_at)}
          </div>
        </div>

        {/* ── Local tool matrix ──────────────────────────────── */}
        <div className="tool-env-section">
          <div className="tool-env-label local">{t('remote.localBadge')}</div>
          <div className="tool-matrix">
            {installedTools.map((tool) => {
              const target = skill.targets.find((t) => t.tool === tool.id)
              const synced = Boolean(target)
              const state = synced ? 'active' : 'inactive'
              return (
                <button
                  key={`${skill.id}-${tool.id}`}
                  type="button"
                  className={`tool-pill ${state}`}
                  title={
                    synced
                      ? `${tool.label} (${target?.mode ?? t('unknown')})`
                      : tool.label
                  }
                  onClick={(e) => { e.stopPropagation(); void onToggleTool(skill, tool.id) }}
                >
                  {synced ? <span className="status-badge" /> : null}
                  {tool.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── VM sections (IDE tools + custom targets merged per host) ── */}
        {syncedHosts.map((host) => {
          const hostTools = remoteToolStatuses[host.id] ?? []
          const installedRemoteTools = hostTools.filter((t) => t.installed)
          const hostCTs = customTargets.filter((ct) => ct.remote_host_id === host.id)
          if (installedRemoteTools.length === 0 && hostCTs.length === 0) return null
          return (
            <div key={host.id} className="tool-env-section">
              <div className="tool-env-label remote" title={`${host.username}@${host.host}`}>
                {host.label}
              </div>
              <div className="tool-matrix">
                {installedRemoteTools.map((tool) => (
                  <span
                    key={`${skill.id}-remote-${host.id}-${tool.key}`}
                    className="tool-pill active remote-tool"
                  >
                    <span className="status-badge remote" />
                    {tool.label}
                  </span>
                ))}
                {hostCTs.map((ct) => {
                  const synced = skill.targets.some((tgt) => tgt.tool === `custom:${ct.id}`)
                  return (
                    <button
                      key={ct.id}
                      type="button"
                      className={`tool-pill ${synced ? 'active remote-tool' : 'inactive'}`}
                      title={ct.path}
                      onClick={(e) => { e.stopPropagation(); onToggleCustomTarget(skill, ct.id) }}
                    >
                      {synced ? <span className="status-badge remote" /> : null}
                      <Folder size={11} />
                      {ct.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* ── Hosts with ONLY custom targets (not in syncedHosts) ─── */}
        {(() => {
          const syncedHostIds = new Set(syncedHosts.map((h) => h.id))
          const remoteCTsByHost = new Map<string, { host: RemoteHost; targets: CustomTarget[] }>()
          for (const ct of customTargets) {
            if (!ct.remote_host_id || syncedHostIds.has(ct.remote_host_id)) continue
            const existing = remoteCTsByHost.get(ct.remote_host_id)
            const host = remoteHosts.find((h) => h.id === ct.remote_host_id)
            if (existing) {
              existing.targets.push(ct)
            } else if (host) {
              remoteCTsByHost.set(ct.remote_host_id, { host, targets: [ct] })
            }
          }
          return [...remoteCTsByHost.values()].map(({ host, targets: cts }) => (
            <div key={host.id} className="tool-env-section">
              <div className="tool-env-label remote" title={`${host.username}@${host.host}`}>
                {host.label}
              </div>
              <div className="tool-matrix">
                {cts.map((ct) => {
                  const synced = skill.targets.some((tgt) => tgt.tool === `custom:${ct.id}`)
                  return (
                    <button
                      key={ct.id}
                      type="button"
                      className={`tool-pill ${synced ? 'active remote-tool' : 'inactive'}`}
                      title={ct.path}
                      onClick={(e) => { e.stopPropagation(); onToggleCustomTarget(skill, ct.id) }}
                    >
                      {synced ? <span className="status-badge remote" /> : null}
                      <Folder size={11} />
                      {ct.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        })()}

        {/* ── Local custom targets ─────────────────────────────── */}
        {(() => {
          const localCTs = customTargets.filter((ct) => !ct.remote_host_id)
          if (localCTs.length === 0) return null
          return (
            <div className="tool-env-section">
              <div className="tool-env-label local">
                <Folder size={11} />
                {t('customTarget.titleShort')}
              </div>
              <div className="tool-matrix">
                {localCTs.map((ct) => {
                  const synced = skill.targets.some((tgt) => tgt.tool === `custom:${ct.id}`)
                  return (
                    <button
                      key={ct.id}
                      type="button"
                      className={`tool-pill ${synced ? 'active' : 'inactive'}`}
                      title={ct.path}
                      onClick={(e) => { e.stopPropagation(); onToggleCustomTarget(skill, ct.id) }}
                    >
                      {synced ? <span className="status-badge" /> : null}
                      {ct.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })()}
      </div>
      <div className="skill-actions-col" onClick={(e) => e.stopPropagation()}>
        {/* Sync to Remote button — show only if there are unsync'd hosts */}
        {unsyncedHosts.length > 0 ? (
          <div className="sync-remote-wrap">
            <button
              className="card-btn remote-action"
              type="button"
              onClick={() => setShowRemoteMenu((prev) => !prev)}
              disabled={loading || remoteSyncing === skill.id}
              aria-label={t('remote.syncToRemote')}
              title={t('remote.syncToRemote')}
            >
              <Cloud size={16} />
            </button>
            {showRemoteMenu ? (
              <div className="sync-remote-dropdown">
                {unsyncedHosts.map((host) => (
                  <button
                    key={host.id}
                    className="sync-remote-item"
                    type="button"
                    onClick={() => {
                      setShowRemoteMenu(false)
                      onSyncToRemote(skill, host.id)
                    }}
                    disabled={remoteSyncing === skill.id}
                  >
                    <span className="sync-remote-label">{host.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <button
          className={`card-btn primary-action${hasUpdate ? ' has-update' : ''}`}
          type="button"
          onClick={() => onUpdate(skill)}
          disabled={loading}
          aria-label={t('update')}
          title={hasUpdate ? t('updateAvailable') : t('update')}
        >
          {hasUpdate ? <ArrowUpCircle size={16} /> : <RefreshCw size={16} />}
        </button>
        <button
          className="card-btn danger-action"
          type="button"
          onClick={() => onDelete(skill.id)}
          disabled={loading}
          aria-label={t('remove')}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  )
}

export default memo(SkillCard)
