import { CalendarDays, Users } from "lucide-react";
import { plural } from "../domain";
import { publicJoinRequestView } from "../join-request";
import type { PublicEventPreview } from "../types";
import type { Navigate } from "../app-types";
import { CategoryBadge, Header, ErrorNote, StatusBadge } from "../ui/common";
import { SafetyActions } from "../ui/Moderation";

export function PublicPreviewScreen({
  error,
  joining,
  navigate,
  onBack,
  onJoin,
  preview,
}: {
  error: string;
  joining: boolean;
  navigate: Navigate;
  onBack: () => void;
  onJoin: () => void;
  preview: PublicEventPreview;
}) {
  const requestView = publicJoinRequestView(
    preview.status,
    preview.joinRequestStatus,
  );
  return (
    <main className="public-preview-screen">
      <Header navigate={navigate} onBack={onBack} title="Открытая встреча" variant="nested" />
      <section className="public-preview-page">
        <div className="public-preview-heading">
          <div className="event-meta">
            <span className="visibility-badge">Открытая</span>
            <StatusBadge status={preview.status} />
            {preview.category && <CategoryBadge category={preview.category} />}
          </div>
          <h1>{preview.title}</h1>
          {preview.description && <p>{preview.description}</p>}
        </div>
        <section className="panel public-preview-details">
          <div className="public-preview-row">
            <CalendarDays size={22} />
            <div>
              <span>Когда</span>
              <strong>{preview.dateSummary ?? "Дата пока не указана"}</strong>
            </div>
          </div>
          <div className="public-preview-row">
            <Users size={22} />
            <div>
              <span>Участники</span>
              <strong>
                {preview.maxParticipants === null
                  ? plural(preview.participantCount, "участник", "участника", "участников")
                  : `${preview.participantCount} из ${preview.maxParticipants} участников`}
              </strong>
            </div>
          </div>
          <div className="public-preview-budget">
            {preview.budgetLimit > 0
              ? `Ориентир до ${preview.budgetLimit} BYN`
              : "Бюджет не указан"}
          </div>
        </section>
        <section className="public-preview-request">
          <div className="public-preview-notice">
            <strong>{requestView.message}</strong>
            {requestView.supportingText && <span>{requestView.supportingText}</span>}
          </div>
          {requestView.actionLabel && (
            <button
              className="primary-action public-preview-join-action"
              disabled={joining}
              onClick={onJoin}
              type="button"
            >
              {joining ? "Отправляем…" : requestView.actionLabel}
            </button>
          )}
          <ErrorNote message={error} />
        </section>
        <SafetyActions eventId={preview.id} onBlocked={() => navigate("/open")} />
      </section>
    </main>
  );
}
