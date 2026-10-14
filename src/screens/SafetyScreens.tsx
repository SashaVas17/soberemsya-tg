import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { COMMUNITY_RULES_TITLE, personName } from "../moderation";
import { haptic } from "../telegram";
import type { BlockedUser } from "../types";
import type { Navigate } from "../app-types";
import { EmptyState, Header, Loading, RetryState } from "../ui/common";
import { CommunityRulesList } from "../ui/Moderation";

export function BlockedUsersScreen({ navigate, onBack }: { navigate: Navigate; onBack: () => void }) {
  const [users, setUsers] = useState<BlockedUser[] | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError("");
    try {
      setUsers((await api.blockedUsers()).users);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить список.");
    }
  }, []);
  useEffect(() => void load(), [load]);
  const unblock = async (userId: string) => {
    if (unblockingId) return;
    setUnblockingId(userId);
    setActionError("");
    try {
      await api.unblockUser(userId);
      haptic();
      setUsers((current) => current?.filter((user) => user.userId !== userId) ?? current);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Не удалось разблокировать.");
      haptic("error");
    } finally {
      setUnblockingId(null);
    }
  };
  return (
    <main className="settings-screen">
      <Header navigate={navigate} onBack={onBack} title="Заблокированные" variant="nested" />
      <section className="settings-page blocked-users">
        <p className="settings-note">
          Вы не видите открытые встречи этих людей, а они — ваши. Их заявки на ваши встречи отклоняются.
        </p>
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
        {!users && !error && <Loading label="Загружаем…" />}
        {error && <RetryState message={error} onRetry={() => void load()} title="Список не загрузился" />}
        {users?.length === 0 && (
          <EmptyState text="Заблокировать человека можно на экране его встречи или заявки." title="Никого нет" />
        )}
        {users && users.length > 0 && (
          <ul className="panel blocked-user-list">
            {users.map((user) => (
              <li key={user.userId}>
                <span>{personName(user.name, user.username)}</span>
                <button
                  className="secondary-action compact-action"
                  disabled={unblockingId === user.userId}
                  onClick={() => void unblock(user.userId)}
                  type="button"
                >
                  {unblockingId === user.userId ? "Разблокируем…" : "Разблокировать"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export function CommunityRulesScreen({ navigate, onBack }: { navigate: Navigate; onBack: () => void }) {
  return (
    <main className="settings-screen">
      <Header navigate={navigate} onBack={onBack} title="Правила" variant="nested" />
      <section className="settings-page">
        <section className="panel community-rules-panel">
          <h2>{COMMUNITY_RULES_TITLE}</h2>
          <CommunityRulesList />
        </section>
      </section>
    </main>
  );
}
