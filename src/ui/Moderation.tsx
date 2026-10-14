import { type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, Flag } from "lucide-react";
import { api } from "../api";
import {
  COMMUNITY_RULES,
  COMMUNITY_RULES_TITLE,
  REPORT_COMMENT_MAX_LENGTH,
  REPORT_REASONS,
  type ModerationTarget,
  type ReportReason,
} from "../moderation";
import { haptic } from "../telegram";

function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

// Rendered into <body>: glass panels use backdrop-filter, which would make
// them the containing block of a fixed overlay and clip it.
function Dialog({
  children,
  labelledBy,
}: {
  children: ReactNode;
  labelledBy: string;
}) {
  return createPortal(
    <div className="participant-remove-backdrop moderation-backdrop" role="presentation">
      <section
        aria-labelledby={labelledBy}
        aria-modal="true"
        className="participant-remove-dialog moderation-dialog"
        role="dialog"
      >
        {children}
      </section>
    </div>,
    document.body,
  );
}

function ReportDialog({
  eventId,
  onClose,
  subject,
  target,
}: {
  eventId: string;
  onClose: () => void;
  subject: string;
  target: ModerationTarget;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<"created" | "existing" | null>(null);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const submit = async () => {
    if (!reason || lock.current) return;
    lock.current = true;
    setSending(true);
    setError("");
    try {
      const result = await api.reportEvent(eventId, target, { reason, comment: comment.trim() });
      setSent(result.alreadyReported ? "existing" : "created");
      haptic();
    } catch (reasonError) {
      setError(errorText(reasonError, "Не удалось отправить жалобу. Попробуйте ещё раз."));
      haptic("error");
    } finally {
      lock.current = false;
      setSending(false);
    }
  };
  if (sent)
    return (
      <Dialog labelledBy="report-dialog-title">
        <h2 id="report-dialog-title">
          {sent === "existing" ? "Жалоба уже отправлена" : "Жалоба отправлена"}
        </h2>
        <p>Администратор рассмотрит её. Чтобы больше не видеть встречи этого человека, заблокируйте его.</p>
        <button className="primary-action" onClick={onClose} type="button">
          Понятно
        </button>
      </Dialog>
    );
  return (
    <Dialog labelledBy="report-dialog-title">
      <h2 id="report-dialog-title">Пожаловаться</h2>
      <p>{subject}. Жалобу видит только администратор.</p>
      <fieldset className="report-reasons">
        <legend>Причина</legend>
        {REPORT_REASONS.map((item) => (
          <label className="report-reason" key={item.id}>
            <input
              checked={reason === item.id}
              name="report-reason"
              onChange={() => setReason(item.id)}
              type="radio"
            />
            <span>{item.label}</span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>Комментарий, если нужно</span>
        <textarea
          maxLength={REPORT_COMMENT_MAX_LENGTH}
          onChange={(input) => setComment(input.target.value)}
          rows={3}
          value={comment}
        />
      </label>
      {error && (
        <p className="participant-remove-error" role="alert">
          {error}
        </p>
      )}
      <div className="participant-remove-actions">
        <button className="secondary-action" disabled={sending} onClick={onClose} type="button">
          Отмена
        </button>
        <button
          className="danger-button"
          disabled={sending || !reason}
          onClick={() => void submit()}
          type="button"
        >
          {sending ? "Отправляем…" : "Отправить"}
        </button>
      </div>
    </Dialog>
  );
}

function BlockDialog({
  eventId,
  onBlocked,
  onClose,
  personLabel,
  target,
}: {
  eventId: string;
  onBlocked?: () => void;
  onClose: () => void;
  personLabel: string;
  target: ModerationTarget;
}) {
  const [blocking, setBlocking] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const block = async () => {
    if (lock.current) return;
    lock.current = true;
    setBlocking(true);
    setError("");
    try {
      await api.blockFromEvent(eventId, target);
      haptic();
      onClose();
      onBlocked?.();
    } catch (reason) {
      setError(errorText(reason, "Не удалось заблокировать. Попробуйте ещё раз."));
      haptic("error");
    } finally {
      lock.current = false;
      setBlocking(false);
    }
  };
  return (
    <Dialog labelledBy="block-dialog-title">
      <h2 id="block-dialog-title">Заблокировать {personLabel}?</h2>
      <p>
        Вы перестанете видеть открытые встречи друг друга, а заявки этого человека на ваши встречи будут
        отклонены. Разблокировать можно внизу ленты «Открытые», в разделе «Заблокированные».
      </p>
      {error && (
        <p className="participant-remove-error" role="alert">
          {error}
        </p>
      )}
      <div className="participant-remove-actions">
        <button className="secondary-action" disabled={blocking} onClick={onClose} type="button">
          Отмена
        </button>
        <button className="danger-button" disabled={blocking} onClick={() => void block()} type="button">
          {blocking ? "Блокируем…" : "Заблокировать"}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * Quiet "report" and "block" actions for a meeting or a person in it. By
 * default they are about the meeting and its organizer.
 */
export function SafetyActions({
  eventId,
  onBlocked,
  personLabel = "организатора",
  reportSubject = "Жалоба на встречу и её организатора",
  target = { kind: "organizer" },
}: {
  eventId: string;
  onBlocked?: () => void;
  personLabel?: string;
  reportSubject?: string;
  target?: ModerationTarget;
}) {
  const [open, setOpen] = useState<"report" | "block" | null>(null);
  return (
    <div className="safety-actions">
      <button className="safety-action" onClick={() => setOpen("report")} type="button">
        <Flag aria-hidden="true" size={15} />
        Пожаловаться
      </button>
      <button className="safety-action" onClick={() => setOpen("block")} type="button">
        <Ban aria-hidden="true" size={15} />
        Заблокировать
      </button>
      {open === "report" && (
        <ReportDialog eventId={eventId} onClose={() => setOpen(null)} subject={reportSubject} target={target} />
      )}
      {open === "block" && (
        <BlockDialog
          eventId={eventId}
          onBlocked={onBlocked}
          onClose={() => setOpen(null)}
          personLabel={personLabel}
          target={target}
        />
      )}
    </div>
  );
}

export function CommunityRulesList() {
  return (
    <ol className="community-rules">
      {COMMUNITY_RULES.map((rule) => (
        <li key={rule}>{rule}</li>
      ))}
    </ol>
  );
}

/** Shown once, before the first visit to the open meetings feed. */
export function CommunityRulesDialog({ onAccepted }: { onAccepted: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const accept = async () => {
    setSaving(true);
    setError("");
    try {
      await api.acceptCommunityRules();
      onAccepted();
    } catch (reason) {
      setError(errorText(reason, "Не удалось сохранить. Попробуйте ещё раз."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog labelledBy="community-rules-title">
      <h2 id="community-rules-title">{COMMUNITY_RULES_TITLE}</h2>
      <CommunityRulesList />
      {error && (
        <p className="participant-remove-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-action" disabled={saving} onClick={() => void accept()} type="button">
        {saving ? "Сохраняем…" : "Понятно, соблюдаю"}
      </button>
    </Dialog>
  );
}
