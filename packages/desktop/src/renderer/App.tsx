import React, { useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { HomeScreen } from './screens/HomeScreen';
import { DeduplicationScreen } from './screens/DeduplicationScreen';
import { CullingScreen } from './screens/CullingScreen';
import { YearInReviewScreen } from './screens/YearInReviewScreen';
import { colors, typography } from './theme';
import { I18nProvider, useTranslation, i18next, SUPPORTED_LOCALES, normalizeLocale } from '@photo-manager/shared';

let activeSystemLocale = 'en';

function getErrorBoundaryCopy(): { title: string; fallback: string; reload: string } {
  return { title: i18next.t('common.error'), fallback: i18next.t('common.error'), reload: i18next.t('common.retry') };
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[renderer] fatal render error:', error);
  }

  render() {
    if (this.state.error) {
      const copy = getErrorBoundaryCopy();
      return (
        <div style={{
          minHeight: '100vh',
          background: colors.background,
          color: colors.text,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px',
          fontFamily: typography.fontFamily,
        }}>
          <div style={{
            maxWidth: '560px',
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: '12px',
            padding: '24px',
          }}>
            <h2 style={{ marginTop: 0 }}>{copy.title}</h2>
            <p style={{ color: colors.textSecondary }}>
              {this.state.error.message || copy.fallback}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
        padding: '8px 14px',
        borderRadius: '8px',
        border: 'none',
        background: colors.accent,
        color: colors.textOnStrong,
        fontWeight: typography.weights.semibold,
        cursor: 'pointer',
      }}
            >
              {copy.reload}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Sidebar navigation item
function NavItem({
  to,
  icon,
  label,
  isActive,
  onClick,
}: {
  to: string;
  icon: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        width: '100%',
        padding: '16px 18px',
        background: isActive ? colors.accent : 'transparent',
        border: isActive ? `1px solid ${colors.accent}` : '1px solid transparent',
        borderRadius: '8px',
        color: colors.textOnStrong,
        fontSize: '16px',
        fontWeight: isActive ? '700' : '500',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
          e.currentTarget.style.color = colors.textOnStrong;
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.color = colors.textOnStrong;
        }
      }}
    >
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '22px',
        height: '22px',
        fontSize: '15px',
      }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;
  const { t, i18n } = useTranslation();

  useEffect(() => {
    document.title = t('home.title');
    document.documentElement.lang = i18n.resolvedLanguage ?? i18n.language;
  }, [t, i18n.resolvedLanguage, i18n.language]);

  const navItems = [
    { path: '/', icon: '■', label: t('home.library') },
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div
        style={{
          width: '220px',
          flexShrink: 0,
          backgroundColor: colors.sidebar,
          borderRight: `1px solid ${colors.sidebarBorder}`,
          display: 'flex',
          flexDirection: 'column',
          padding: '44px 18px 24px',
          gap: '10px',
          overflowY: 'auto',
        }}
      >
        {/* App title */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            flexDirection: 'column',
            padding: '0 8px 28px',
            borderBottom: `1px solid ${colors.sidebarBorder}`,
            marginBottom: '10px',
          }}
        >
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: colors.accent,
            color: colors.textOnStrong,
            fontSize: '20px',
            boxShadow: '0 10px 20px rgba(20,184,166,0.25)',
          }}>
            ▣
          </span>
          <h1
            style={{
              fontSize: '20px',
              minWidth: 0,
              overflowWrap: 'normal',
              hyphens: 'auto',
              fontWeight: '700',
              color: colors.textOnStrong,
              margin: 0,
            }}
          >
            {t('home.title')}
          </h1>
        </div>

        <select aria-label="Language" data-testid="language-select"
          value={normalizeLocale(i18n.language)} style={{ width: '100%', minHeight: 42, padding: 8 }}
          onChange={async event => {
            const locale = event.target.value;
            await window.electronAPI?.app.setLocale(locale);
            await i18n.changeLanguage(locale);
            localStorage.setItem('albumdone.locale', locale);
          }}>
          {Object.entries(SUPPORTED_LOCALES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>

        {/* Navigation items */}
        {navItems.map((item) => (
          <NavItem
            key={item.path}
            to={item.path}
            icon={item.icon}
            label={item.label}
            isActive={currentPath === item.path}
            onClick={() => navigate(item.path)}
          />
        ))}

        <div style={{
          marginTop: 'auto',
          padding: '18px',
          border: `1px solid ${colors.sidebarBorder}`,
          borderRadius: '10px',
          background: 'rgba(255,255,255,0.035)',
          color: colors.textOnStrong,
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '10px',
            fontSize: '14px',
            fontWeight: typography.weights.bold,
          }}>
            <span style={{
              display: 'inline-flex',
              width: '28px',
              height: '28px',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '8px',
              background: colors.accent,
            }}>✓</span>
            {t('home.privacyTitle')}
          </div>
          <p style={{
            margin: 0,
            color: colors.textOnStrong,
            fontSize: '13px',
            lineHeight: 1.5,
          }}>
            {t('home.privacyBody')}
          </p>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/deduplication" element={<DeduplicationScreen />} />
          <Route path="/culling" element={<CullingScreen />} />
          <Route path="/year-in-review" element={<YearInReviewScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App(): React.JSX.Element {
  const [systemLocale, setSystemLocale] = useState<string | undefined>(undefined);

  useEffect(() => {
    let isMounted = true;

    if (!window.electronAPI?.app?.getLocale) {
      activeSystemLocale = 'en';
      setSystemLocale('en');
      return () => {
        isMounted = false;
      };
    }

    void window.electronAPI.app.getLocale()
      .then((locale) => {
        if (isMounted) {
          const chosen = localStorage.getItem('albumdone.locale') ?? locale ?? 'en';
          activeSystemLocale = chosen;
          void window.electronAPI?.app.setLocale(chosen);
          setSystemLocale(chosen);
        }
      })
      .catch(() => {
        if (isMounted) {
          activeSystemLocale = 'en';
          setSystemLocale('en');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (systemLocale === undefined) {
    return (
      <div style={{
        minHeight: '100vh',
        background: colors.background,
      }} />
    );
  }

  return (
    <I18nProvider systemLocale={systemLocale}>
      <AppErrorBoundary>
        <Router>
          <AppLayout />
        </Router>
      </AppErrorBoundary>
    </I18nProvider>
  );
}
