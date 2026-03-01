import { memo } from 'react'
import { ArrowUpDown, Box, Folder, Github, Pencil, RefreshCw, Search, X } from 'lucide-react'
import type { TFunction } from 'i18next'

export type SourceFilterValue = 'all' | 'local' | 'git' | 'clawhub'

type FilterBarProps = {
  sortBy: 'updated' | 'name'
  sourceFilter: SourceFilterValue
  searchQuery: string
  loading: boolean
  isEditMode: boolean
  onSortChange: (value: 'updated' | 'name') => void
  onSourceFilterChange: (value: SourceFilterValue) => void
  onSearchChange: (value: string) => void
  onRefresh: () => void
  onToggleEditMode: () => void
  t: TFunction
}

const sourceOptions: { value: SourceFilterValue; icon?: typeof Github }[] = [
  { value: 'all' },
  { value: 'local', icon: Folder },
  { value: 'git', icon: Github },
  { value: 'clawhub', icon: Box },
]

const FilterBar = ({
  sortBy,
  sourceFilter,
  searchQuery,
  loading,
  isEditMode,
  onSortChange,
  onSourceFilterChange,
  onSearchChange,
  onRefresh,
  onToggleEditMode,
  t,
}: FilterBarProps) => {
  return (
    <div className="filter-bar">
      <div className="filter-left">
        <div className="filter-title">{t('allSkills')}</div>
        <div className="source-filter-group">
          {sourceOptions.map(({ value, icon: Icon }) => (
            <button
              key={value}
              type="button"
              className={`source-filter-pill${sourceFilter === value ? ' active' : ''}`}
              onClick={() => onSourceFilterChange(value)}
            >
              {Icon ? <Icon size={13} /> : null}
              {t(`sourceFilter.${value}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-actions">
        <button className="btn btn-secondary sort-btn" type="button">
          <span className="sort-label">{t('filterSort')}:</span>
          {sortBy === 'updated' ? t('sortUpdated') : t('sortName')}
          <ArrowUpDown size={12} />
          <select
            aria-label={t('filterSort')}
            value={sortBy}
            onChange={(event) => onSortChange(event.target.value as 'updated' | 'name')}
          >
            <option value="updated">{t('sortUpdated')}</option>
            <option value="name">{t('sortName')}</option>
          </select>
        </button>
        <div className="search-container">
          <Search size={16} className="search-icon-abs" />
          <input
            className="search-input"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t('searchPlaceholder')}
          />
        </div>
        <button
          className={`btn ${isEditMode ? 'btn-accent' : 'btn-secondary'}`}
          type="button"
          onClick={onToggleEditMode}
          disabled={loading}
        >
          {isEditMode ? <X size={14} /> : <Pencil size={14} />}
          {isEditMode ? t('done') : t('batchEdit')}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw size={14} />
          {t('refresh')}
        </button>
      </div>
    </div>
  )
}

export default memo(FilterBar)
