import { memo, useCallback, useEffect, useState } from 'react'
import type { TFunction } from 'i18next'
import type { ManagedSkill, RemoteHost, RemoteToolInfoDto } from '../types'

type RemoteHostsModalProps = {
    open: boolean
    isTauri: boolean
    remoteHosts: RemoteHost[]
    managedSkills: ManagedSkill[]
    onAdd: (data: {
        label: string
        host: string
        port: number
        username: string
        authMethod: string
        keyPath?: string
    }) => Promise<void>
    onUpdate: (data: {
        id: string
        label: string
        host: string
        port: number
        username: string
        authMethod: string
        keyPath?: string
    }) => Promise<void>
    onDelete: (hostId: string) => Promise<void>
    onTestConnection: (data: {
        host: string
        port: number
        username: string
        authMethod: string
        keyPath?: string
    }) => Promise<string>
    onSyncAll: (hostId: string, toolKeys: string[]) => Promise<void>
    onSyncSelected: (hostId: string, skillIds: string[], toolKeys: string[]) => Promise<void>
    onDetectTools: (hostId: string) => Promise<RemoteToolInfoDto[]>
    onRequestClose: () => void
    t: TFunction
}

type FormData = {
    label: string
    host: string
    port: string
    username: string
    authMethod: string
    keyPath: string
}

const emptyForm: FormData = {
    label: '',
    host: '',
    port: '22',
    username: '',
    authMethod: 'key',
    keyPath: '',
}

