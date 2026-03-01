import { memo, useState, useMemo, useCallback } from 'react'
import { ChevronDown, ChevronRight, FolderOpen, MessageCircle, Trash2, RefreshCw } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { CustomTarget, ManagedSkill, OnboardingPlan, RemoteHost, RemoteSkillsDto, RemoteToolInfoDto, SkillUpdateStatus, ToolOption } from './types'
import SkillCard from './SkillCard'

type GithubInfo = {
  label: string
  href: string
}

type SkillsListProps = {
  plan: OnboardingPlan | null
  visibleSkills: ManagedSkill[]
  installedTools: ToolOption[]
  loading: boolean
  isEditMode: boolean
  selectedIds: Set<string>
  onToggleSelect: (skillId: string) => void
  onToggleSelectAll: () => void
  updateStatuses: Record<string, SkillUpdateStatus>
  getGithubInfo: (url: string | null | undefined) => GithubInfo | null
  getSkillSourceLabel: (skill: ManagedSkill) => string
  formatRelative: (ms: number | null | undefined) => string
  onReviewImport: () => void
  onUpdateSkill: (skill: ManagedSkill) => void
  onDeleteSkill: (skillId: string) => void
  onBatchDeleteSkills: (skillIds: string[]) => void
  onBatchUpdateSkills: (skillIds: string[]) => void
  onToggleTool: (skill: ManagedSkill, toolId: string) => void
  onViewDetail: (skill: ManagedSkill) => void
  remoteHosts: RemoteHost[]
  remoteSkillStatuses: Record<string, RemoteSkillsDto>
  remoteToolStatuses: Record<string, RemoteToolInfoDto[]>
  onSyncToRemote: (skill: ManagedSkill, hostId: string) => void
  onToggleRemoteTool: (skill: ManagedSkill, hostId: string, toolKey: string) => void
  remoteSyncing: string | null
  customTargets: CustomTarget[]
  onToggleCustomTarget: (skill: ManagedSkill, customTargetId: string) => void
  hiddenTools: string[]
  t: TFunction
}

type SkillGroup = {
  type: 'group'
  groupName: string
  skills: ManagedSkill[]
}

type ListItem = { type: 'skill'; skill: ManagedSkill } | SkillGroup

function buildGroupedItems(skills: ManagedSkill[]): ListItem[] {
  const grouped = new Map<string, ManagedSkill[]>()
  const ungrouped: ManagedSkill[] = []

  for (const skill of skills) {
    const g = skill.group_name
    if (g) {
      const list = grouped.get(g)
      if (list) {
        list.push(skill)
      } else {
        grouped.set(g, [skill])
      }
    } else {
      ungrouped.push(skill)
    }
  }

  // Groups first, then ungrouped skills
  const items: ListItem[] = []

  for (const [groupName, groupSkills] of grouped) {
    if (groupSkills.length >= 2) {
      items.push({ type: 'group', groupName, skills: groupSkills })
    } else {
      ungrouped.unshift(groupSkills[0])
    }
  }

  for (const skill of ungrouped) {
    items.push({ type: 'skill', skill })
  }

  return items
}

