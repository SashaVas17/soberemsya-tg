import { useRef, useState } from "react";
import { api } from "../api";
import { canLeaveMeeting, leaveMeetingOnce } from "../leave-meeting";
import { haptic } from "../telegram";
import type { EventData } from "../types";
import type { Navigate } from "../app-types";
import { t } from "../i18n";

export function LeaveMeetingAction({
  event,
  eventId,
  navigate,
}: {
  event: EventData;
  eventId: string;
  navigate: Navigate;
}) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const leaveLock = useRef(false);
  if (!canLeaveMeeting(event)) return null;
  const leave = async () => {
    if (leaving || leaveLock.current) return;
    if (
      !window.confirm(
        t("Покинуть встречу?\nВаше участие и голоса будут удалены."),
      )
    )
      return;
    setError("");
    setLeaving(true);
    try {
      const result = await leaveMeetingOnce(
        eventId,
        leaveLock,
        api.leaveParticipation,
      );
      if (!result || !result.left) throw new Error("Leave request failed");
      haptic();
      navigate("/my-events");
    } catch {
      setError(t("Не удалось покинуть встречу. Попробуйте ещё раз."));
      haptic("error");
    } finally {
      setLeaving(false);
    }
  };
  return (
    <div className="leave-meeting-action">
      <button
        className="quiet-danger-action"
        disabled={leaving}
        onClick={() => void leave()}
        type="button"
      >
        {leaving ? t("Выходим…") : t("Покинуть встречу")}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
