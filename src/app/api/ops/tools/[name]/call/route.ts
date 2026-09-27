import { callForgeAgentTool } from "@/lib/forge-agent/dispatch";
import { readJsonBody } from "@/lib/ops-api-route";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const body = await readJsonBody(request);
  return callForgeAgentTool({
    name,
    args: body,
    request,
  });
}
