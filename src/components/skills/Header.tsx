import { memo } from 'react'
import { Plus, Settings } from 'lucide-react'
import type { TFunction } from 'i18next'

type HeaderProps = {
  language: string
  loading: boolean
  onChangeLanguage: (lang: string) => void
  onOpenSettings: () => void
  onOpenAdd: () => void
  t: TFunction
}

const Header = ({
  language,
  loading,
  onChangeLanguage,
  onOpenSettings,
  onOpenAdd,
  t,
}: HeaderProps) => {
  return (
    <header className="skills-header">
      <div className="brand-area">
        <img className="logo-icon" src="/logo.png" alt="" />
        <div className="brand-text-wrap">
          <div className="brand-text">{t('appName')}</div>
          <div className="brand-subtitle">{t('subtitle')}</div>
        </div>
      </div>
      <div className="header-actions">
        <div className="lang-select-wrap">
          <select
            className="lang-select"
            value={language}
            onChange={(e) => onChangeLanguage(e.target.value)}
          >
            <option value="en">{t('languageShort.en')}</option>
            <option value="zh-CN">{t('languageShort.zh-CN')}</option>
            <option value="zh-TW">{t('languageShort.zh-TW')}</option>
          </select>
          <svg
            className="lang-select-caret"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
        <button className="icon-btn" type="button" onClick={onOpenSettings}>
          <Settings size={18} />
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={onOpenAdd}
          disabled={loading}
        >
          <Plus size={16} />
          {t('newSkill')}
        </button>
      </div>
    </header>
  )
}

export default memo(Header)
