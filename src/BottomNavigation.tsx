import { Fragment } from "react";
import { CalendarDays, Compass, House, MapIcon, Plus } from "lucide-react";
import {
  bottomNavigationItems,
  isBottomNavigationSelected,
  navigateToBottomItem,
} from "./navigation";

const navigationIcons = {
  home: House,
  open: Compass,
  map: MapIcon,
  meetings: CalendarDays,
} as const;

export function BottomNavigation({
  currentPath,
  navigate,
}: {
  currentPath: string;
  navigate: (path: string) => void;
}) {
  return (
    <nav aria-label="Основная навигация" className="bottom-navigation">
      <div className="bottom-navigation-inner">
        {bottomNavigationItems.map((item, index) => {
          const selected = isBottomNavigationSelected(currentPath, item.path);
          const Icon = navigationIcons[item.id];
          return (
            <Fragment key={item.id}>
              {index === 2 && (
                <button
                  aria-label="Новая встреча"
                  className="bottom-navigation-create"
                  onClick={() => navigate("/create")}
                  type="button"
                >
                  <Plus aria-hidden="true" size={24} strokeWidth={2.2} />
                </button>
              )}
              <button
                aria-current={selected ? "page" : undefined}
                aria-label={item.label === item.shortLabel ? undefined : item.label}
                className={`bottom-navigation-item ${selected ? "selected" : ""}`}
                onClick={() => navigateToBottomItem(item.path, navigate)}
                type="button"
              >
                <Icon aria-hidden="true" size={22} strokeWidth={2} />
                <span>{item.shortLabel}</span>
              </button>
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}
