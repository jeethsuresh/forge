"use client";

import { Suspense } from "react";
import { ProjectStudio } from "@/components/ProjectStudio";

export default function ProjectDeployPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--forge-muted)]">
          Loading…
        </div>
      }
    >
      <ProjectStudio mode="deploy" />
    </Suspense>
  );
}
