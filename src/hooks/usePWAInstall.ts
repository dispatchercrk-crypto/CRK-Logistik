import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DriverLinkProbeStatus,
  refreshDriverLinkStatus,
} from '../utils/driverLink';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let cachedDeferredPrompt: BeforeInstallPromptEvent | null = null;
const promptSubscribers = new Set<
  (event: BeforeInstallPromptEvent | null) => void
>();
let globalListenersAttached = false;

export function ensureGlobalPwaListeners() {
  if (globalListenersAttached || typeof window === 'undefined') return;
  globalListenersAttached = true;

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    cachedDeferredPrompt = e as BeforeInstallPromptEvent;
    promptSubscribers.forEach((cb) => cb(cachedDeferredPrompt));
  });

  window.addEventListener('appinstalled', () => {
    cachedDeferredPrompt = null;
    promptSubscribers.forEach((cb) => cb(null));
  });
}

if (typeof window !== 'undefined') {
  ensureGlobalPwaListeners();
}

function detectStandaloneInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const standaloneMedia =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches;
  const iosStandalone =
    (window.navigator as unknown as { standalone?: boolean }).standalone ===
    true;
  return standaloneMedia || iosStandalone;
}

function waitForPromptBriefly(
  timeoutMs = 1200
): Promise<BeforeInstallPromptEvent | null> {
  if (cachedDeferredPrompt) {
    return Promise.resolve(cachedDeferredPrompt);
  }
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      promptSubscribers.delete(onEvent);
      resolve(cachedDeferredPrompt);
    }, timeoutMs);

    const onEvent = (ev: BeforeInstallPromptEvent | null) => {
      if (!ev || settled) return;
      settled = true;
      window.clearTimeout(timer);
      promptSubscribers.delete(onEvent);
      resolve(ev);
    };

    promptSubscribers.add(onEvent);
  });
}

function appendCurrentParamsWithInstallFlag(baseUrlStr: string): string {
  if (typeof window === 'undefined' || !baseUrlStr) return '';
  try {
    const url = new URL(baseUrlStr);
    const currentParams = new URLSearchParams(window.location.search);
    currentParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
    url.searchParams.set('install', '1');
    return url.toString();
  } catch {
    return baseUrlStr;
  }
}

/**
 * Returns an install URL that is guaranteed NEVER to point to an unprovisioned
 * `ais-pre-...` 404 URL.
 * - If a verified public URL (`Cloud Run` or live `ais-pre-...`) is confirmed live, returns it.
 * - Otherwise returns the current live origin (`window.location.origin`), which is guaranteed HTTP 200.
 */
