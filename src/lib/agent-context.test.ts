import { describe, expect, it } from "vitest";
import {
  AGENT_CONTEXT_COMPACT_MAX_CHARS,
  buildContextCompactionPrompt,
  clampContextCompact,
  composeUserTurnPrompt,
  eventsOutsideContextCompaction,
  shouldRequestCompaction,
} from "@/lib/agent-context";

function ev(
  seq: number,
  eventType: string,
  payload: Record<string, unknown>,
) {
  return { seq, eventType, payload: JSON.stringify(payload) };
}

const turn1 = [
  ev(1, "user", { type: "user", text: "Add a health endpoint" }),
  ev(2, "assistant", { type: "assistant", text: "Added GET /health." }),
];

const turn2 = [
  ev(4, "user", { type: "user", text: "Include the git sha" }),
  ev(5, "assistant", { type: "assistant", text: "Sha field is on the payload." }),
];

describe("composeUserTurnPrompt", () => {
  it("returns only the new message when the session has no history", () => {
    expect(
      composeUserTurnPrompt({
        compact: null,
        events: [],
        newMessage: "Add a health endpoint",
      }),
    ).toBe("Add a health endpoint");
  });

  it("includes the full transcript when no compact has been stored", () => {
    const prompt = composeUserTurnPrompt({
      compact: null,
      events: [...turn1, ...turn2],
      newMessage: "Cover the error path",
    });
    expect(prompt).toContain("Add a health endpoint");
    expect(prompt).toContain("Added GET /health.");
    expect(prompt).toContain("Include the git sha");
    expect(prompt).toContain("Sha field is on the payload.");
    expect(prompt).toContain("Cover the error path");
  });

  it("sends the compact plus the latest turn and omits older turns", () => {
    const events = [
      ...turn1,
      ev(3, "system", {
        type: "system",
        subtype: "context-compact",
        phase: "stored",
      }),
      ...turn2,
      ev(6, "system", {
        type: "system",
        subtype: "context-compact",
        phase: "request",
      }),
      ev(7, "assistant", { type: "assistant", text: "internal compact draft" }),
      ev(8, "system", {
        type: "system",
        subtype: "context-compact",
        phase: "stored",
      }),
    ];
    const prompt = composeUserTurnPrompt({
      compact: "Health route exists.",
      events,
      newMessage: "Cover the error path",
    });
    expect(prompt).toContain("## Compacted learnings");
    expect(prompt).toContain("Health route exists.");
    expect(prompt).toContain("Include the git sha");
    expect(prompt).toContain("Sha field is on the payload.");
    expect(prompt).toContain("Cover the error path");
    expect(prompt).not.toContain("Add a health endpoint");
    expect(prompt).not.toContain("internal compact draft");
  });

  it("includes every turn since the last stored compact when a later compact did not land", () => {
    const events = [
      ...turn1,
      ev(3, "system", {
        type: "system",
        subtype: "context-compact",
        phase: "stored",
      }),
      ...turn2,
      ev(6, "user", { type: "user", text: "Handle 500s" }),
      ev(7, "assistant", { type: "assistant", text: "Mapped 500 to a JSON body." }),
    ];
    const prompt = composeUserTurnPrompt({
      compact: "Health route exists.",
      events,
      newMessage: "Add a test",
    });
    expect(prompt).toContain("Health route exists.");
    expect(prompt).toContain("Include the git sha");
    expect(prompt).toContain("Handle 500s");
    expect(prompt).toContain("Mapped 500 to a JSON body.");
    expect(prompt).not.toContain("Add a health endpoint");
  });
});

describe("context compaction", () => {
  it("asks for a standalone rewrite of the turn that just finished", () => {
    const prompt = buildContextCompactionPrompt({
      previousCompact: "Health route exists.",
      events: [...turn1, ...turn2],
    });
    expect(prompt).toContain("Health route exists.");
    expect(prompt).toContain("Include the git sha");
    expect(prompt).toContain("standalone");
  });

  it("requests compaction only after assistant or tool output", () => {
    expect(shouldRequestCompaction(turn2)).toBe(true);
    expect(
      shouldRequestCompaction([
        ev(1, "user", { type: "user", text: "hello" }),
      ]),
    ).toBe(false);
  });

  it("clamps stored learnings at 16000 characters", () => {
    const clamped = clampContextCompact("x".repeat(AGENT_CONTEXT_COMPACT_MAX_CHARS + 50));
    expect(clamped.length).toBe(AGENT_CONTEXT_COMPACT_MAX_CHARS);
  });

  it("drops compaction exchanges from the transcript window", () => {
    const outside = eventsOutsideContextCompaction([
      ...turn2,
      ev(6, "system", {
        type: "system",
        subtype: "context-compact",
        phase: "request",
      }),
      ev(7, "assistant", { type: "assistant", text: "compact body" }),
      ev(8, "result", { type: "result" }),
      ev(9, "system", {
        type: "system",
        subtype: "context-compact",
        phase: "stored",
      }),
    ]);
    expect(outside.map((event) => event.seq)).toEqual([4, 5]);
  });
});
