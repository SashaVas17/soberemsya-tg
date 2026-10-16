import {
  Clapperboard,
  Coffee,
  Dices,
  Dumbbell,
  Footprints,
  Mountain,
  Music,
  Sparkles,
  Tag,
  UtensilsCrossed,
  Wine,
  type LucideIcon,
} from "lucide-react";

// Names and order come from the server (meeting_categories); the app only
// picks an icon. A category added later shows the generic tag icon.
const categoryIcons: Record<string, LucideIcon> = {
  coffee: Coffee,
  food: UtensilsCrossed,
  bar: Wine,
  sport: Dumbbell,
  boardgames: Dices,
  walk: Footprints,
  cinema: Clapperboard,
  concert: Music,
  outdoor: Mountain,
  other: Sparkles,
};

export function categoryIcon(categoryId: string): LucideIcon {
  return categoryIcons[categoryId] ?? Tag;
}
