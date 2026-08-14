import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Users } from "lucide-react";
import { api } from "./api";
import {
  formatJoinRequestCreatedAt,
  formatJoinRequestUsername,
  joinRequestActionErrorMessage,
  removePendingJoinRequest,
  runOrganizerRequestActionOnce,
  shouldReloadJoinRequests,
  type OrganizerRequestActionLock,
} from "./organizer-request-ui";
import type { OrganizerJoinRequest } from "./types";

type OrganizerJoinRequestsProps = {
  eventId: string;
  onApproved: () => Promise<void> | void;
};

export function OrganizerJoinRequests({
  eventId,
  onApproved,
}: OrganizerJoinRequestsProps) {
  const [requests, setRequests] = useState<OrganizerJoinRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [actingRequestIds, setActingRequestIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const loadLock = useRef(false);
  const actionLocks = useRef<Set<string>>(new Set()) as OrganizerRequestActionLock;

  const load = useCallback(async () => {
    if (loadLock.current) return;
    loadLock.current = true;
    setLoading(true);
    try {
      const result = await api.joinRequests(eventId);
      setRequests(result.requests);
      setListError(false);
    } catch (error) {
      console.error("organizer_join_requests_load_failed", error);
      setListError(true);
    } finally {
      loadLock.current = false;
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (requestId: string, action: "approve" | "reject") => {
    if (actionLocks.current.has(requestId)) return;
    setActingRequestIds((current) => new Set(current).add(requestId));
    setActionErrors((current) => {
      const next = { ...current };
      delete next[requestId];
      return next;
    });
    try {
      const result = await runOrganizerRequestActionOnce(
        actionLocks,
        requestId,
        () =>
          action === "approve"
            ? api.approveJoinRequest(eventId, requestId)
            : api.rejectJoinRequest(eventId, requestId),
      );
      if (!result) return;
      setRequests((current) =>
        current ? removePendingJoinRequest(current, requestId) : current,
      );
      if (action === "approve") void onApproved();
    } catch (error) {
      console.error(`organizer_join_request_${action}_failed`, error);
      if (shouldReloadJoinRequests(error)) {
        await load();
      } else {
        setActionErrors((current) => ({
          ...current,
          [requestId]: joinRequestActionErrorMessage(error),
        }));
      }
    } finally {
      setActingRequestIds((current) => {
        const next = new Set(current);
        next.delete(requestId);
        return next;
      });
    }
  };

  return (
    <section className="panel manage-card join-requests-card">
      <h2>
        <Users size={24} /> Заявки
      </h2>
      {loading && requests === null && (
        <p className="join-requests-state" role="status">
          Загружаем заявки…
        </p>
      )}
      {listError && (
        <div className="join-requests-load-error" role="alert">
          <span>Не удалось загрузить заявки</span>
          <button
            className="secondary-action compact-action"
            disabled={loading}
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw className={loading ? "spin" : ""} size={16} />
            Повторить
          </button>
        </div>
      )}
      {!listError && requests?.length === 0 && (
        <p className="join-requests-state">Новых заявок нет</p>
      )}
      {requests && requests.length > 0 && (
        <div className="join-request-list">
          {requests.map((request) => {
            const acting = actingRequestIds.has(request.requestId);
            const username = formatJoinRequestUsername(
              request.requester.username,
            );
            return (
              <article
                aria-busy={acting}
                className="join-request-card"
                key={request.requestId}
              >
                <div className="join-request-identity">
                  <strong>{request.requester.displayName}</strong>
                  {username && <span>{username}</span>}
                  <time dateTime={request.createdAt}>
                    {formatJoinRequestCreatedAt(request.createdAt)}
                  </time>
                </div>
                <div className="join-request-actions">
                  <button
                    className="primary-action"
                    disabled={acting}
                    onClick={() => void act(request.requestId, "approve")}
                    type="button"
                  >
                    {acting ? "Обработка…" : "Одобрить"}
                  </button>
                  <button
                    className="secondary-action"
                    disabled={acting}
                    onClick={() => void act(request.requestId, "reject")}
                    type="button"
                  >
                    Отклонить
                  </button>
                </div>
                {actionErrors[request.requestId] && (
                  <p className="join-request-action-error" role="alert">
                    {actionErrors[request.requestId]}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
