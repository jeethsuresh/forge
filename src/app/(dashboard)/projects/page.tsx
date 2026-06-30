import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deployments, projects } from "@/lib/db/schema";
import { formatRelativeTime, shortSha, statusColor } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const allProjects = db
    .select()
    .from(projects)
    .orderBy(projects.name)
    .all();

  const enriched = allProjects.map((project) => {
    const latest = db
      .select()
      .from(deployments)
      .where(eq(deployments.projectId, project.id))
      .orderBy(desc(deployments.startedAt))
      .limit(1)
      .get();
    return { project, latest };
  });

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Projects</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Monitored repositories and their deployment status
          </p>
        </div>
        <Link
          href="/projects/new"
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400"
        >
          Add project
        </Link>
      </div>

      {enriched.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 px-8 py-16 text-center">
          <p className="text-zinc-400">No projects are being watched yet.</p>
          <Link
            href="/projects/new"
            className="mt-4 inline-block text-sm font-medium text-orange-400 hover:text-orange-300"
          >
            Add your first project →
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {enriched.map(({ project, latest }) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 transition-colors hover:border-zinc-700"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <h2 className="font-semibold text-zinc-100">{project.name}</h2>
                {!project.enabled && (
                  <span className="rounded border border-zinc-600 px-1.5 py-0.5 text-xs text-zinc-500">
                    paused
                  </span>
                )}
              </div>
              <p className="mb-4 truncate font-mono text-xs text-zinc-500">
                {project.githubRepo} · {project.branch}
              </p>
              {latest ? (
                <div className="flex items-center justify-between text-sm">
                  <span
                    className={`rounded border px-2 py-0.5 text-xs font-medium capitalize ${statusColor(latest.status)}`}
                  >
                    {latest.status}
                  </span>
                  <span className="text-zinc-500">
                    {shortSha(latest.commitSha)} ·{" "}
                    {formatRelativeTime(latest.startedAt)}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-zinc-600">No deployments yet</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
