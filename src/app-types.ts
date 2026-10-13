import type { PlaceDraft } from "./create-wizard";

export type Navigate = (path: string, replace?: boolean) => void;

export type EditablePlaceDraft = Omit<PlaceDraft, "estimatedBudget"> & {
  estimatedBudget: string;
};

export type CreatedGroup = { chatTitle: string; attached: boolean };
