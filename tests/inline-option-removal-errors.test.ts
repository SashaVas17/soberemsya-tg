import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("src/App.tsx", "utf8");
const manageSource = appSource.slice(
  appSource.indexOf("function Manage("),
  appSource.indexOf("function Result("),
);

describe("inline organizer option removal errors", () => {
  it("keeps independent time and place removal error state", () => {
    expect(manageSource).toContain('const [timeRemovalError, setTimeRemovalError] = useState("");');
    expect(manageSource).toContain('const [placeRemovalError, setPlaceRemovalError] = useState("");');
    expect(manageSource).toContain('managePayloads.removeTime(');
    expect(manageSource).toContain('"time",');
    expect(manageSource).toContain('managePayloads.removePlace(item.id), "place"');
  });

  it("renders each removal error directly after its matching block", () => {
    const placesStart = manageSource.indexOf('className="panel manage-card manage-places-card"');
    const participantsStart = manageSource.indexOf('className="panel manage-card manage-participants-card"');
    const timeErrorArea = manageSource.slice(
      manageSource.indexOf('className="panel manage-card manage-time-card"'),
      placesStart,
    );
    const placeErrorArea = manageSource.slice(placesStart, participantsStart);
    expect(timeErrorArea).toContain("<ErrorNote message={timeRemovalError} />");
    expect(placeErrorArea).toContain("<ErrorNote message={placeRemovalError} />");
  });

  it("does not duplicate removal failures in the global error area", () => {
    const globalErrorArea = manageSource.slice(manageSource.lastIndexOf("<div className=\"action-row manage-actions\">"));
    expect(globalErrorArea).toContain("<ErrorNote message={state.error} />");
    expect(globalErrorArea).not.toContain("timeRemovalError");
    expect(globalErrorArea).not.toContain("placeRemovalError");
    expect(manageSource).toContain("else state.setError(message);");
  });

  it("clears local errors on retry, success, and refreshed event data", () => {
    expect(manageSource).toContain('if (removalKind === "time") setTimeRemovalError("");');
    expect(manageSource).toContain('if (removalKind === "place") setPlaceRemovalError("");');
    expect(manageSource).toContain("[state.lastUpdated]");
    expect(manageSource).toContain("if (removalKind === \"time\") setTimeRemovalError(message);");
    expect(manageSource).toContain("if (removalKind === \"place\") setPlaceRemovalError(message);");
  });

  it("leaves the API contract untouched", () => {
    const apiSource = readFileSync("src/api.ts", "utf8");
    expect(apiSource).toContain("manage: (id: string, payload: unknown)");
    expect(apiSource).toContain("payload");
    expect(appSource).not.toContain("final-option");
  });
});
