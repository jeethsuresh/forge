"use client";

import { useState } from "react";
import { ProjectRoutingOverview } from "@/components/ProjectRoutingOverview";
import { CaddyLogsViewer } from "@/components/CaddyLogsViewer";
import { CaddySettingsEditor } from "@/components/CaddySettingsEditor";
import { GitSshKeysSettings } from "@/components/GitSshKeysSettings";
import { FunctionalUsersSettings } from "@/components/FunctionalUsersSettings";
import { AgentBackendsSettings } from "@/components/AgentBackendsSettings";
import { MigrationSettings } from "@/components/MigrationSettings";
import { ThemeAppearance } from "@/components/ThemeAppearance";
import { PageHeader, TabButton, TabList } from "@/components/ui";

type SettingsTab =
  | "appearance"
  | "routing"
  | "routes"
  | "logs"
  | "git-ssh"
  | "mcp-agents"
  | "agent-backends"
  | "migrate";

export function GlobalSettings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");

  return (
    <div className="forge-app-bg min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-7 sm:py-8 lg:px-10">
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="Global settings"
          subtitle="Appearance, routing, live Caddy config, access logs, git SSH keys, MCP agents, agent backends, and migration"
        />

        <TabList className="mb-6">
          <TabButton
            active={activeTab === "appearance"}
            onClick={() => setActiveTab("appearance")}
          >
            Appearance
          </TabButton>
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
          <TabButton
            active={activeTab === "git-ssh"}
            onClick={() => setActiveTab("git-ssh")}
          >
            Git SSH
          </TabButton>
          <TabButton
            active={activeTab === "mcp-agents"}
            onClick={() => setActiveTab("mcp-agents")}
          >
            MCP agents
          </TabButton>
          <TabButton
            active={activeTab === "agent-backends"}
            onClick={() => setActiveTab("agent-backends")}
          >
            Agent backends
          </TabButton>
          <TabButton
            active={activeTab === "migrate"}
            onClick={() => setActiveTab("migrate")}
          >
            Migrate
          </TabButton>
        </TabList>

        {activeTab === "appearance" ? (
          <ThemeAppearance />
        ) : activeTab === "routing" ? (
          <ProjectRoutingOverview />
        ) : activeTab === "routes" ? (
          <CaddySettingsEditor />
        ) : activeTab === "logs" ? (
          <CaddyLogsViewer />
        ) : activeTab === "git-ssh" ? (
          <GitSshKeysSettings />
        ) : activeTab === "mcp-agents" ? (
          <FunctionalUsersSettings />
        ) : activeTab === "agent-backends" ? (
          <AgentBackendsSettings />
        ) : (
          <MigrationSettings />
        )}
      </div>
    </div>
  );
}
