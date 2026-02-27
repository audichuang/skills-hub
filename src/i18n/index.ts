import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from './resources'

const languageStorageKey = 'skills-language'
const validLanguages = ['en', 'zh-CN', 'zh-TW']

const getStoredLanguage = () => {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(languageStorageKey)
    // Migrate legacy 'zh' value to 'zh-CN'
    if (stored === 'zh') {
      window.localStorage.setItem(languageStorageKey, 'zh-CN')
      return 'zh-CN'
    }
    if (stored && validLanguages.includes(stored)) return stored
  } catch {
    // ignore storage failures
  }
  return null
}

void i18n.use(initReactI18next).init({
  resources,
  lng: getStoredLanguage() ?? 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