const RemoteHostsModal = ({
    open,
    isTauri,
    remoteHosts,
    managedSkills,
    onAdd,
    onUpdate,
    onDelete,
    onTestConnection,
    onSyncAll,
    onSyncSelected,
    onDetectTools,
    onRequestClose,
    t,
}: RemoteHostsModalProps) => {
    const [view, setView] = useState<'list' | 'form' | 'selectSync'>('list')
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState<FormData>(emptyForm)
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [syncing, setSyncing] = useState<string | null>(null)
    const [detectingSet, setDetectingSet] = useState<Set<string>>(new Set())
    const [remoteTools, setRemoteTools] = useState<
        Record<string, RemoteToolInfoDto[]>
    >({})
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
    // Selective sync state
    const [syncHostId, setSyncHostId] = useState<string | null>(null)
    const [selectedSkillIds, setSelectedSkillIds] = useState<Record<string, boolean>>({})

    useEffect(() => {
        if (!open) {
            setView('list')
            setEditingId(null)
            setForm(emptyForm)
            setTestResult(null)
            setRemoteTools({})
            setDeleteConfirm(null)
            setSyncHostId(null)
            setSelectedSkillIds({})
            setDetectingSet(new Set())
        }
    }, [open])

    // Auto-detect tools for all hosts when modal opens
    useEffect(() => {
        if (open && remoteHosts.length > 0) {
            for (const host of remoteHosts) {
                if (!remoteTools[host.id]) {
                    void (async () => {
                        setDetectingSet((prev) => new Set(prev).add(host.id))
                        try {
                            const tools = await onDetectTools(host.id)
                            setRemoteTools((prev) => ({ ...prev, [host.id]: tools }))
                        } finally {
                            setDetectingSet((prev) => {
                                const next = new Set(prev)
                                next.delete(host.id)
                                return next
                            })
                        }
                    })()
                }
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, remoteHosts])

    const handleNew = useCallback(() => {
        setEditingId(null)
        setForm(emptyForm)
        setTestResult(null)
        setView('form')
    }, [])

    const handleEdit = useCallback((host: RemoteHost) => {
        setEditingId(host.id)
        setForm({
            label: host.label,
            host: host.host,
            port: String(host.port),
            username: host.username,
            authMethod: host.auth_method,
            keyPath: host.key_path ?? '',
        })
        setTestResult(null)
        setView('form')
    }, [])

    const handleTest = useCallback(async () => {
        setTesting(true)
        setTestResult(null)
        try {
            const result = await onTestConnection({
                host: form.host,
                port: Number(form.port) || 22,
                username: form.username,
                authMethod: form.authMethod,
                keyPath: form.keyPath || undefined,
            })
            setTestResult(`✅ ${t('remote.connectionSuccess')}: ${result}`)
        } catch (err) {
            setTestResult(
                `❌ ${t('remote.connectionFailed')}: ${err instanceof Error ? err.message : String(err)}`
            )
        } finally {
            setTesting(false)
        }
    }, [form, onTestConnection, t])

    const handleSave = useCallback(async () => {
        setSaving(true)
        try {
            const data = {
                label: form.label,
                host: form.host,
                port: Number(form.port) || 22,
                username: form.username,
                authMethod: form.authMethod,
                keyPath: form.keyPath || undefined,
            }
            if (editingId) {
                await onUpdate({ id: editingId, ...data })
            } else {
                await onAdd(data)
            }
            setView('list')
        } finally {
            setSaving(false)
        }
    }, [form, editingId, onAdd, onUpdate])

    const handleDelete = useCallback(
        async (hostId: string) => {
            await onDelete(hostId)
            setDeleteConfirm(null)
        },
        [onDelete]
    )

    const handleDetectTools = useCallback(
        async (hostId: string) => {
            setDetectingSet((prev) => new Set(prev).add(hostId))
            try {
                const tools = await onDetectTools(hostId)
                setRemoteTools((prev) => ({ ...prev, [hostId]: tools }))
            } finally {
                setDetectingSet((prev) => {
                    const next = new Set(prev)
                    next.delete(hostId)
                    return next
                })
            }
        },
        [onDetectTools]
    )

    const handleSyncAll = useCallback(
        async (hostId: string) => {
            setSyncing(hostId)
            try {
                // Auto-detect tools if not yet detected
                let tools = remoteTools[hostId]
                if (!tools) {
                    tools = await onDetectTools(hostId)
                    setRemoteTools((prev) => ({ ...prev, [hostId]: tools }))
                }
                const installedKeys = tools
                    .filter((t) => t.installed)
                    .map((t) => t.key)
                await onSyncAll(hostId, installedKeys)
            } finally {
                setSyncing(null)
            }
        },
        [onSyncAll, onDetectTools, remoteTools]
    )

    const handleOpenSelectSync = useCallback((hostId: string) => {
        // Auto-detect tools if not yet detected
        if (!remoteTools[hostId]) {
            void (async () => {
                setDetectingSet((prev) => new Set(prev).add(hostId))
                try {
                    const tools = await onDetectTools(hostId)
                    setRemoteTools((prev) => ({ ...prev, [hostId]: tools }))
                } finally {
                    setDetectingSet((prev) => {
                        const next = new Set(prev)
                        next.delete(hostId)
                        return next
                    })
                }
            })()
        }
        setSyncHostId(hostId)
        const defaultSelected: Record<string, boolean> = {}
        managedSkills.forEach((s) => { defaultSelected[s.id] = true })
        setSelectedSkillIds(defaultSelected)
        setView('selectSync')
    }, [managedSkills, remoteTools, onDetectTools])

    const handleSyncSelected = useCallback(async () => {
        if (!syncHostId) return
        const ids = Object.entries(selectedSkillIds)
            .filter(([, v]) => v)
            .map(([k]) => k)
        if (ids.length === 0) return
        setSyncing(syncHostId)
        try {
            const tools = remoteTools[syncHostId] ?? []
            const installedKeys = tools
                .filter((t) => t.installed)
                .map((t) => t.key)
            await onSyncSelected(syncHostId, ids, installedKeys)
        } finally {
            setSyncing(null)
            setView('list')
        }
    }, [syncHostId, selectedSkillIds, remoteTools, onSyncSelected])

    const updateField = useCallback(
        (field: keyof FormData, value: string) => {
            setForm((prev) => ({ ...prev, [field]: value }))
        },
        []
    )

    if (!open) return null

    const syncHost = syncHostId ? remoteHosts.find((h) => h.id === syncHostId) : null

    return (
        <div className="modal-backdrop">
            <div
                className="modal remote-hosts-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="remote-hosts-title"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <div className="modal-title" id="remote-hosts-title">
                        {view === 'form'
                            ? editingId
                                ? t('remote.editRemoteHost')
                                : t('remote.addRemoteHost')
                            : view === 'selectSync'
                                ? t('remote.selectSkillsToSync')
                                : t('remote.remoteHosts')}
                    </div>
                    <button
                        className="modal-close"
                        type="button"
                        onClick={view === 'list' ? onRequestClose : () => setView('list')}
                        aria-label={t('close')}
                    >
                        ✕
                    </button>
                </div>

                <div className="modal-body">
                    {view === 'list' && (
                        <>
                            {!isTauri && (
                                <div className="remote-hosts-notice">
                                    {t('errors.notTauri')}
                                </div>
                            )}

                            {remoteHosts.length === 0 ? (
                                <div className="remote-hosts-empty">
                                    {t('remote.noRemoteHosts')}
                                </div>
                            ) : (
                                <div className="remote-hosts-list">
                                    {remoteHosts.map((host) => (
                                        <div key={host.id} className="remote-host-card">
                                            <div className="remote-host-card-header">
                                                <div className="remote-host-info">
                                                    <strong>{host.label}</strong>
                                                    <span className="remote-host-address">
                                                        {host.username}@{host.host}:{host.port}
                                                    </span>
                                                </div>
                                                <div className="remote-host-status">
                                                    <span
                                                        className={`status-dot status-${host.status}`}
                                                    />
                                                    {host.status}
                                                </div>
                                            </div>

                                            {host.last_sync_at && (
                                                <div className="remote-host-sync-info">
                                                    {t('remote.lastSync')}:{' '}
                                                    {new Date(host.last_sync_at).toLocaleString()}
                                                </div>
                                            )}

                                            {/* Remote tools */}
                                            {remoteTools[host.id] && (
                                                <div className="remote-tools-list">
                                                    <div className="remote-tools-title">
                                                        {t('remote.remoteToolsDetected')}
                                                    </div>
                                                    <div className="remote-tools-grid">
                                                        {remoteTools[host.id]
                                                            .filter((tool) => tool.installed)
                                                            .map((tool) => (
                                                                <span
                                                                    key={tool.key}
                                                                    className="remote-tool-badge"
                                                                >
                                                                    {tool.label}
                                                                </span>
                                                            ))}
                                                        {remoteTools[host.id].filter((tool) => tool.installed)
                                                            .length === 0 && (
                                                                <span className="remote-tools-none">
                                                                    {t('remote.noToolsDetected')}
                                                                </span>
                                                            )}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="remote-host-actions">
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => handleEdit(host)}
                                                >
                                                    {t('remote.edit')}
                                                </button>
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => handleDetectTools(host.id)}
                                                    disabled={detectingSet.has(host.id)}
                                                >
                                                    {detectingSet.has(host.id)
                                                        ? t('remote.detecting')
                                                        : t('remote.detectTools')}
                                                </button>
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    onClick={() => handleSyncAll(host.id)}
                                                    disabled={syncing === host.id || detectingSet.has(host.id)}
                                                >
                                                    {syncing === host.id
                                                        ? t('remote.syncing')
                                                        : t('remote.syncAllToRemote')}
                                                </button>
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    onClick={() => handleOpenSelectSync(host.id)}
                                                    disabled={syncing === host.id || detectingSet.has(host.id)}
                                                >
                                                    {t('remote.selectSkillsToSync')}
                                                </button>
                                                {deleteConfirm === host.id ? (
                                                    <>
                                                        <button
                                                            className="btn btn-danger btn-sm"
                                                            onClick={() => handleDelete(host.id)}
                                                        >
                                                            {t('confirm')}
                                                        </button>
                                                        <button
                                                            className="btn btn-secondary btn-sm"
                                                            onClick={() => setDeleteConfirm(null)}
                                                        >
                                                            {t('cancel')}
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        className="btn btn-danger btn-sm"
                                                        onClick={() => setDeleteConfirm(host.id)}
                                                    >
                                                        {t('remove')}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <button
                                className="btn btn-primary btn-full"
                                onClick={handleNew}
                                style={{ marginTop: '12px' }}
                            >
                                + {t('remote.addRemoteHost')}
                            </button>
                        </>
                    )}

                    {view === 'selectSync' && syncHost && (
                        <div className="select-sync-panel">
                            <div className="select-sync-description">
                                {t('remote.selectSkillsToSync')} → <strong>{syncHost.label}</strong>
                            </div>
                            <div className="select-sync-list">
                                <label className="select-sync-item select-all">
                                    <input
                                        type="checkbox"
                                        checked={managedSkills.length > 0 && managedSkills.every((s) => selectedSkillIds[s.id])}
                                        onChange={(e) => {
                                            const next: Record<string, boolean> = {}
                                            managedSkills.forEach((s) => { next[s.id] = e.target.checked })
                                            setSelectedSkillIds(next)
                                        }}
                                    />
                                    <span>{t('selectAll')}</span>
                                </label>
                                {managedSkills.map((skill) => (
                                    <label key={skill.id} className="select-sync-item">
                                        <input
                                            type="checkbox"
                                            checked={selectedSkillIds[skill.id] ?? false}
                                            onChange={(e) => {
                                                setSelectedSkillIds((prev) => ({
                                                    ...prev,
                                                    [skill.id]: e.target.checked,
                                                }))
                                            }}
                                        />
                                        <span>{skill.name}</span>
                                    </label>
                                ))}
                            </div>
                            <div className="select-sync-actions">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setView('list')}
                                >
                                    {t('cancel')}
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleSyncSelected}
                                    disabled={
                                        syncing === syncHostId ||
                                        !Object.values(selectedSkillIds).some(Boolean)
                                    }
                                >
                                    {syncing === syncHostId
                                        ? t('remote.syncing')
                                        : t('remote.syncSelected')}
                                </button>
                            </div>
                        </div>
                    )}

                    {view === 'form' && (
                        <div className="remote-host-form">
                            <div className="settings-field">
                                <label className="settings-label">
                                    {t('remote.remoteHostLabel')}
                                </label>
                                <input
                                    className="settings-input"
                                    value={form.label}
                                    onChange={(e) => updateField('label', e.target.value)}
                                    placeholder="My VM"
                                />
                            </div>

                            <div className="settings-field">
                                <label className="settings-label">
                                    {t('remote.remoteHostAddress')}
                                </label>
                                <input
                                    className="settings-input mono"
                                    value={form.host}
                                    onChange={(e) => updateField('host', e.target.value)}
                                    placeholder="192.168.1.100"
                                />
                            </div>

                            <div className="settings-field">
                                <label className="settings-label">
                                    {t('remote.remoteHostPort')}
                                </label>
                                <input
                                    className="settings-input"
                                    type="number"
                                    value={form.port}
                                    onChange={(e) => updateField('port', e.target.value)}
                                    min={1}
                                    max={65535}
                                />
                            </div>

                            <div className="settings-field">
                                <label className="settings-label">
                                    {t('remote.remoteHostUsername')}
                                </label>
                                <input
                                    className="settings-input mono"
                                    value={form.username}
                                    onChange={(e) => updateField('username', e.target.value)}
                                    placeholder="ubuntu"
                                />
                            </div>

                            <div className="settings-field">
                                <label className="settings-label">
                                    {t('remote.remoteHostAuthMethod')}
                                </label>
                                <div className="settings-select-wrap">
                                    <select
                                        className="settings-select"
                                        value={form.authMethod}
                                        onChange={(e) => updateField('authMethod', e.target.value)}
                                    >
                                        <option value="key">SSH Key</option>
                                        <option value="agent">SSH Agent</option>
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

                            {form.authMethod === 'key' && (
                                <div className="settings-field">
                                    <label className="settings-label">
                                        {t('remote.remoteHostKeyPath')}
                                    </label>
                                    <input
                                        className="settings-input mono"
                                        value={form.keyPath}
                                        onChange={(e) => updateField('keyPath', e.target.value)}
                                        placeholder="~/.ssh/id_ed25519"
                                    />
                                    <div className="settings-helper">
                                        {t('remote.keyPathHint')}
                                    </div>
                                </div>
                            )}

                            {testResult && (
                                <div className="remote-test-result">{testResult}</div>
                            )}

                            <div className="remote-form-actions">
                                <button
                                    className="btn btn-secondary"
                                    onClick={handleTest}
                                    disabled={testing || !form.host || !form.username}
                                >
                                    {testing
                                        ? t('remote.testingConnection')
                                        : t('remote.testConnection')}
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleSave}
                                    disabled={saving || !form.label || !form.host || !form.username}
                                >
                                    {saving ? '...' : editingId ? t('done') : t('create')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button
                        className="btn btn-primary btn-full"
                        onClick={view === 'list' ? onRequestClose : () => setView('list')}
                    >
                        {view === 'list' ? t('done') : t('remote.backToList')}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default memo(RemoteHostsModal)
