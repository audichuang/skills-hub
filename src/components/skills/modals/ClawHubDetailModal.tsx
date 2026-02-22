import { memo, useEffect, useState, useCallback } from 'react'
import {
    Download, ExternalLink, Star, Package, Users,
    Github, Folder, FileText, ChevronRight, ChevronDown,
} from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { TFunction } from 'i18next'

type ClawHubFullDetail = {
    slug: string
    displayName: string
    summary?: string | null
    version?: string | null
    changelog?: string | null
    ownerHandle?: string | null
    ownerName?: string | null
    ownerImage?: string | null
    githubUrl?: string | null
    downloads?: number | null
    stars?: number | null
    installsCurrent?: number | null
    installsAllTime?: number | null
    tags?: string[] | null
    createdAt?: number | null
    updatedAt?: number | null
}

type FileEntry = { path: string; isDir: boolean }

type TreeNode = {
    name: string
    isDir: boolean
    children: TreeNode[]
}

type ClawHubDetailModalProps = {
    slug: string | null
    installingSlug: string | null
    onInstall: (slug: string, version?: string | null) => void
    onRequestClose: () => void
    invokeTauri: <T, >(command: string, args?: Record<string, unknown>) => Promise<T>
    t: TFunction
}

function formatNumber(n: number | null | undefined): string {
    if (n == null) return '—'
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
}

function formatDate(ms: number | null | undefined): string {
    if (!ms) return '—'
    return new Date(ms).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    })
}

/** Build tree from flat file entries */
function buildTree(entries: FileEntry[]): TreeNode[] {
    const root: TreeNode[] = []
    for (const entry of entries) {
        const parts = entry.path.split('/')
        let current = root
        for (let i = 0; i < parts.length; i++) {
            const name = parts[i]
            const isLast = i === parts.length - 1
            let node = current.find((n) => n.name === name)
            if (!node) {
                node = { name, isDir: isLast ? entry.isDir : true, children: [] }
                current.push(node)
            }
            current = node.children
        }
    }
    const sortNodes = (nodes: TreeNode[]) => {
        nodes.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
            return a.name.localeCompare(b.name)
        })
        for (const n of nodes) sortNodes(n.children)
    }
    sortNodes(root)
    return root
}

