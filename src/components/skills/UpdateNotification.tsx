import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Download, RefreshCw, RotateCcw } from 'lucide-react'

type UpdateState = 'checking' | 'downloading' | 'ready' | 'error' | 'dismissed'

type UpdateNotificationProps = {
    onDismiss: () => void
}

function UpdateNotification({ onDismiss }: UpdateNotificationProps) {
    const { t } = useTranslation()
    const [state, setState] = useState<UpdateState>('checking')
    const [progress, setProgress] = useState(0)
    const [version, setVersion] = useState('')
    const [errorMsg, setErrorMsg] = useState('')

    const doCheck = useCallback(async () => {
        setState('checking')
        setErrorMsg('')
        try {
            const { check } = await import('@tauri-apps/plugin-updater')
            const update = await check()
            if (!update) {
                onDismiss()
                return
            }

            setVersion(update.version)
            setState('downloading')

            let downloaded = 0
            let contentLength = 0
            await update.downloadAndInstall((event) => {
                switch (event.event) {
                    case 'Started':
                        contentLength = event.data.contentLength ?? 0
                        break
                    case 'Progress':
                        downloaded += event.data.chunkLength
                        if (contentLength > 0) {
                            setProgress(Math.round((downloaded / contentLength) * 100))
                        }
                        break
                    case 'Finished':
                        break
                }
            })

            setState('ready')
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            setErrorMsg(msg)
            setState('error')
        }
    }, [onDismiss])

    useEffect(() => {
        void doCheck()
    }, [doCheck])

    const handleRestart = async () => {
        try {
            const { relaunch } = await import('@tauri-apps/plugin-process')
            await relaunch()
        } catch {
            // If relaunch fails, just dismiss
            onDismiss()
        }
    }

    if (state === 'checking') return null

    return (
        <div className="update-notification">
            <button
                className="update-notification-close"
                onClick={onDismiss}
                aria-label={t('close')}
            >
                <X size={14} />
            </button>

            {state === 'downloading' && (
                <>
                    <div className="update-notification-icon downloading">
                        <Download size={16} />
                    </div>
                    <div className="update-notification-content">
                        <div className="update-notification-title">
                            {t('appUpdate.downloading')} v{version}
                        </div>
                        <div className="update-progress-bar">
                            <div
                                className="update-progress-fill"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <div className="update-notification-hint">{progress}%</div>
                    </div>
                </>
            )}

            {state === 'ready' && (
                <>
                    <div className="update-notification-icon ready">
                        <RefreshCw size={16} />
                    </div>
                    <div className="update-notification-content">
                        <div className="update-notification-title">
                            {t('appUpdate.ready')} — v{version}
                        </div>
                        <div className="update-notification-hint">
                            {t('appUpdate.restartPrompt')}
                        </div>
                        <div className="update-notification-actions">
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={() => void handleRestart()}
                            >
                                {t('appUpdate.btnRestart')}
                            </button>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={onDismiss}
                            >
                                {t('appUpdate.btnLater')}
                            </button>
                        </div>
                    </div>
                </>
            )}

            {state === 'error' && (
                <>
                    <div className="update-notification-icon error">
                        <RotateCcw size={16} />
                    </div>
                    <div className="update-notification-content">
                        <div className="update-notification-title">
                            {t('appUpdate.failed')}
                        </div>
                        <div className="update-notification-hint">{errorMsg}</div>
                        <div className="update-notification-actions">
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => void doCheck()}
                            >
                                {t('appUpdate.retry')}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}

export default UpdateNotification
