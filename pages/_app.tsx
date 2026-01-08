// pages/_app.tsx
import type { AppProps } from "next/app";
import { useEffect } from "react";
import { useRouter } from "next/router";

const PIN_STORAGE_KEY = "vtpt_pin";

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!router.isReady) return;

    // don't block the unlock page
    if (router.pathname === "/unlock") return;

    const pin = (sessionStorage.getItem(PIN_STORAGE_KEY) || "").trim();
    if (!pin) {
      const next = router.asPath || "/";
      router.replace(`/unlock?next=${encodeURIComponent(next)}`);
    }
  }, [router.isReady, router.pathname, router.asPath, router]);

  return <Component {...pageProps} />;
}
