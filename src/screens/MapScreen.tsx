import { Compass, MapIcon } from "lucide-react";
import { BottomNavigation } from "../BottomNavigation";
import type { Navigate } from "../app-types";
import { Header } from "../ui/common";

export function MapScreen({ navigate, onBack }: { navigate: Navigate; onBack: () => void }) {
  return (
    <main className="screen-with-bottom-navigation">
      <Header navigate={navigate} onBack={onBack} title="Flockly" variant="root" />
      <section className="public-meetings-page map-page">
        <div className="page-intro public-meetings-intro">
          <h1>Карта</h1>
          <p>Места и открытые встречи вашего города.</p>
        </div>
        <section className="state-card map-soon">
          <span className="state-icon empty-state-icon"><MapIcon aria-hidden="true" size={32} /></span>
          <div className="state-copy">
            <strong>Карта скоро появится</strong>
            <p>Здесь будут заведения и открытые встречи рядом с вами. Пока открытые встречи можно посмотреть списком.</p>
            <button
              className="secondary-action compact-action"
              onClick={() => navigate("/open")}
              type="button"
            >
              <Compass aria-hidden="true" size={18} />
              Открытые встречи
            </button>
          </div>
        </section>
      </section>
      <BottomNavigation currentPath="/map" navigate={navigate} />
    </main>
  );
}
