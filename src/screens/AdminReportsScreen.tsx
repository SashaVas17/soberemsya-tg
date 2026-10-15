import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { personName, reportReasonLabel } from "../moderation";
import { haptic } from "../telegram";
import type { AdminReport, ReportStatus } from "../types";
import type { Navigate } from "../app-types";
import { EmptyState, Header, Loading, RetryState } from "../ui/common";
import { locale, t } from "../i18n";

const statusTabs: { id: ReportStatus; label: string }[] = [
  { id: "open", label: "Новые" },
  { id: "resolved", label: "Решённые" },
  { id: "dismissed", label: "Отклонённые" },
];

const reportTime = () => new Intl.DateTimeFormat(locale(), {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function ReportCard({
  busy,
  onAction,
  report,
}: {
  busy: boolean;
  onAction: (action: () => Promise<unknown>) => void;
  report: AdminReport;
}) {
  const { event, targetUser } = report;
  const open = report.status === "open";
  return (
    <article className="panel admin-report-card" aria-busy={busy}>
      <div className="admin-report-heading">
        <strong>{report.targetType === "event" ? t("Встреча") : t("Пользователь")} · {reportReasonLabel(report.reason)}</strong>
        <time dateTime={report.createdAt}>{reportTime().format(new Date(report.createdAt))}</time>
      </div>
      {event && (
        <p>
          {t("Встреча: «")}{event.title}»
          {event.deleted ? t(" — удалена") : event.hidden ? t(" — скрыта из ленты") : ""}
        </p>
      )}
      {targetUser && (
        <p>
          {report.targetType === "event" ? t("Организатор") : t("Нарушитель")}: {personName(targetUser.name, targetUser.username)}
          {targetUser.banned ? t(" — ограничен") : ""}
        </p>
      )}
      {report.comment && <p className="admin-report-comment">«{report.comment}»</p>}
      <p className="admin-report-meta">
        {t("Пожаловался(-ась):")} {personName(report.reporter.name, report.reporter.username)}
        {report.openReportsOnTarget > 1 ? t(" · новых жалоб на это: {count}", { count: report.openReportsOnTarget }) : ""}
      </p>
      <div className="admin-report-actions">
        {event && !event.deleted && (
          <button
            className={event.hidden ? "secondary-action compact-action" : "danger-button compact-action"}
            disabled={busy}
            onClick={() => onAction(() => api.adminSetEventHidden(event.id, !event.hidden))}
            type="button"
          >
            {event.hidden ? t("Вернуть в ленту") : t("Скрыть встречу")}
          </button>
        )}
        {targetUser && (
          <button
            className={targetUser.banned ? "secondary-action compact-action" : "danger-button compact-action"}
            disabled={busy}
            onClick={() => {
              if (
                targetUser.banned ||
                window.confirm(t("Ограничить пользователя? Он не сможет создавать открытые встречи и подавать заявки, его открытые встречи скроются из ленты."))
              )
                onAction(() => api.adminSetUserBanned(targetUser.id, !targetUser.banned));
            }}
            type="button"
          >
            {targetUser.banned ? t("Снять ограничение") : t("Ограничить")}
          </button>
        )}
        {open && (
          <>
            <button
              className="secondary-action compact-action"
              disabled={busy}
              onClick={() => onAction(() => api.adminResolveReport(report.id, "resolve"))}
              type="button"
            >
              {t("Решено")}</button>
            <button
              className="secondary-action compact-action"
              disabled={busy}
              onClick={() => onAction(() => api.adminResolveReport(report.id, "dismiss"))}
              type="button"
            >
              {t("Отклонить")}</button>
          </>
        )}
      </div>
    </article>
  );
}

// Visible only to administrators: the API answers 404 to everyone else.
export function AdminReportsScreen({ navigate, onBack }: { navigate: Navigate; onBack: () => void }) {
  const [status, setStatus] = useState<ReportStatus>("open");
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Only the latest request may fill the list: a late answer for the previous
  // tab must not land under the new one.
  const latestRequest = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setError("");
    try {
      const { reports: loaded } = await api.adminReports(status);
      if (requestId === latestRequest.current) setReports(loaded);
    } catch (reason) {
      if (requestId === latestRequest.current)
        setError(reason instanceof Error ? reason.message : t("Не удалось загрузить жалобы."));
    }
  }, [status]);
  useEffect(() => {
    setReports(null);
    void load();
  }, [load]);
  const act = async (reportId: string, action: () => Promise<unknown>) => {
    if (busyId) return;
    setBusyId(reportId);
    setActionError("");
    try {
      await action();
      haptic();
      await load();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : t("Не удалось выполнить действие."));
      haptic("error");
    } finally {
      setBusyId(null);
    }
  };
  return (
    <main className="settings-screen">
      <Header navigate={navigate} onBack={onBack} title={t("Жалобы")} variant="nested" />
      <section className="settings-page admin-reports">
        <div aria-label={t("Статус жалоб")} className="meeting-segments admin-report-tabs" role="tablist">
          {statusTabs.map((tab) => (
            <button
              aria-selected={status === tab.id}
              className={status === tab.id ? "selected" : ""}
              key={tab.id}
              onClick={() => setStatus(tab.id)}
              role="tab"
              type="button"
            >
              {t(tab.label)}
            </button>
          ))}
        </div>
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
        {!reports && !error && <Loading label={t("Загружаем жалобы…")} />}
        {error && <RetryState message={error} onRetry={() => void load()} title={t("Жалобы не загрузились")} />}
        {reports?.length === 0 && (
          <EmptyState
            text={status === "open" ? t("Когда кто-то пожалуется, вы получите сообщение от бота.") : t("Здесь пока пусто.")}
            title={status === "open" ? t("Новых жалоб нет") : t("Жалоб нет")}
          />
        )}
        {reports?.map((report) => (
          <ReportCard
            busy={busyId === report.id}
            key={report.id}
            onAction={(action) => void act(report.id, action)}
            report={report}
          />
        ))}
      </section>
    </main>
  );
}
