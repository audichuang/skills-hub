import { memo } from 'react'
import { ChevronRight } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { ClawHubSkill, ToolOption, ToolStatusDto } from '../types'

type AddSkillModalProps = {
  open: boolean
  loading: boolean
  canClose: boolean
  addModalTab: 'local' | 'git' | 'search'
  localPath: string
  localName: string
  gitUrl: string
  gitName: string
  syncTargets: Record<string, boolean>
  installedTools: ToolOption[]
  toolStatus: ToolStatusDto | null
  // ClawHub search
  searchQuery: string
  searchResults: ClawHubSkill[]
  searchLoading: boolean
  installingSlug: string | null
  onRequestClose: () => void
  onTabChange: (tab: 'local' | 'git' | 'search') => void
  onLocalPathChange: (value: string) => void
  onPickLocalPath: () => void
  onLocalNameChange: (value: string) => void
  onGitUrlChange: (value: string) => void
  onGitNameChange: (value: string) => void
  onSyncTargetChange: (toolId: string, checked: boolean) => void
  onSubmit: () => void
  // ClawHub search
  onSearchQueryChange: (value: string) => void
  onSearchClawHub: () => void
  onInstallClawHub: (slug: string, version?: string | null) => void
  onViewClawHubDetail: (slug: string) => void
  t: TFunction
}

