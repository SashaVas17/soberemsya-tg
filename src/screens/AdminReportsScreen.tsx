import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { personName, reportReasonLabel } from "../moderation";
import { haptic } from "../telegram";
import type { AdminReport, ReportStatus } from "../types";
import type { Navigate } from "../app-types";
import { EmptyState, Header, Loading, RetryState } from "../ui/common";

const statusTabs: { id: ReportStatus; label: string }[] = [
  { id: "open", label: "Новые" },
  { id: "resolved", label: "Решённые" },
  { id: "dismissed", label: "Отклонённые" },
];

const reportTime = new Intl.DateTimeFormat("ru-RU", {
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
        <strong>{report.targetType === "event" ? "Встреча" : "Пользователь"} · {reportReasonLabel(report.reason)}</strong>
        <time dateTime={report.createdAt}>{reportTime.format(new Date(report.createdAt))}</time>
      </div>
      {event && (
        <p>
          Встреча: «{event.title}»
          {event.deleted ? " — удалена" : event.hidden ? " — скрыта из ленты" : ""}
        </p>
      )}
      {targetUser && (
        <p>
          {report.targetType === "event" ? "Организатор" : "Нарушитель"}: {personName(targetUser.name, targetUser.username)}
          {targetUser.banned ? " — ограничен" : ""}
        </p>
      )}
      {report.comment && <p className="admin-report-comment">«{report.comment}»</p>}
      <p className="admin-report-meta">
        Пожаловался(-ась): {personName(report.reporter.name, report.reporter.username)}
        {report.openReportsOnTarget > 1 ? ` · новых жалоб на это: ${report.openReportsOnTarget}` : ""}
      </p>
      <div className="admin-report-actions">
        {event && !event.deleted && (
          <button
            className={event.hidden ? "secondary-action compact-action" : "danger-button compact-action"}
            disabled={busy}
            onClick={() => onAction(() => api.adminSetEventHidden(event.id, !event.hidden))}
            type="button"
          >
            {event.hidden ? "Вернуть в ленту" : "Скрыть встречу"}
          </button>
        )}
        {targetUser && (
          <button
            className={targetUser.banned ? "secondary-action compact-action" : "danger-button compact-action"}
            disabled={busy}
            onClick={() => {
              if (
                targetUser.banned ||
                window.confirm("Ограничить пользователя? Он не сможет создавать открытые встречи и подавать заявки, его открытые встречи скроются из ленты.")
              )
                onAction(() => api.adminSetUserBanned(targetUser.id, !targetUser.banned));
            }}
            type="button"
          >
            {targetUser.banned ? "Снять ограничение" : "Ограничить"}
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
              Решено
            </button>
            <button
              className="secondary-action compact-action"
              disabled={busy}
              onClick={() => onAction(() => api.adminResolveReport(report.id, "dismiss"))}
              type="button"
            >
              Отклонить
            </button>
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
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить жалобы.");
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
      setActionError(reason instanceof Error ? reason.message : "Не удалось выполнить действие.");
      haptic("error");
    } finally {
      setBusyId(null);
    }
  };
  return (
    <main className="settings-screen">
      <Header navigate={navigate} onBack={onBack} title="Жалобы" variant="nested" />
      <section className="settings-page admin-reports">
        <div aria-label="Статус жалоб" className="meeting-segments admin-report-tabs" role="tablist">
          {statusTabs.map((tab) => (
            <button
              aria-selected={status === tab.id}
              className={status === tab.id ? "selected" : ""}
              key={tab.id}
              onClick={() => setStatus(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
        {!reports && !error && <Loading label="Загружаем жалобы…" />}
        {error && <RetryState message={error} onRetry={() => void load()} title="Жалобы не загрузились" />}
        {reports?.length === 0 && (
          <EmptyState
            text={status === "open" ? "Когда кто-то пожалуется, вы получите сообщение от бота." : "Здесь пока пусто."}
            title={status === "open" ? "Новых жалоб нет" : "Жалоб нет"}
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
