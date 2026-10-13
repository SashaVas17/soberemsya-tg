import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The UI is split across App.tsx, screens and shared UI modules. Source-level
// tests read them as one text: top-level declarations without imports, in the
// order they had in the former single App.tsx, so range checks between
// neighbouring declarations keep working. New declarations go to the end.
const files = [
  "src/App.tsx",
  "src/app-hooks.ts",
  "src/app-types.ts",
  "src/share.ts",
  ...["src/ui", "src/screens"].flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => /\.tsx?$/.test(name))
      .sort()
      .map((name) => join(dir, name)),
  ),
];

const legacyOrder: string[] = [
  "Navigate", "EditablePlaceDraft", "statusLabels", "usePath", "useTelegramBack", "useMainButton",
  "useAppTheme", "Header", "Loading", "ErrorNote", "RetryState", "EmptyState", "StatusBadge",
  "responseModeOptions", "StatCard", "AdminStatsScreen", "NotificationSettingsScreen",
  "SessionExpired", "OutsideTelegram", "Home", "PublicMeetings", "MeetingGroup", "SlotBuilder",
  "CreateEvent", "useEvent", "useParticipantEvent", "Refresh", "CreatedGroup", "Created",
  "PublicPreviewScreen", "localProposalDefaults", "ParticipantTimeProposal",
  "ParticipantPlaceProposal", "ParticipantEvent", "LeaveMeetingAction", "MyEvents", "Manage",
  "Result", "telegramAppConfig", "miniAppLink", "usePreparedShare", "shareCard", "shareEvent",
  "shareResult", "App",
];

const declaration =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|type|interface)\s+([A-Za-z_]\w*)/;

function declarations(file: string): { name: string; text: string }[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const result: { name: string; text: string[] }[] = [];
  let inImport = false;
  for (const line of lines) {
    if (line.startsWith("import ")) inImport = !line.trimEnd().endsWith(";");
    else if (inImport) {
      if (line.trimEnd().endsWith(";")) inImport = false;
    } else {
      const match = declaration.exec(line);
      if (match) result.push({ name: match[1], text: [] });
      result.at(-1)?.text.push(line.replace(/^export (?!default)/, ""));
    }
  }
  return result.map(({ name, text }) => ({ name, text: text.join("\n") }));
}

export function readAppSource(): string {
  const all = files.flatMap(declarations);
  const rank = (name: string) => {
    const index = legacyOrder.indexOf(name);
    return index === -1 ? legacyOrder.length : index;
  };
  return all
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.index - b.index)
    .map((item) => item.text)
    .join("\n");
}
