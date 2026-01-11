"use client";

require("../polyfill");

import { useEffect, useState } from "react";
import styles from "./home.module.scss";

import BotIcon from "../icons/bot.svg";
import LoadingIcon from "../icons/three-dots.svg";

import { getCSSVar, useMobileScreen } from "../utils";

import dynamic from "next/dynamic";
import { Path, SlotID } from "../constant";
import { ErrorBoundary } from "./error";

import { getISOLang, getLang } from "../locales";

import {
  HashRouter as Router,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { SideBar } from "./sidebar";
import { useAppConfig } from "../store/config";
import { AuthPage } from "./auth";
import { getClientConfig } from "../config/client";
import { type ClientApi, getClientApi } from "../client/api";
import { useAccessStore } from "../store";
import clsx from "clsx";

export function Loading(props: { noLogo?: boolean }) {
  return (
    <div className={clsx("no-dark", styles["loading-content"])}>
      {!props.noLogo && <BotIcon />}
      <LoadingIcon />
    </div>
  );
}

const Settings = dynamic(async () => (await import("./settings")).Settings, {
  loading: () => <Loading noLogo />,
});

const Arena = dynamic(async () => (await import("./arena")).Arena, {
  loading: () => <Loading noLogo />,
});

const ArenaAdmin = dynamic(
  async () => (await import("./arena-admin")).ArenaAdmin,
  {
    loading: () => <Loading noLogo />,
  },
);

// Keep Masks for system prompt selection in Arena
const MaskPage = dynamic(async () => (await import("./mask")).MaskPage, {
  loading: () => <Loading noLogo />,
});

export function useSwitchTheme() {
  const config = useAppConfig();

  useEffect(() => {
    document.body.classList.remove("light");
    document.body.classList.remove("dark");

    if (config.theme === "dark") {
      document.body.classList.add("dark");
    } else if (config.theme === "light") {
      document.body.classList.add("light");
    }

    const metaDescriptionDark = document.querySelector(
      'meta[name="theme-color"][media*="dark"]',
    );
    const metaDescriptionLight = document.querySelector(
      'meta[name="theme-color"][media*="light"]',
    );

    if (config.theme === "auto") {
      metaDescriptionDark?.setAttribute("content", "#151515");
      metaDescriptionLight?.setAttribute("content", "#fafafa");
    } else {
      const themeColor = getCSSVar("--theme-color");
      metaDescriptionDark?.setAttribute("content", themeColor);
      metaDescriptionLight?.setAttribute("content", themeColor);
    }
  }, [config.theme]);
}

function useHtmlLang() {
  useEffect(() => {
    const lang = getISOLang();
    const htmlLang = document.documentElement.lang;

    if (lang !== htmlLang) {
      document.documentElement.lang = lang;
    }
  }, []);
}

const useHasHydrated = () => {
  const [hasHydrated, setHasHydrated] = useState<boolean>(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  return hasHydrated;
};

const loadAsyncGoogleFont = () => {
  const linkEl = document.createElement("link");
  const proxyFontUrl = "/google-fonts";
  const remoteFontUrl = "https://fonts.googleapis.com";
  const googleFontUrl =
    getClientConfig()?.buildMode === "export" ? remoteFontUrl : proxyFontUrl;
  linkEl.rel = "stylesheet";
  linkEl.href =
    googleFontUrl +
    "/css2?family=" +
    encodeURIComponent("Noto Sans:wght@300;400;700;900") +
    "&display=swap";
  document.head.appendChild(linkEl);
};

export function WindowContent(props: {
  children: React.ReactNode;
  fullscreen?: boolean;
}) {
  return (
    <div
      className={clsx(styles["window-content"], {
        [styles["window-content-fullscreen"]]: props.fullscreen,
      })}
      id={SlotID.AppBody}
    >
      {props?.children}
    </div>
  );
}

function Screen() {
  const config = useAppConfig();
  const location = useLocation();
  const isAuth = location.pathname === Path.Auth;

  // Check if current route should be fullscreen (no sidebar)
  const isFullscreenRoute =
    location.pathname === Path.Home ||
    location.pathname === Path.Arena ||
    location.pathname === Path.ArenaAdmin;

  const isMobileScreen = useMobileScreen();
  const shouldTightBorder =
    getClientConfig()?.isApp || (config.tightBorder && !isMobileScreen);

  useEffect(() => {
    loadAsyncGoogleFont();
  }, []);

  const renderContent = () => {
    if (isAuth) return <AuthPage />;

    // For fullscreen routes (Arena), don't show sidebar
    if (isFullscreenRoute) {
      return (
        <WindowContent fullscreen>
          <Routes>
            <Route path={Path.Home} element={<Arena />} />
            <Route path={Path.Arena} element={<Arena />} />
            <Route path={Path.ArenaAdmin} element={<ArenaAdmin />} />
            <Route path={Path.Settings} element={<Settings />} />
            <Route path={Path.Masks} element={<MaskPage />} />
          </Routes>
        </WindowContent>
      );
    }

    // For other routes, show sidebar
    return (
      <>
        <SideBar className={styles["sidebar-show"]} />
        <WindowContent>
          <Routes>
            <Route path={Path.Home} element={<Arena />} />
            <Route path={Path.Arena} element={<Arena />} />
            <Route path={Path.ArenaAdmin} element={<ArenaAdmin />} />
            <Route path={Path.Settings} element={<Settings />} />
            <Route path={Path.Masks} element={<MaskPage />} />
          </Routes>
        </WindowContent>
      </>
    );
  };

  return (
    <div
      className={clsx(styles.container, {
        [styles["tight-container"]]: shouldTightBorder,
        [styles["fullscreen-container"]]: isFullscreenRoute,
        [styles["rtl-screen"]]: getLang() === "ar",
      })}
    >
      {renderContent()}
    </div>
  );
}

export function useLoadData() {
  const config = useAppConfig();

  const api: ClientApi = getClientApi(config.modelConfig.providerName);

  useEffect(() => {
    (async () => {
      const models = await api.llm.models();
      config.mergeModels(models);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function Home() {
  useSwitchTheme();
  useLoadData();
  useHtmlLang();

  useEffect(() => {
    useAccessStore.getState().fetch();

    // Silent backup check (no logs)
    try {
      const { useArenaStore } = require("../store/arena");
      useArenaStore.getState().checkAndPerformBackup();
    } catch {
      // Silent fail
    }
  }, []);

  if (!useHasHydrated()) {
    return <Loading />;
  }

  return (
    <ErrorBoundary>
      <Router>
        <Screen />
      </Router>
    </ErrorBoundary>
  );
}
