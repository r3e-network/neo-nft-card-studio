import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { LayoutShell } from "./components/LayoutShell";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";

const HomePage = lazy(async () => {
  const module = await import("./pages/HomePage");
  return { default: module.HomePage };
});

const CreateCollectionPage = lazy(async () => {
  const module = await import("./pages/CreateCollectionPage");
  return { default: module.CreateCollectionPage };
});

const CollectionDetailPage = lazy(async () => {
  const module = await import("./pages/CollectionDetailPage");
  return { default: module.CollectionDetailPage };
});

const PortfolioPage = lazy(async () => {
  const module = await import("./pages/PortfolioPage");
  return { default: module.PortfolioPage };
});

const MintNftPage = lazy(async () => {
  const module = await import("./pages/MintNftPage");
  return { default: module.MintNftPage };
});

export function App() {
  const { t } = useTranslation();
  const routeErrorFallback = (
    <div className="stack-sm">
      <p className="error">{t("app.page_error")}</p>
      <button className="btn btn-secondary" type="button" onClick={() => window.location.reload()}>
        {t("app.reload")}
      </button>
    </div>
  );

  return (
    <LayoutShell>
      <RouteErrorBoundary fallback={routeErrorFallback}>
        <Suspense fallback={<p className="hint">{t("app.loading_page")}</p>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/collections/new" element={<CreateCollectionPage />} />
            <Route path="/collections/:collectionId" element={<CollectionDetailPage />} />
            <Route path="/mint" element={<MintNftPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </LayoutShell>
  );
}
