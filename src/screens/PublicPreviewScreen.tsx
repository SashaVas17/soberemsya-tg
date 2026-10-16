import { CalendarDays, Users } from "lucide-react";
import { plural } from "../domain";
import { publicJoinRequestView } from "../join-request";
import type { PublicEventPreview } from "../types";
import type { Navigate } from "../app-types";
import { CategoryBadge, Header, ErrorNote, StatusBadge } from "../ui/common";
import { SafetyActions } from "../ui/Moderation";
import { t } from "../i18n";

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
      <Header navigate={navigate} onBack={onBack} title={t("Открытая встреча")} variant="nested" />
      <section className="public-preview-page">
        <div className="public-preview-heading">
          <div className="event-meta">
            <span className="visibility-badge">{t("Открытая")}</span>
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
              <span>{t("Когда")}</span>
              <strong>{preview.dateSummary ?? t("Дата пока не указана")}</strong>
            </div>
          </div>
          <div className="public-preview-row">
            <Users size={22} />
            <div>
              <span>{t("Участники")}</span>
              <strong>
                {preview.maxParticipants === null
                  ? plural(preview.participantCount, "участник", "участника", "участников")
                  : t("{count} из {max} участников", { count: preview.participantCount, max: preview.maxParticipants })}
              </strong>
            </div>
          </div>
          <div className="public-preview-budget">
            {preview.budgetLimit > 0
              ? t("Ориентир до {budget} BYN", { budget: preview.budgetLimit })
              : t("Бюджет не указан")}
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
              {joining ? t("Отправляем…") : requestView.actionLabel}
            </button>
          )}
          <ErrorNote message={error} />
        </section>
        <SafetyActions eventId={preview.id} onBlocked={() => navigate("/open")} />
      </section>
    </main>
  );
}