export function buildInstallShareUrl(
  probeStatus?: DriverLinkProbeStatus | null
): string {
  if (typeof window === 'undefined') return '';
  if (probeStatus?.isShareReady && probeStatus.effectiveBaseUrl) {
    return appendCurrentParamsWithInstallFlag(probeStatus.effectiveBaseUrl);
  }
  return appendCurrentParamsWithInstallFlag(
    `${window.location.origin}${window.location.pathname}`
  );
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(() => {
      ensureGlobalPwaListeners();
      return cachedDeferredPrompt;
    });
  const [isInstalled, setIsInstalled] = useState<boolean>(() =>
    detectStandaloneInstalled()
  );
  const [isInstalling, setIsInstalling] = useState<boolean>(false);
  const [justInstalled, setJustInstalled] = useState<boolean>(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isAndroidWebView, setIsAndroidWebView] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);
  const [linkProbeStatus, setLinkProbeStatus] =
    useState<DriverLinkProbeStatus | null>(null);
  const [isCheckingPublicLink, setIsCheckingPublicLink] = useState(false);

  const recheckPublicLink = useCallback(async (force = false) => {
    setIsCheckingPublicLink(true);
    try {
      const status = await refreshDriverLinkStatus(undefined, force);
      if (status) {
        setLinkProbeStatus(status);
      }
      return status;
    } finally {
      setIsCheckingPublicLink(false);
    }
  }, []);

  useEffect(() => {
    ensureGlobalPwaListeners();
    setIsInstalled(detectStandaloneInstalled());

    const ua = window.navigator.userAgent.toLowerCase();
    const isIOSDevice =
      /iphone|ipad|ipod/.test(ua) ||
      (window.navigator.platform === 'MacIntel' &&
        window.navigator.maxTouchPoints > 1);
    const isAndroidDevice = /android/.test(ua);
    const isWebViewOnAndroid =
      isAndroidDevice &&
      (/\bwv\b/.test(ua) ||
        /whatsapp|fban|fbav|instagram|line\/|telegram/.test(ua));

    setIsIOS(isIOSDevice);
    setIsAndroid(isAndroidDevice);
    setIsAndroidWebView(isWebViewOnAndroid);

    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      setIsInIframe(true);
    }

    void recheckPublicLink(false);

    const handlePromptChange = (nextPrompt: BeforeInstallPromptEvent | null) => {
      setDeferredPrompt(nextPrompt);
      if (detectStandaloneInstalled()) {
        setIsInstalled(true);
      }
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setJustInstalled(true);
      setIsInstalling(false);
      setDeferredPrompt(null);
    };

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (ev: MediaQueryListEvent) => {
      if (ev.matches) {
        setIsInstalled(true);
        setJustInstalled(true);
      }
    };

    promptSubscribers.add(handlePromptChange);
    window.addEventListener('appinstalled', handleAppInstalled);
    mediaQuery.addEventListener?.('change', handleDisplayModeChange);

    if (cachedDeferredPrompt) {
      setDeferredPrompt(cachedDeferredPrompt);
    }

    return () => {
      promptSubscribers.delete(handlePromptChange);
      window.removeEventListener('appinstalled', handleAppInstalled);
      mediaQuery.removeEventListener?.('change', handleDisplayModeChange);
    };
  }, [recheckPublicLink]);

  const install = useCallback(async (): Promise<
    'accepted' | 'dismissed' | 'unavailable'
  > => {
    setIsInstalling(true);
    try {
      let promptEvent = deferredPrompt || cachedDeferredPrompt;
      if (!promptEvent && !isInIframe && !isIOS) {
        promptEvent = await waitForPromptBriefly(1200);
      }
      if (!promptEvent) {
        return 'unavailable';
      }
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') {
        cachedDeferredPrompt = null;
        setDeferredPrompt(null);
        setIsInstalled(true);
        setJustInstalled(true);
        promptSubscribers.forEach((cb) => cb(null));
        return 'accepted';
      }
      return 'dismissed';
    } catch {
      return 'unavailable';
    } finally {
      setIsInstalling(false);
    }
  }, [deferredPrompt, isIOS, isInIframe]);

  const isDevPrivateHost = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.location.hostname.startsWith('ais-dev-');
  }, []);

  const isPublicShareLive = useMemo(() => {
    if (!isDevPrivateHost) return true;
    return Boolean(
      linkProbeStatus?.isShareReady && linkProbeStatus.effectiveBaseUrl
    );
  }, [isDevPrivateHost, linkProbeStatus]);

  // Guaranteed live URL (uses verified Cloud Run / Share URL when live, else current working origin — NEVER a dead 404 URL)
  const directTopLevelInstallUrl = useMemo(
    () => buildInstallShareUrl(linkProbeStatus),
    [linkProbeStatus]
  );

  // Android Intent URL strictly for breaking out of WhatsApp/Telegram/Instagram In-App WebViews to Google Chrome
  // Always targets the CURRENT working URL so it never hits 404.
  const chromeAndroidIntentUrl = useMemo(() => {
    if (
      typeof window === 'undefined' ||
      !isAndroid ||
      !isAndroidWebView ||
      isInIframe
    ) {
      return '';
    }
    try {
      const targetStr = appendCurrentParamsWithInstallFlag(window.location.href);
      const target = new URL(targetStr);
      const scheme = target.protocol.replace(':', '') || 'https';
      return `intent://${target.host}${target.pathname}${target.search}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(
        target.toString()
      )};end`;
    } catch {
      return '';
    }
  }, [isAndroid, isAndroidWebView, isInIframe]);

  return {
    isInstallable: Boolean(deferredPrompt || cachedDeferredPrompt),
    isInstalled,
    isInstalling,
    justInstalled,
    isIOS,
    isAndroid,
    isAndroidWebView,
    isInIframe,
    isDevPrivateHost,
    isPublicShareLive,
    isCheckingPublicLink,
    linkProbeStatus,
    recheckPublicLink,
    shareableInstallUrl: directTopLevelInstallUrl,
    directTopLevelInstallUrl,
    chromeAndroidIntentUrl,
    install,
  };
}
