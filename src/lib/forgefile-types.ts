export type ForgefileValidationError = {
  path: string;
  message: string;
};

export type ForgefilePortHealth = {
  path: string;
  interval_seconds?: number;
};

export type ForgefilePort = {
  name: string;
  port: number;
  public: boolean;
  health?: ForgefilePortHealth;
};

export type ForgefileScript = {
  run: string;
  description?: string;
};

export type ForgefileDeploymentScripts = {
  build?: string;
  test?: string;
  deploy: string;
  teardown?: string;
};

export type ForgefileDeployment = {
  description?: string;
  auto_deploy: boolean;
  subdomain?: string;
  compose_slug?: string;
  scripts: ForgefileDeploymentScripts;
  ports: ForgefilePort[];
};

export type ForgefileArtifact = {
  description?: string;
  build: string;
  path: string;
  content_type?: string;
};

export type ForgefileAgent = {
  packages: string[];
};

export type Forgefile = {
  version: 1;
  project: {
    name: string;
    compose_slug?: string;
  };
  scripts: Record<string, ForgefileScript>;
  deployments: Record<string, ForgefileDeployment>;
  artifacts: Record<string, ForgefileArtifact>;
  agent: ForgefileAgent;
};
