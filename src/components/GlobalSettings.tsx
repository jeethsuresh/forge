"use client";

import { useState } from "react";
import { ProjectRoutingOverview } from "@/components/ProjectRoutingOverview";
import { CaddyLogsViewer } from "@/components/CaddyLogsViewer";
import { CaddySettingsEditor } from "@/components/CaddySettingsEditor";
import { PageHeader, TabButton, TabList } from "@/components/ui";

type SettingsTab = "routing" | "routes" | "logs";

export function GlobalSettings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("routing");

  return (
    <div className="forge-app-bg min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-7 sm:py-8 lg:px-10">
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="Global settings"
          subtitle="Routing, live Caddy config, and access logs"
        />

        <TabList className="mb-6">
          <TabButton
            active={activeTab === "routing"}
            onClick={() => setActiveTab("routing")}
          >
            Project routing
          </TabButton>
          <TabButton
            active={activeTab === "routes"}
            onClick={() => setActiveTab("routes")}
          >
            Routes
          </TabButton>
          <TabButton
            active={activeTab === "logs"}
            onClick={() => setActiveTab("logs")}
          >
            Access logs
          </TabButton>
        </TabList>

        {activeTab === "routing" ? (
          <ProjectRoutingOverview />
        ) : activeTab === "routes" ? (
          <CaddySettingsEditor />
        ) : (
          <CaddyLogsViewer />
        )}
      </div>
    </div>
  );
}
