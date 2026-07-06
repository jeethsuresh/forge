import { CaddySettingsEditor } from "@/components/CaddySettingsEditor";

export default function SettingsPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6 lg:p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-1 text-2xl font-semibold text-zinc-100">
          Global settings
        </h1>
        <p className="mb-8 text-sm text-zinc-500">
          Manage the running Caddy reverse proxy configuration
        </p>

        <CaddySettingsEditor />
      </div>
    </div>
  );
}