const SkillsList = ({
  plan,
  visibleSkills,
  installedTools,
  loading,
  isEditMode,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  updateStatuses,
  getGithubInfo,
  getSkillSourceLabel,
  formatRelative,
  onReviewImport,
  onUpdateSkill,
  onDeleteSkill,
  onBatchDeleteSkills,
  onBatchUpdateSkills,
  onToggleTool,
  onViewDetail,
  remoteHosts,
  remoteSkillStatuses,
  remoteToolStatuses,
  onSyncToRemote,
  onToggleRemoteTool,
  remoteSyncing,
  customTargets,
  onToggleCustomTarget,
  hiddenTools,
  t,
}: SkillsListProps) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const toggleGroup = useCallback((groupName: string) => {
    setExpanded((prev) => ({ ...prev, [groupName]: !prev[groupName] }))
  }, [])

  const items = useMemo(() => buildGroupedItems(visibleSkills), [visibleSkills])

  const allSelected = visibleSkills.length > 0 && visibleSkills.every((s) => selectedIds.has(s.id))

  const renderSkillCardBare = (skill: ManagedSkill) => (
    <SkillCard
      key={skill.id}
      skill={skill}
      installedTools={installedTools}
      loading={loading}
      hasUpdate={updateStatuses[skill.id]?.has_update === true}
      getGithubInfo={getGithubInfo}
      getSkillSourceLabel={getSkillSourceLabel}
      formatRelative={formatRelative}
      onUpdate={onUpdateSkill}
      onDelete={onDeleteSkill}
      onToggleTool={onToggleTool}
      onViewDetail={onViewDetail}
      remoteHosts={remoteHosts}
      remoteSkillStatuses={remoteSkillStatuses}
      remoteToolStatuses={remoteToolStatuses}
      onSyncToRemote={onSyncToRemote}
      onToggleRemoteTool={onToggleRemoteTool}
      remoteSyncing={remoteSyncing}
      customTargets={customTargets}
      onToggleCustomTarget={onToggleCustomTarget}
      hiddenTools={hiddenTools}
      t={t}
    />
  )

  const renderSkillCardWrapped = (skill: ManagedSkill) => (
    <div key={skill.id} className={`skill-group-item ${isEditMode ? 'edit-mode' : ''}`}>
      {isEditMode && (
        <label className="skill-select-checkbox" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selectedIds.has(skill.id)}
            onChange={() => onToggleSelect(skill.id)}
          />
        </label>
      )}
      <div className="skill-group-item-content">
        {renderSkillCardBare(skill)}
      </div>
    </div>
  )

  const renderTopLevelSkill = (skill: ManagedSkill) => {
    if (isEditMode) return renderSkillCardWrapped(skill)
    return renderSkillCardBare(skill)
  }

  return (
    <div className="skills-list">
      {plan && plan.total_skills_found > 0 ? (
        <div className="discovered-banner">
          <div className="banner-left">
            <div className="banner-icon">
              <MessageCircle size={18} />
            </div>
            <div className="banner-content">
              <div className="banner-title">{t('discoveredTitle')}</div>
              <div className="banner-subtitle">
                {t('discoveredCount', { count: plan.total_skills_found })}
              </div>
            </div>
          </div>
          <button
            className="btn btn-warning"
            type="button"
            onClick={onReviewImport}
            disabled={loading}
          >
            {t('reviewImport')}
          </button>
        </div>
      ) : null}

      {visibleSkills.length === 0 ? (
        <div className="empty">{t('skillsEmpty')}</div>
      ) : (
        <>
          {items.map((item) => {
            if (item.type === 'skill') {
              return renderTopLevelSkill(item.skill)
            }
            const isExpanded = expanded[item.groupName] ?? false
            return (
              <div key={`group-${item.groupName}`} className="skill-group">
                <div className="skill-group-header">
                  <button
                    type="button"
                    className="skill-group-toggle"
                    onClick={() => toggleGroup(item.groupName)}
                  >
                    <span className="skill-group-chevron">
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                    <FolderOpen size={16} className="skill-group-icon" />
                    <span className="skill-group-name">{item.groupName}</span>
                    <span className="skill-group-count">
                      {t('skillGroupCount', { count: item.skills.length })}
                    </span>
                  </button>
                </div>

                {isExpanded && (
                  <div className="skill-group-body">
                    {item.skills.map((s) => renderSkillCardWrapped(s))}
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}

      {/* Batch action toolbar at bottom */}
      {isEditMode && (
        <div className="batch-toolbar">
          <label className="skill-select-all" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleSelectAll}
            />
            <span>{t('batchSelectAll')}</span>
          </label>
          <span className="batch-toolbar-count">
            {t('batchSelectedCount', { count: selectedIds.size })}
          </span>
          <div className="batch-toolbar-actions">
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={selectedIds.size === 0 || loading}
              onClick={() => onBatchUpdateSkills(Array.from(selectedIds))}
            >
              <RefreshCw size={13} />
              {t('batchUpdate')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger-solid"
              disabled={selectedIds.size === 0 || loading}
              onClick={() => onBatchDeleteSkills(Array.from(selectedIds))}
            >
              <Trash2 size={13} />
              {t('batchDelete')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(SkillsList)
