import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  isReasoningUnsupportedError,
  runLocalAgentLoop,
} from "@/lib/agent-backends/local-loop";

describe("local loop", () => {
  it("treats 400 reasoning errors as unsupported", () => {
    expect(
      isReasoningUnsupportedError(400, "unknown field reasoning"),
    ).toBe(true);
    expect(isReasoningUnsupportedError(500, "unknown field reasoning")).toBe(
      false,
    );
  });

  it("falls back from xhigh to no reasoning and can write files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-local-loop-"));
    writeFileSync(join(dir, "README.md"), "hi\n", "utf8");
    let calls = 0;
    const lines: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls += 1;
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        reasoning?: unknown;
      };
      if (payload.reasoning) {
        return new Response("unknown field reasoning", { status: 400 });
      }
      if (calls === 3) {
        return Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call1",
                    type: "function",
                    function: {
                      name: "write_file",
                      arguments: JSON.stringify({
                        path: "hello.txt",
                        contents: "from local",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      return Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: "done",
            },
          },
        ],
      });
    };

    const code = await runLocalAgentLoop({
      prompt: "write hello.txt",
      workdir: dir,
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3.2",
      emit: (line) => lines.push(line),
      fetchImpl,
      maxSteps: 5,
    });
    expect(code).toBe(0);
    expect(readFileSync(join(dir, "hello.txt"), "utf8")).toBe("from local");
    expect(lines.some((l) => l.includes("thinking=none"))).toBe(true);
  });
});
