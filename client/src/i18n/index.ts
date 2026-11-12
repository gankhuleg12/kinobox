import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { mn } from './mn';
import { en } from './en';

const saved = (() => {
  try {
    return localStorage.getItem('kb_lang');
  } catch {
    return null;
  }
})();

void i18n.use(initReactI18next).init({
  resources: { mn: { translation: mn }, en: { translation: en } },
  lng: saved === 'en' ? 'en' : 'mn',
  fallbackLng: 'mn',
  interpolation: { escapeValue: false }, // React өөрөө escape хийнэ
  returnNull: false,
});

export function setLanguage(lng: 'mn' | 'en') {
  void i18n.changeLanguage(lng);
  document.documentElement.lang = lng;
  try {
    localStorage.setItem('kb_lang', lng);
  } catch {
    /* ignore */
  }
}

export default i18n;
