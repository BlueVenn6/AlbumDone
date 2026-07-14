import React, { useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { HomeScreen } from './screens/HomeScreen';
import { DeduplicationScreen } from './screens/DeduplicationScreen';
import { CullingScreen } from './screens/CullingScreen';
import { ScreenshotScreen } from './screens/ScreenshotScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { YearInReviewScreen } from './screens/YearInReviewScreen';
import { colors, typography } from './theme';
import { I18nProvider, useTranslation } from '@photo-manager/shared';

let activeSystemLocale = 'en';

function getErrorBoundaryCopy(): { title: string; fallback: string; reload: string } {
  const locale = activeSystemLocale.toLowerCase();
  if (locale === 'zh' || locale.startsWith('zh-cn') || locale.startsWith('zh-sg') || locale.startsWith('zh-hans')) {
    return {
      title: '正好相册遇到渲染错误',
      fallback: '界面加载失败，请重试。',
      reload: '重新加载',
    };
  }
  if (locale.startsWith('zh-tw') || locale.startsWith('zh-hk') || locale.startsWith('zh-mo') || locale.startsWith('zh-hant')) {
    return {
      title: '正好相冊遇到渲染錯誤',
      fallback: '介面載入失敗，請重試。',
      reload: '重新載入',
    };
  }
  return {
    title: 'AlbumDone hit a render error',
    fallback: 'The interface failed to load. Please try again.',
    reload: 'Reload',
  };
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
  const { t } = useTranslation();

  useEffect(() => {
    document.title = t('home.title');
  }, [t]);

  const navItems = [
    { path: '/', icon: '■', label: t('home.library') },
    { path: '/settings', icon: '⚙', label: t('settings.title') },
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
            alignItems: 'center',
            gap: '12px',
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
              fontSize: '22px',
              fontWeight: '700',
              color: colors.textOnStrong,
              margin: 0,
            }}
          >
            {t('home.title')}
          </h1>
        </div>

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
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/deduplication" element={<DeduplicationScreen />} />
          <Route path="/culling" element={<CullingScreen />} />
          <Route path="/screenshots" element={<ScreenshotScreen />} />
          <Route path="/year-in-review" element={<YearInReviewScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
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
          activeSystemLocale = locale || 'en';
          setSystemLocale(locale);
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
