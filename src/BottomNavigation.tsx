import { CalendarDays, Compass, House } from "lucide-react";
import {
  bottomNavigationItems,
  isBottomNavigationSelected,
  navigateToBottomItem,
} from "./navigation";

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
        {bottomNavigationItems.map((item) => {
          const selected = isBottomNavigationSelected(currentPath, item.path);
          const Icon =
            item.id === "home" ? House : item.id === "open" ? Compass : CalendarDays;
          return (
            <button
              aria-current={selected ? "page" : undefined}
              className={`bottom-navigation-item ${selected ? "selected" : ""}`}
              key={item.id}
              onClick={() => navigateToBottomItem(item.path, navigate)}
              type="button"
            >
              <Icon aria-hidden="true" size={23} strokeWidth={2} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
