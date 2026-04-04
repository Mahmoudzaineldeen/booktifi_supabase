import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';

export function ThemeToggle() {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const isAr = i18n.language?.startsWith('ar');

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="fixed bottom-5 right-5 z-[120] inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white/95 px-4 py-2 text-sm font-medium text-gray-700 shadow-lg backdrop-blur transition hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900/95 dark:text-gray-200 dark:hover:bg-gray-800"
      title={
        isDark
          ? (isAr ? 'التبديل إلى الوضع الفاتح' : (t('common.switchToLightMode', 'Switch to light mode')))
          : (isAr ? 'التبديل إلى الوضع الداكن' : (t('common.switchToDarkMode', 'Switch to dark mode')))
      }
      aria-label={
        isDark
          ? (isAr ? 'التبديل إلى الوضع الفاتح' : (t('common.switchToLightMode', 'Switch to light mode')))
          : (isAr ? 'التبديل إلى الوضع الداكن' : (t('common.switchToDarkMode', 'Switch to dark mode')))
      }
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span className="hidden sm:inline">
        {isDark ? (isAr ? 'فاتح' : (t('common.lightMode', 'Light'))) : (isAr ? 'داكن' : (t('common.darkMode', 'Dark')))}
      </span>
    </button>
  );
}

