export type MeetingVisibility = "private" | "public";

export type CreateMeetingMode = {
  visibility: MeetingVisibility;
  maxParticipants: number | null;
};

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

export function parseCreateMeetingMode(
  payload: Record<string, unknown>,
): CreateMeetingMode {
  const visibility = payload.visibility === undefined ? "private" : payload.visibility;
  if (visibility !== "private" && visibility !== "public")
    invalid("Некорректный тип встречи.");

  const maxParticipants =
    payload.maxParticipants === undefined ? null : payload.maxParticipants;

  if (visibility === "private") {
    if (maxParticipants !== null)
      invalid("Для встречи по приглашению нельзя указывать лимит участников.");
    return { visibility, maxParticipants: null };
  }

  if (maxParticipants === null) return { visibility, maxParticipants: null };
  if (
    typeof maxParticipants !== "number" ||
    !Number.isFinite(maxParticipants) ||
    !Number.isInteger(maxParticipants) ||
    maxParticipants < 2 ||
    maxParticipants > 50
  )
    invalid("Лимит участников должен быть целым числом от 2 до 50.");

  return { visibility, maxParticipants };
}