/** Recursive tree node component */
const TreeItem = ({ node, depth }: { node: TreeNode; depth: number }) => {
    const [open, setOpen] = useState(depth < 1)
    if (node.isDir) {
        return (
            <div className="ch-tree-dir">
                <button
                    className="ch-tree-row"
                    type="button"
                    style={{ paddingLeft: `${depth * 16 + 4}px` }}
                    onClick={() => setOpen(!open)}
                >
                    {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <Folder size={14} className="ch-tree-icon dir" />
                    <span className="ch-tree-name">{node.name}</span>
                </button>
                {open && node.children.map((child) => (
                    <TreeItem key={child.name} node={child} depth={depth + 1} />
                ))}
            </div>
        )
    }
    return (
        <div
            className="ch-tree-row file"
            style={{ paddingLeft: `${depth * 16 + 4}px` }}
        >
            <span style={{ width: 12 }} />
            <FileText size={14} className="ch-tree-icon file" />
            <span className="ch-tree-name">{node.name}</span>
        </div>
    )
}

const ClawHubDetailModal = ({
    slug,
    installingSlug,
    onInstall,
    onRequestClose,
    invokeTauri,
    t,
}: ClawHubDetailModalProps) => {
    const [detail, setDetail] = useState<ClawHubFullDetail | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [fileTree, setFileTree] = useState<TreeNode[] | null>(null)
    const [treeLoading, setTreeLoading] = useState(false)

    useEffect(() => {
        if (!slug) return
        let cancelled = false
        const fetchDetail = async () => {
            setLoading(true)
            setError(null)
            setDetail(null)
            setFileTree(null)
            try {
                const d = await invokeTauri<ClawHubFullDetail>('get_clawhub_skill_cmd', { slug })
                if (cancelled) return
                setDetail(d)
                if (d.ownerHandle) {
                    setTreeLoading(true)
                    try {
                        const files = await invokeTauri<FileEntry[]>('get_github_tree_cmd', {
                            owner: d.ownerHandle,
                            repo: d.slug,
                        })
                        if (!cancelled) setFileTree(buildTree(files))
                    } catch { /* repo might be private */ }
                    finally { if (!cancelled) setTreeLoading(false) }
                }
            } catch (e) { if (!cancelled) setError(String(e)) }
            finally { if (!cancelled) setLoading(false) }
        }
        void fetchDetail()
        return () => { cancelled = true }
    }, [slug, invokeTauri])

    const handleOpenUrl = useCallback((url: string) => {
        void openUrl(url)
    }, [])

    if (!slug) return null

    return (
        <div className="modal-backdrop">
            <div className="modal modal-lg clawhub-detail-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="modal-title">{t('skillDetail')}</div>
                    <button className="modal-close" type="button" onClick={onRequestClose} aria-label={t('close')}>
                        ✕
                    </button>
                </div>

                <div className="modal-body">
                    {loading && (
                        <div className="clawhub-detail-loading">
                            <div className="spinner" />
                            <div>{t('loadingDetail')}</div>
                        </div>
                    )}

                    {error && (
                        <div className="clawhub-detail-error"><div>{error}</div></div>
                    )}

                    {detail && (
                        <div className="clawhub-full-detail">
                            {/* Hero */}
                            <div className="ch-hero">
                                <div className="ch-hero-info">
                                    <h2 className="ch-title">{detail.displayName}</h2>
                                    {detail.summary && <p className="ch-summary">{detail.summary}</p>}
                                </div>
                                <div className="ch-version-box">
                                    <div className="ch-version-label">{t('detailVersion')}</div>
                                    <div className="ch-version-value">v{detail.version || '—'}</div>
                                    <button
                                        className="btn btn-primary"
                                        type="button"
                                        onClick={() => onInstall(detail.slug, detail.version)}
                                        disabled={installingSlug === detail.slug}
                                    >
                                        {installingSlug === detail.slug ? t('installingFromClawHub') : t('installFromClawHub')}
                                    </button>
                                </div>
                            </div>

                            {/* Stats */}
                            <div className="ch-stats-bar">
                                <div className="ch-stat"><Star size={14} /><span>{formatNumber(detail.stars)}</span></div>
                                <div className="ch-stat"><Download size={14} /><span>{formatNumber(detail.downloads)}</span></div>
                                <div className="ch-stat"><Package size={14} /><span>{formatNumber(detail.installsCurrent)} {t('detailCurrentInstalls')}</span></div>
                                <div className="ch-stat"><Users size={14} /><span>{formatNumber(detail.installsAllTime)} {t('detailAllTimeInstalls')}</span></div>
                            </div>

                            {/* Author */}
                            {detail.ownerHandle && (
                                <div className="ch-author">
                                    {detail.ownerImage && (
                                        <img className="ch-author-avatar" src={detail.ownerImage} alt={detail.ownerHandle} />
                                    )}
                                    <span className="ch-author-label">{t('detailBy')}</span>
                                    <a
                                        className="ch-author-name"
                                        href="#"
                                        onClick={(e) => { e.preventDefault(); handleOpenUrl(`https://clawhub.ai/${detail.ownerHandle}`) }}
                                    >
                                        @{detail.ownerHandle}
                                    </a>
                                </div>
                            )}

                            {/* Tags */}
                            {detail.tags && detail.tags.length > 0 && (
                                <div className="ch-tags">
                                    {detail.tags.map((tag) => (
                                        <span key={tag} className="ch-tag">{tag}</span>
                                    ))}
                                </div>
                            )}

                            {/* File tree */}
                            <div className="ch-section">
                                <div className="ch-section-title">{t('detailFiles')}</div>
                                {treeLoading && <div className="helper-text">{t('loadingDetail')}</div>}
                                {fileTree && fileTree.length > 0 && (
                                    <div className="ch-file-tree">
                                        {fileTree.map((node) => (
                                            <TreeItem key={node.name} node={node} depth={0} />
                                        ))}
                                    </div>
                                )}
                                {!treeLoading && (!fileTree || fileTree.length === 0) && (
                                    <div className="helper-text">{t('detailNoFiles')}</div>
                                )}
                            </div>

                            {/* Changelog */}
                            {detail.changelog && (
                                <div className="ch-section">
                                    <div className="ch-section-title">{t('detailChangelog')}</div>
                                    <div className="ch-section-content">{detail.changelog}</div>
                                </div>
                            )}

                            {/* Dates */}
                            <div className="ch-dates">
                                <div className="ch-date-item">
                                    <span className="ch-date-label">{t('detailCreated')}</span>
                                    <span>{formatDate(detail.createdAt)}</span>
                                </div>
                                <div className="ch-date-item">
                                    <span className="ch-date-label">{t('detailUpdated')}</span>
                                    <span>{formatDate(detail.updatedAt)}</span>
                                </div>
                            </div>

                            {/* Links */}
                            <div className="ch-links">
                                {detail.githubUrl && fileTree && fileTree.length > 0 && (
                                    <button
                                        className="btn btn-outline ch-github-btn"
                                        type="button"
                                        onClick={() => handleOpenUrl(detail.githubUrl!)}
                                    >
                                        <Github size={16} />
                                        {t('viewOnGitHub')}
                                    </button>
                                )}
                                <button
                                    className="btn btn-outline ch-github-btn"
                                    type="button"
                                    onClick={() => handleOpenUrl(`https://clawhub.ai/${detail.ownerHandle || '_'}/${detail.slug}`)}
                                >
                                    <ExternalLink size={14} />
                                    {t('viewOnClawHub')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default memo(ClawHubDetailModal)
