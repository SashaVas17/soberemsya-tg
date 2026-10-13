import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { mergeMeetingItems } from "../my-meetings";
import { BottomNavigation } from "../BottomNavigation";
import type { MeetingListItem } from "../types";
import type { Navigate } from "../app-types";
import { Header, Loading, RetryState, MeetingGroup } from "../ui/common";

export function MyEvents({ navigate, onBack }: { navigate: Navigate; onBack: () => void }) {
  type MeetingPageState = {
    items: MeetingListItem[];
    nextCursor: string | null;
    initialized: boolean;
    loading: boolean;
    loadingMore: boolean;
    error: string;
  };
  const emptyPage = (): MeetingPageState => ({
    items: [],
    nextCursor: null,
    initialized: false,
    loading: false,
    loadingMore: false,
    error: "",
  });
  const [pages, setPages] = useState<Record<MeetingListItem["role"], MeetingPageState>>({
    owner: emptyPage(),
    participant: emptyPage(),
  });
  const [selectedRole, setSelectedRole] = useState<MeetingListItem["role"]>(
    "owner",
  );
  const load = useCallback(async (role: MeetingListItem["role"], cursor?: string) => {
    const loadingMore = Boolean(cursor);
    setPages((current) => ({
      ...current,
      [role]: {
        ...current[role],
        loading: !loadingMore,
        loadingMore,
        error: "",
      },
    }));
    try {
      const result = await api.meetingsPage(role, cursor);
      setPages((current) => ({
        ...current,
        [role]: {
          ...current[role],
          items: loadingMore
            ? mergeMeetingItems(current[role].items, result.items)
            : mergeMeetingItems([], result.items),
          nextCursor: result.nextCursor,
          initialized: true,
          loading: false,
          loadingMore: false,
          error: "",
        },
      }));
    } catch (reason) {
      setPages((current) => ({
        ...current,
        [role]: {
          ...current[role],
          initialized: current[role].initialized,
          loading: false,
          loadingMore: false,
          error:
            reason instanceof Error
              ? reason.message
              : "Не удалось загрузить встречи.",
        },
      }));
    }
  }, []);
  useEffect(() => {
    void load("owner");
  }, [load]);
  const selectedPage = pages[selectedRole];
  const selectRole = (role: MeetingListItem["role"]) => {
    setSelectedRole(role);
    if (!pages[role].initialized && !pages[role].loading)
      void load(role);
  };
  return (
    <main className="screen-with-bottom-navigation">
      <Header navigate={navigate} onBack={onBack} title="Соберёмся" variant="root" />
      <section className="my-meetings-page">
        <h1>Мои встречи</h1>
        <div aria-label="Тип встреч" className="meeting-segments" role="tablist">
          <button
            aria-selected={selectedRole === "owner"}
            className={selectedRole === "owner" ? "selected" : ""}
            onClick={() => selectRole("owner")}
            role="tab"
            type="button"
          >
            Организую
          </button>
          <button
            aria-selected={selectedRole === "participant"}
            className={selectedRole === "participant" ? "selected" : ""}
            onClick={() => selectRole("participant")}
            role="tab"
            type="button"
          >
            Участвую
          </button>
        </div>
        {selectedPage.loading && !selectedPage.items.length && <Loading />}
        {selectedPage.error && !selectedPage.items.length && (
          <RetryState
            message={selectedPage.error}
            onRetry={() => void load(selectedRole)}
            title="Не удалось загрузить список"
          />
        )}
        {selectedPage.initialized && (
          <MeetingGroup
            emptyText={
              selectedRole === "owner"
                ? "Создайте встречу и пригласите участников."
                : "Здесь появятся встречи, в которых вы участвуете."
            }
            items={selectedPage.items}
            navigate={navigate}
            showAction
          />
        )}
        {selectedPage.error && selectedPage.items.length > 0 && (
          <div className="my-meetings-pagination-error" role="alert">
            <span>{selectedPage.error}</span>
            <button
              className="secondary-action compact-action"
              onClick={() => void load(selectedRole, selectedPage.nextCursor ?? undefined)}
              type="button"
            >
              Повторить
            </button>
          </div>
        )}
        {selectedPage.nextCursor && !selectedPage.error && (
          <button
            className="secondary-action my-meetings-load-more"
            disabled={selectedPage.loadingMore}
            onClick={() => void load(selectedRole, selectedPage.nextCursor!)}
            type="button"
          >
            {selectedPage.loadingMore ? "Загружаем…" : "Загрузить ещё"}
          </button>
        )}
      </section>
      <BottomNavigation currentPath="/my-events" navigate={navigate} />
    </main>
  );
}
