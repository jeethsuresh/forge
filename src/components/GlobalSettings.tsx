"use client";

import { useState } from "react";
import { CaddyLogsViewer } from "@/components/CaddyLogsViewer";
import { CaddySettingsEditor } from "@/components/CaddySettingsEditor";

type SettingsTab = "routes" | "logs";

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 flex-1 rounded-md px-4 text-sm font-medium transition-colors ${
        active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

export function GlobalSettings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("routes");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6 lg:p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-1 text-2xl font-semibold text-zinc-100">
          Global settings
        </h1>
        <p className="mb-6 text-sm text-zinc-500">
          Manage Caddy reverse proxy routes and monitor access logs
        </p>

        <div className="mb-6 flex rounded-lg border border-zinc-800 bg-zinc-900/50 p-1">
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
        </div>

        {activeTab === "routes" ? (
          <CaddySettingsEditor />
        ) : (
          <CaddyLogsViewer />
        )}
      </div>
    </div>
  );
}
