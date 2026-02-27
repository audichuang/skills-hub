import { memo } from 'react'
import { MessageCircle } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { ManagedSkill, OnboardingPlan, RemoteHost, RemoteSkillsDto, RemoteToolInfoDto, SkillUpdateStatus, ToolOption } from './types'
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
  updateStatuses: Record<string, SkillUpdateStatus>
  getGithubInfo: (url: string | null | undefined) => GithubInfo | null
  getSkillSourceLabel: (skill: ManagedSkill) => string
  formatRelative: (ms: number | null | undefined) => string
  onReviewImport: () => void
  onUpdateSkill: (skill: ManagedSkill) => void
  onDeleteSkill: (skillId: string) => void
  onToggleTool: (skill: ManagedSkill, toolId: string) => void
  onViewDetail: (skill: ManagedSkill) => void
  remoteHosts: RemoteHost[]
  remoteSkillStatuses: Record<string, RemoteSkillsDto>
  remoteToolStatuses: Record<string, RemoteToolInfoDto[]>
  onSyncToRemote: (skill: ManagedSkill, hostId: string) => void
  remoteSyncing: string | null
  t: TFunction
}

const SkillsList = ({
  plan,
  visibleSkills,
  installedTools,
  loading,
  updateStatuses,
  getGithubInfo,
  getSkillSourceLabel,
  formatRelative,
  onReviewImport,
  onUpdateSkill,
  onDeleteSkill,
  onToggleTool,
  onViewDetail,
  remoteHosts,
  remoteSkillStatuses,
  remoteToolStatuses,
  onSyncToRemote,
  remoteSyncing,
  t,
}: SkillsListProps) => {
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
          {visibleSkills.map((skill) => (
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
              remoteSyncing={remoteSyncing}
              t={t}
            />
          ))}
        </>
      )}
    </div>
  )
}

export default memo(SkillsList)