const AddSkillModal = ({
  open,
  loading,
  canClose,
  addModalTab,
  localPath,
  localName,
  gitUrl,
  gitName,
  syncTargets,
  installedTools,
  toolStatus,
  searchQuery,
  searchResults,
  searchLoading,
  installingSlug,
  onRequestClose,
  onTabChange,
  onLocalPathChange,
  onPickLocalPath,
  onLocalNameChange,
  onGitUrlChange,
  onGitNameChange,
  onSyncTargetChange,
  onSubmit,
  onSearchQueryChange,
  onSearchClawHub,
  onInstallClawHub,
  onViewClawHubDetail,
  t,
}: AddSkillModalProps) => {
  if (!open) return null

  return (
    <div
      className="modal-backdrop"
    >
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{t('addSkillTitle')}</div>
          <button
            className="modal-close"
            type="button"
            onClick={onRequestClose}
            aria-label={t('close')}
            disabled={!canClose}
          >
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="tabs">
            <button
              className={`tab-item${addModalTab === 'local' ? ' active' : ''}`}
              type="button"
              onClick={() => onTabChange('local')}
            >
              {t('localTab')}
            </button>
            <button
              className={`tab-item${addModalTab === 'git' ? ' active' : ''}`}
              type="button"
              onClick={() => onTabChange('git')}
            >
              {t('gitTab')}
            </button>
            <button
              className={`tab-item${addModalTab === 'search' ? ' active' : ''}`}
              type="button"
              onClick={() => onTabChange('search')}
            >
              {t('searchTab')}
            </button>
          </div>

          {addModalTab === 'local' ? (
            <>
              <div className="form-group">
                <label className="label">{t('localFolder')}</label>
                <div className="input-row">
                  <input
                    className="input"
                    placeholder={t('localPathPlaceholder')}
                    value={localPath}
                    onChange={(event) => onLocalPathChange(event.target.value)}
                  />
                  <button
                    className="btn btn-secondary input-action"
                    type="button"
                    onClick={onPickLocalPath}
                    disabled={!canClose}
                  >
                    {t('browse')}
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="label">{t('optionalNamePlaceholder')}</label>
                <input
                  className="input"
                  placeholder={t('optionalNamePlaceholder')}
                  value={localName}
                  onChange={(event) => onLocalNameChange(event.target.value)}
                />
              </div>
            </>
          ) : addModalTab === 'git' ? (
            <>
              <div className="form-group">
                <label className="label">{t('repositoryUrl')}</label>
                <input
                  className="input"
                  placeholder={t('gitUrlPlaceholder')}
                  value={gitUrl}
                  onChange={(event) => onGitUrlChange(event.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="label">{t('optionalNamePlaceholder')}</label>
                <input
                  className="input"
                  placeholder={t('optionalNamePlaceholder')}
                  value={gitName}
                  onChange={(event) => onGitNameChange(event.target.value)}
                />
              </div>
            </>
          ) : (
            /* search tab */
            <>
              <div className="form-group">
                <div className="input-row">
                  <input
                    className="input"
                    placeholder={t('searchClawHubPlaceholder')}
                    value={searchQuery}
                    onChange={(event) => onSearchQueryChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !searchLoading) onSearchClawHub()
                    }}
                  />
                  <button
                    className="btn btn-primary input-action"
                    type="button"
                    onClick={onSearchClawHub}
                    disabled={searchLoading || !searchQuery.trim()}
                  >
                    {searchLoading ? t('searching') : t('searchButton')}
                  </button>
                </div>
              </div>
              <div className="clawhub-results">
                {searchResults.length === 0 && !searchLoading && searchQuery.trim() && (
                  <div className="helper-text">{t('noSearchResults')}</div>
                )}
                {searchResults.map((skill) => (
                  <div
                    key={skill.slug}
                    className="clawhub-result-item"
                    onClick={() => onViewClawHubDetail(skill.slug)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="clawhub-result-main">
                      <div className="clawhub-result-info">
                        <div className="clawhub-result-name">
                          {skill.displayName || skill.slug}
                          {skill.version && (
                            <span className="clawhub-result-version">v{skill.version}</span>
                          )}
                          <ChevronRight size={14} className="clawhub-chevron" />
                        </div>
                        {skill.summary && (
                          <div className="clawhub-result-summary">{skill.summary}</div>
                        )}
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onInstallClawHub(skill.slug, skill.version) }}
                        disabled={installingSlug === skill.slug}
                      >
                        {installingSlug === skill.slug
                          ? t('installingFromClawHub')
                          : t('installFromClawHub')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Tool selection — hidden for search tab since install is per-item */}
          {addModalTab !== 'search' && (
            <div className="form-group">
              <label className="label">{t('installToTools')}</label>
              {toolStatus ? (
                <div className="tool-matrix">
                  {installedTools.map((tool) => (
                    <label
                      key={tool.id}
                      className={`tool-pill-toggle${syncTargets[tool.id] ? ' active' : ''
                        }`}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(syncTargets[tool.id])}
                        onChange={(event) =>
                          onSyncTargetChange(tool.id, event.target.checked)
                        }
                      />
                      {syncTargets[tool.id] ? <span className="status-badge" /> : null}
                      {tool.label}
                    </label>
                  ))}
                </div>
              ) : (
                <div className="helper-text">{t('detectingTools')}</div>
              )}
              <div className="helper-text">{t('syncAfterCreate')}</div>
            </div>
          )}

          {/* Tool selection for search tab — shown when there are results */}
          {addModalTab === 'search' && searchResults.length > 0 && (
            <div className="form-group">
              <label className="label">{t('installToTools')}</label>
              {toolStatus ? (
                <div className="tool-matrix">
                  {installedTools.map((tool) => (
                    <label
                      key={tool.id}
                      className={`tool-pill-toggle${syncTargets[tool.id] ? ' active' : ''
                        }`}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(syncTargets[tool.id])}
                        onChange={(event) =>
                          onSyncTargetChange(tool.id, event.target.checked)
                        }
                      />
                      {syncTargets[tool.id] ? <span className="status-badge" /> : null}
                      {tool.label}
                    </label>
                  ))}
                </div>
              ) : (
                <div className="helper-text">{t('detectingTools')}</div>
              )}
              <div className="helper-text">{t('syncAfterCreate')}</div>
            </div>
          )}
        </div>
        {addModalTab !== 'search' && (
          <div className="modal-footer">
            <button
              className="btn btn-secondary"
              onClick={onRequestClose}
              disabled={!canClose}
            >
              {t('cancel')}
            </button>
            <button
              className="btn btn-primary"
              onClick={onSubmit}
              disabled={loading}
            >
              {addModalTab === 'local' ? t('create') : t('install')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(AddSkillModal)
