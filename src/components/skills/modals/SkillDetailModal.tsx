import { memo, useEffect, useState } from 'react'
import { Box, Copy, ExternalLink, Folder, Github, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { TFunction } from 'i18next'
import type { ManagedSkill, ToolOption } from '../types'

type ClawHubDetail = {
    slug: string
    displayName: string
    summary?: string | null
    version?: string | null
    changelog?: string | null
    ownerHandle?: string | null
    ownerName?: string | null
    createdAt?: number | null
    updatedAt?: number | null
}

type SkillDetailModalProps = {
    skill: ManagedSkill | null
    installedTools: ToolOption[]
    loading: boolean
    formatRelative: (ms: number | null | undefined) => string
    onUpdate: (skill: ManagedSkill) => void
    onDelete: (skillId: string) => void
    onToggleTool: (skill: ManagedSkill, toolId: string) => void
    onRequestClose: () => void
    invokeTauri: <T, >(command: string, args?: Record<string, unknown>) => Promise<T>
    t: TFunction
}

const SkillDetailModal = ({
    skill,
    installedTools,
    loading,
    formatRelative,
    onUpdate,
    onDelete,
    onToggleTool,
    onRequestClose,
    invokeTauri,
    t,
}: SkillDetailModalProps) => {
    const [clawHubDetail, setClawHubDetail] = useState<ClawHubDetail | null>(null)
    const [detailLoading, setDetailLoading] = useState(false)

    useEffect(() => {
        if (!skill || skill.source_type !== 'clawhub') {
            return
        }
        const slug = skill.source_ref?.replace('clawhub://', '')
        if (!slug) return

        let cancelled = false
        const fetchDetail = async () => {
            setDetailLoading(true)
            try {
                const detail = await invokeTauri<ClawHubDetail>('get_clawhub_skill_cmd', { slug })
                if (!cancelled) setClawHubDetail(detail)
            } catch {
                if (!cancelled) setClawHubDetail(null)
            } finally {
                if (!cancelled) setDetailLoading(false)
            }
        }
        void fetchDetail()
        return () => { cancelled = true }
    }, [skill, invokeTauri])

    if (!skill) return null

    const isGit = skill.source_type.toLowerCase().includes('git')
    const isClawHub = skill.source_type === 'clawhub'
    const sourceIcon = isGit ? (
        <Github size={16} />
    ) : isClawHub ? (
        <Box size={16} />
    ) : (
        <Folder size={16} />
    )
    const sourceLabel = isClawHub
        ? 'ClawHub'
        : isGit
            ? 'Git'
            : 'Local'

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text)
            toast.success(t('copied'))
        } catch {
            toast.error(t('copyFailed'))
        }
    }

    return (
        <div className="modal-backdrop">
            <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="modal-title">{skill.name}</div>
                    <button
                        className="modal-close"
                        type="button"
                        onClick={onRequestClose}
                        aria-label={t('close')}
                    >
                        ✕
                    </button>
                </div>
                <div className="modal-body skill-detail-body">
                    {/* Source type badge */}
                    <div className="detail-badge-row">
                        <span className={`detail-badge detail-badge-${skill.source_type}`}>
                            {sourceIcon}
                            {sourceLabel}
                        </span>
                    </div>

                    {/* ClawHub extra info */}
                    {isClawHub && (
                        <div className="detail-section">
                            {detailLoading ? (
                                <div className="helper-text">{t('loadingDetail')}</div>
                            ) : clawHubDetail ? (
                                <>
                                    {clawHubDetail.summary && (
                                        <div className="detail-summary">{clawHubDetail.summary}</div>
                                    )}
                                    <div className="detail-meta-grid">
                                        {clawHubDetail.version && (
                                            <div className="detail-meta-item">
                                                <span className="detail-meta-label">{t('detailVersion')}</span>
                                                <span className="detail-meta-value mono">v{clawHubDetail.version}</span>
                                            </div>
                                        )}
                                        {clawHubDetail.ownerHandle && (
                                            <div className="detail-meta-item">
                                                <span className="detail-meta-label">{t('detailAuthor')}</span>
                                                <span className="detail-meta-value">
                                                    {clawHubDetail.ownerName || clawHubDetail.ownerHandle}
                                                </span>
                                            </div>
                                        )}
                                        {clawHubDetail.changelog && (
                                            <div className="detail-meta-item detail-meta-full">
                                                <span className="detail-meta-label">{t('detailChangelog')}</span>
                                                <span className="detail-meta-value">{clawHubDetail.changelog}</span>
                                            </div>
                                        )}
                                    </div>
                                    {clawHubDetail.slug && (
                                        <button
                                            className="detail-link"
                                            type="button"
                                            onClick={() => void openUrl(`https://clawhub.ai/${clawHubDetail.ownerHandle || '_'}/${clawHubDetail.slug}`)}
                                        >
                                            <ExternalLink size={14} />
                                            {t('viewOnClawHub')}
                                        </button>
                                    )}
                                </>
                            ) : null}
                        </div>
                    )}

                    {/* Source ref */}
                    {skill.source_ref && !isClawHub && (
                        <div className="detail-section">
                            <div className="detail-meta-label">{t('detailSource')}</div>
                            <div className="detail-copyable" onClick={() => void copyToClipboard(skill.source_ref!)}>
                                <span className="mono">{skill.source_ref}</span>
                                <Copy size={12} />
                            </div>
                        </div>
                    )}

                    {/* Central path */}
                    <div className="detail-section">
                        <div className="detail-meta-label">{t('detailCentralPath')}</div>
                        <div className="detail-copyable" onClick={() => void copyToClipboard(skill.central_path)}>
                            <span className="mono">{skill.central_path}</span>
                            <Copy size={12} />
                        </div>
                    </div>

                    {/* Timestamps */}
                    <div className="detail-section">
                        <div className="detail-meta-grid">
                            <div className="detail-meta-item">
                                <span className="detail-meta-label">{t('detailCreated')}</span>
                                <span className="detail-meta-value">{formatRelative(skill.created_at)}</span>
                            </div>
                            <div className="detail-meta-item">
                                <span className="detail-meta-label">{t('detailUpdated')}</span>
                                <span className="detail-meta-value">{formatRelative(skill.updated_at)}</span>
                            </div>
                            {skill.last_sync_at && (
                                <div className="detail-meta-item">
                                    <span className="detail-meta-label">{t('detailLastSync')}</span>
                                    <span className="detail-meta-value">{formatRelative(skill.last_sync_at)}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Sync targets */}
                    <div className="detail-section">
                        <div className="detail-meta-label">{t('detailSyncStatus')}</div>
                        <div className="detail-targets">
                            {installedTools.map((tool) => {
                                const target = skill.targets.find((t) => t.tool === tool.id)
                                const synced = Boolean(target)
                                return (
                                    <button
                                        key={tool.id}
                                        type="button"
                                        className={`tool-pill ${synced ? 'active' : 'inactive'}`}
                                        onClick={() => void onToggleTool(skill, tool.id)}
                                    >
                                        {synced ? <span className="status-badge" /> : null}
                                        {tool.label}
                                        {target && (
                                            <span className="detail-target-mode">({target.mode})</span>
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                </div>

                {/* Footer actions */}
                <div className="modal-footer space-between">
                    <button
                        className="btn btn-danger"
                        type="button"
                        onClick={() => { onDelete(skill.id); onRequestClose() }}
                        disabled={loading}
                    >
                        <Trash2 size={14} />
                        {t('remove')}
                    </button>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button
                            className="btn btn-secondary"
                            type="button"
                            onClick={onRequestClose}
                        >
                            {t('close')}
                        </button>
                        <button
                            className="btn btn-primary"
                            type="button"
                            onClick={() => onUpdate(skill)}
                            disabled={loading}
                        >
                            <RefreshCw size={14} />
                            {t('update')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default memo(SkillDetailModal)
