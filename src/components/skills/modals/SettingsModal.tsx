import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, FolderOpen, FolderPlus, Globe, Monitor, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import type { CustomTarget, RemoteHost } from '../types'

type SettingsModalProps = {
  open: boolean
  isTauri: boolean
  language: string
  storagePath: string
  gitCacheCleanupDays: number
  gitCacheTtlSecs: number
  themePreference: 'system' | 'light' | 'dark'
  onPickStoragePath: () => void
  onChangeLanguage: (lang: string) => void
  onThemeChange: (nextTheme: 'system' | 'light' | 'dark') => void
  onGitCacheCleanupDaysChange: (nextDays: number) => void
  onGitCacheTtlSecsChange: (nextSecs: number) => void
  onClearGitCacheNow: () => void
  onOpenRemoteHosts: () => void
  onRequestClose: () => void
  customTargets: CustomTarget[]
  remoteHosts: RemoteHost[]
  invokeTauri: <T, >(command: string, args?: Record<string, unknown>) => Promise<T>
  onCustomTargetsChanged: () => Promise<void>
  t: TFunction
}

const SettingsModal = ({
  open,
  isTauri,
  language,
  storagePath,
  gitCacheCleanupDays,
  gitCacheTtlSecs,
  themePreference,
  onPickStoragePath,
  onThemeChange,
  onGitCacheCleanupDaysChange,
  onGitCacheTtlSecsChange,
  onClearGitCacheNow,
  onChangeLanguage,
  onOpenRemoteHosts,
  onRequestClose,
  customTargets,
  remoteHosts,
  invokeTauri,
  onCustomTargetsChanged,
  t,
}: SettingsModalProps) => {
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [showAddCustom, setShowAddCustom] = useState(false)
  const [newCustomLabel, setNewCustomLabel] = useState('')
  const [newCustomPath, setNewCustomPath] = useState('')
  const [newCustomRemoteHostId, setNewCustomRemoteHostId] = useState<string>('')
  const [addingCustom, setAddingCustom] = useState(false)
  // Remote directory browser state
  const [showRemoteBrowser, setShowRemoteBrowser] = useState(false)
  const [remoteBrowsePath, setRemoteBrowsePath] = useState<string>('')
  const [remoteBrowseEntries, setRemoteBrowseEntries] = useState<{ name: string; isDir: boolean }[]>([])
  const [remoteBrowseLoading, setRemoteBrowseLoading] = useState(false)
  const versionText = useMemo(() => {
    if (!isTauri) return t('notAvailable')
    if (!appVersion) return t('unknown')
    return `v${appVersion}`
  }, [appVersion, isTauri, t])

  const loadAppVersion = useCallback(async () => {
    if (!isTauri) {
      setAppVersion(null)
      return
    }
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      const v = await getVersion()
      setAppVersion(v)
    } catch {
      setAppVersion(null)
    }
  }, [isTauri])

  useEffect(() => {
    if (!open) {
      setAppVersion(null)
      return
    }
    void loadAppVersion()
  }, [loadAppVersion, open])

  const isRemoteMode = newCustomRemoteHostId !== ''

  const handleAddCustomTarget = useCallback(async () => {
    if (!newCustomLabel.trim() || !newCustomPath.trim()) return
    setAddingCustom(true)
    try {
      await invokeTauri('add_custom_target', {
        label: newCustomLabel.trim(),
        path: newCustomPath.trim(),
        remoteHostId: newCustomRemoteHostId || null,
      })
      setNewCustomLabel('')
      setNewCustomPath('')
      setNewCustomRemoteHostId('')
      setShowAddCustom(false)
      await onCustomTargetsChanged()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    } finally {
      setAddingCustom(false)
    }
  }, [invokeTauri, newCustomLabel, newCustomPath, newCustomRemoteHostId, onCustomTargetsChanged])

  const handleDeleteCustomTarget = useCallback(async (targetId: string) => {
    try {
      await invokeTauri('delete_custom_target', { targetId })
      await onCustomTargetsChanged()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    }
  }, [invokeTauri, onCustomTargetsChanged])

  const handlePickCustomPath = useCallback(async () => {
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog')
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t('customTarget.selectPath'),
      })
      if (!selected || Array.isArray(selected)) return
      setNewCustomPath(selected)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    }
  }, [t])

  const getRemoteHostLabel = useCallback((remoteHostId: string | null | undefined) => {
    if (!remoteHostId) return null
    return remoteHosts.find((h) => h.id === remoteHostId)?.label ?? remoteHostId
  }, [remoteHosts])

  const browseRemote = useCallback(async (targetPath?: string) => {
    if (!newCustomRemoteHostId) return
    setRemoteBrowseLoading(true)
    try {
      const result = await invokeTauri<{ currentPath: string; entries: { name: string; isDir: boolean }[] }>(
        'browse_remote_directory',
        { hostId: newCustomRemoteHostId, path: targetPath ?? null },
      )
      setRemoteBrowsePath(result.currentPath)
      setRemoteBrowseEntries(result.entries)
      setShowRemoteBrowser(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    } finally {
      setRemoteBrowseLoading(false)
    }
  }, [invokeTauri, newCustomRemoteHostId])

  const handleSelectRemotePath = useCallback((selectedPath: string) => {
    setNewCustomPath(selectedPath)
    setShowRemoteBrowser(false)
  }, [])

  if (!open) return null

  return (
    <div className="modal-backdrop">
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title" id="settings-title">
            {t('settings')}
          </div>
          <button
            className="modal-close"
            type="button"
            onClick={onRequestClose}
            aria-label={t('close')}
          >
            ✕
          </button>
        </div>
        <div className="modal-body settings-body">
          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-language">
              {t('interfaceLanguage')}
            </label>
            <div className="settings-select-wrap">
              <select
                id="settings-language"
                className="settings-select"
                value={language}
                onChange={(event) => onChangeLanguage(event.target.value)}
              >
                <option value="en">{t('languageOptions.en')}</option>
                <option value="zh-CN">{t('languageOptions.zh-CN')}</option>
                <option value="zh-TW">{t('languageOptions.zh-TW')}</option>
              </select>
              <svg
                className="settings-select-caret"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-label" id="settings-theme-label">
              {t('themeMode')}
            </label>
            <div className="settings-theme-options" role="group" aria-labelledby="settings-theme-label">
              <button
                type="button"
                className={`settings-theme-btn ${themePreference === 'system' ? 'active' : ''
                  }`}
                aria-pressed={themePreference === 'system'}
                onClick={() => onThemeChange('system')}
              >
                {t('themeOptions.system')}
              </button>
              <button
                type="button"
                className={`settings-theme-btn ${themePreference === 'light' ? 'active' : ''
                  }`}
                aria-pressed={themePreference === 'light'}
                onClick={() => onThemeChange('light')}
              >
                {t('themeOptions.light')}
              </button>
              <button
                type="button"
                className={`settings-theme-btn ${themePreference === 'dark' ? 'active' : ''
                  }`}
                aria-pressed={themePreference === 'dark'}
                onClick={() => onThemeChange('dark')}
              >
                {t('themeOptions.dark')}
              </button>
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-storage">
              {t('skillsStoragePath')}
            </label>
            <div className="settings-input-row">
              <input
                id="settings-storage"
                className="settings-input mono"
                value={storagePath}
                readOnly
              />
              <button
                className="btn btn-secondary settings-browse"
                type="button"
                onClick={onPickStoragePath}
              >
                {t('browse')}
              </button>
            </div>
            <div className="settings-helper">{t('skillsStorageHint')}</div>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-git-cache-days">
              {t('gitCacheCleanupDays')}
            </label>
            <div className="settings-input-row">
              <input
                id="settings-git-cache-days"
                className="settings-input"
                type="number"
                min={0}
                max={3650}
                step={1}
                value={gitCacheCleanupDays}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  if (!Number.isNaN(next)) {
                    onGitCacheCleanupDaysChange(next)
                  }
                }}
              />
              <button
                className="btn btn-secondary settings-browse"
                type="button"
                onClick={onClearGitCacheNow}
              >
                {t('cleanNow')}
              </button>
            </div>
            <div className="settings-helper">{t('gitCacheCleanupHint')}</div>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-git-cache-ttl">
              {t('gitCacheTtlSecs')}
            </label>
            <div className="settings-input-row">
              <input
                id="settings-git-cache-ttl"
                className="settings-input"
                type="number"
                min={0}
                max={3600}
                step={1}
                value={gitCacheTtlSecs}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  if (!Number.isNaN(next)) {
                    onGitCacheTtlSecsChange(next)
                  }
                }}
              />
            </div>
            <div className="settings-helper">{t('gitCacheTtlHint')}</div>
          </div>

          <div className="settings-field">
            <label className="settings-label">
              {t('remote.remoteHosts')}
            </label>
            <div className="settings-input-row">
              <span className="settings-hint" style={{ flex: 1 }}>
                {t('remote.remoteHostsHint')}
              </span>
              <button
                className="btn btn-secondary settings-browse"
                type="button"
                onClick={onOpenRemoteHosts}
              >
                {t('remote.remoteHostsManage')}
              </button>
            </div>
          </div>

          {/* ── Custom Targets ─────────────────────────────── */}
          <div className="settings-field">
            <label className="settings-label">
              {t('customTarget.title')}
            </label>
            <div className="settings-helper" style={{ marginBottom: 8 }}>
              {t('customTarget.hint')}
            </div>

            {customTargets.length > 0 && (
              <div className="custom-target-list">
                {customTargets.map((ct) => {
                  const hostLabel = getRemoteHostLabel(ct.remote_host_id)
                  return (
                    <div key={ct.id} className="custom-target-list-item">
                      {hostLabel ? (
                        <Globe size={14} className="custom-target-icon remote" />
                      ) : (
                        <Monitor size={14} className="custom-target-icon" />
                      )}
                      <div className="custom-target-info">
                        <span className="custom-target-label-text">
                          {ct.label}
                          {hostLabel && (
                            <span className="custom-target-host-badge">{hostLabel}</span>
                          )}
                        </span>
                        <span className="custom-target-path mono">{ct.path}</span>
                      </div>
                      <button
                        type="button"
                        className="custom-target-delete-btn"
                        title={t('customTarget.delete')}
                        onClick={() => void handleDeleteCustomTarget(ct.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {showAddCustom ? (
              <div className="custom-target-add-form">
                <div className="custom-target-form-fields">
                  <input
                    type="text"
                    className="settings-input"
                    placeholder={t('customTarget.labelPlaceholder')}
                    value={newCustomLabel}
                    onChange={(e) => setNewCustomLabel(e.target.value)}
                  />

                  {/* Location selector */}
                  <div className="settings-select-wrap">
                    <select
                      className="settings-select"
                      value={newCustomRemoteHostId}
                      onChange={(e) => {
                        setNewCustomRemoteHostId(e.target.value)
                        setNewCustomPath('')
                      }}
                    >
                      <option value="">{t('customTarget.local')}</option>
                      {remoteHosts.map((rh) => (
                        <option key={rh.id} value={rh.id}>
                          {rh.label} ({rh.host})
                        </option>
                      ))}
                    </select>
                    <svg
                      className="settings-select-caret"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </div>

                  <div className="custom-target-path-row">
                    <input
                      type="text"
                      className="settings-input"
                      placeholder={isRemoteMode
                        ? t('customTarget.remotePathPlaceholder')
                        : t('customTarget.pathPlaceholder')
                      }
                      value={newCustomPath}
                      onChange={(e) => setNewCustomPath(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary settings-browse"
                      disabled={isRemoteMode && remoteBrowseLoading}
                      onClick={() => {
                        if (isRemoteMode) {
                          void browseRemote(newCustomPath || undefined)
                        } else {
                          void handlePickCustomPath()
                        }
                      }}
                    >
                      {remoteBrowseLoading ? '...' : t('customTarget.browse')}
                    </button>
                  </div>
                  {/* Remote directory browser */}
                  {showRemoteBrowser && (
                    <div className="remote-browser">
                      <div className="remote-browser-header">
                        <span className="remote-browser-path mono">{remoteBrowsePath}</span>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleSelectRemotePath(remoteBrowsePath)}
                        >
                          {t('customTarget.selectHere')}
                        </button>
                      </div>
                      {remoteBrowsePath !== '/' && (
                        <button
                          type="button"
                          className="remote-browser-item"
                          onClick={() => {
                            const parent = remoteBrowsePath.replace(/\/[^/]+$/, '') || '/'
                            void browseRemote(parent)
                          }}
                        >
                          <FolderOpen size={14} />
                          <span>..</span>
                        </button>
                      )}
                      <div className="remote-browser-list">
                        {remoteBrowseEntries.map((entry) => (
                          <button
                            key={entry.name}
                            type="button"
                            className="remote-browser-item"
                            onClick={() => void browseRemote(`${remoteBrowsePath}/${entry.name}`)}
                          >
                            <FolderOpen size={14} />
                            <span>{entry.name}</span>
                            <ChevronRight size={14} className="remote-browser-chevron" />
                          </button>
                        ))}
                        {remoteBrowseEntries.length === 0 && (
                          <div className="remote-browser-empty">{t('customTarget.emptyDir')}</div>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="custom-target-form-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setShowAddCustom(false)
                        setNewCustomLabel('')
                        setNewCustomPath('')
                        setNewCustomRemoteHostId('')
                      }}
                    >
                      {t('cancel')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void handleAddCustomTarget()}
                      disabled={addingCustom || !newCustomLabel.trim() || !newCustomPath.trim()}
                    >
                      {t('customTarget.add')}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAddCustom(true)}
              >
                <FolderPlus size={14} />
                {t('customTarget.addButton')}
              </button>
            )}
          </div>

          <div className="settings-version">
            {t('appName')} {versionText}
          </div>

        </div>
        <div className="modal-footer">
          <button className="btn btn-primary btn-full" onClick={onRequestClose}>
            {t('done')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default memo(SettingsModal)
