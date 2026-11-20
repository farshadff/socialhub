export type HealthResponse = {
  status: string;
  dependencies?: Record<string, string>;
};

export type DemoResponse = {
  mode: string;
  source_mode: string;
  account_timezone: string;
  source_provider: string;
  model_provider: string;
  publisher_provider: string;
  publishing_enabled: boolean;
  source_items: Array<{
    source_key: string;
    title: string;
    canonical_url: string;
    is_synthetic: boolean;
  }>;
  model_preview: {
    caption: string;
    is_synthetic: boolean;
  };
};

export type SocialHubOverview = {
  health: HealthResponse;
  demo: DemoResponse;
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }

  return response.json() as Promise<T>;
}

export async function loadSocialHubOverview(): Promise<SocialHubOverview> {
  const [health, demo] = await Promise.all([
    getJson<HealthResponse>('/api/v1/health/ready/'),
    getJson<DemoResponse>('/api/v1/demo/'),
  ]);

  return { health, demo };
}
