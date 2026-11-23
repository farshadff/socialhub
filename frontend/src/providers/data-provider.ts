import type {
  BaseRecord,
  CrudFilter,
  CrudSort,
  DataProvider,
  HttpError,
  ValidationErrors,
} from "@refinedev/core";

/**
 * Refine data provider for the Social Hub Django REST API (docs/API.md).
 *
 * - Lists are `{count, next, previous, results}` paged with `page` / `page_size`.
 * - Filters are query parameters named after fields; several values are comma-separated.
 * - Ordering is `ordering=field` or `ordering=-field`.
 * - Paths end with a slash, as Django expects.
 * - Errors are `{"error": {code, message, fields, request_id, retryable}}` and are
 *   turned into a Refine `HttpError` so forms can show field errors.
 */

export const API_URL = "/api/v1";

export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    fields?: Array<{ path: string; code?: string; message?: string }>;
    request_id?: string;
    retryable?: boolean;
  };
};

export type SocialHubHttpError = HttpError & {
  code?: string;
  requestId?: string;
  retryable?: boolean;
};

type Query = Record<string, string | number | undefined>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

export function buildUrl(apiUrl: string, path: string, query?: Query): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
  const base = `${apiUrl.replace(/\/+$/, "")}/${clean}${clean ? "/" : ""}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

export function filtersToQuery(filters?: CrudFilter[]): Query {
  const query: Query = {};
  for (const filter of filters ?? []) {
    // Only field filters map onto the API; `or`/`and` groups are not part of the contract.
    if (!("field" in filter)) continue;
    const { field, operator, value } = filter;
    if (value === undefined || value === null || value === "") continue;
    if (operator !== "eq" && operator !== "in") continue;
    query[field] = Array.isArray(value) ? value.join(",") : String(value);
  }
  return query;
}

export function sortersToQuery(sorters?: CrudSort[]): Query {
  if (!sorters?.length) return {};
  return {
    ordering: sorters.map(({ field, order }) => (order === "desc" ? `-${field}` : field)).join(","),
  };
}

export function toHttpError(
  status: number,
  body: ApiErrorBody | undefined,
  fallback: string,
): SocialHubHttpError {
  const error = body?.error;
  let errors: ValidationErrors | undefined;
  if (error?.fields?.length) {
    errors = {};
    for (const field of error.fields) {
      errors[field.path] = field.message ?? field.code ?? "Invalid value.";
    }
  }
  return {
    statusCode: status,
    message: error?.message ?? fallback,
    errors,
    code: error?.code,
    requestId: error?.request_id,
    retryable: error?.retryable,
  };
}

async function request<T>(
  method: string,
  url: string,
  payload?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...headers,
  };
  const upper = method.toUpperCase();
  if (!SAFE_METHODS.has(upper)) {
    const csrf = readCookie("csrftoken");
    if (csrf) finalHeaders["X-CSRFToken"] = csrf;
  }
  let body: BodyInit | undefined;
  if (payload instanceof FormData) {
    body = payload;
  } else if (payload !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
    body = JSON.stringify(payload);
  }

  const response = await fetch(url, {
    method: upper,
    headers: finalHeaders,
    body,
    credentials: "same-origin",
  });

  if (response.status === 204) return undefined as T;

  const isJson = response.headers.get("Content-Type")?.includes("application/json");
  const data = isJson ? await response.json() : undefined;

  if (!response.ok) {
    throw toHttpError(
      response.status,
      data as ApiErrorBody | undefined,
      `${response.status} ${response.statusText}`.trim(),
    );
  }
  return data as T;
}

type ListBody<T> = { count: number; results: T[] };

export const socialHubDataProvider = (apiUrl: string = API_URL): DataProvider => ({
  getApiUrl: () => apiUrl,

  getList: async ({ resource, pagination, filters, sorters, meta }) => {
    const { currentPage = 1, pageSize = 50, mode = "server" } = pagination ?? {};
    const query: Query = {
      ...filtersToQuery(filters),
      ...sortersToQuery(sorters),
      ...(meta?.query as Query | undefined),
    };
    if (mode === "server") {
      query.page = currentPage;
      query.page_size = pageSize;
    }
    const body = await request<ListBody<BaseRecord> | BaseRecord[]>(
      "GET",
      buildUrl(apiUrl, resource, query),
    );
    // Unpaginated lists (for example `/fonts/`) return `{"results": [...]}` or an array.
    if (Array.isArray(body)) return { data: body as never[], total: body.length };
    return {
      data: body.results as never[],
      total: body.count ?? body.results.length,
    };
  },

  getMany: async ({ resource, ids, meta }) => {
    const data = await Promise.all(
      ids.map((id) =>
        request<BaseRecord>(
          "GET",
          buildUrl(apiUrl, `${resource}/${id}`, meta?.query as Query | undefined),
        ),
      ),
    );
    return { data: data as never[] };
  },

  getOne: async ({ resource, id, meta }) => {
    const data = await request<BaseRecord>(
      "GET",
      buildUrl(apiUrl, `${resource}/${id}`, meta?.query as Query | undefined),
    );
    return { data: data as never };
  },

  create: async ({ resource, variables, meta }) => {
    const data = await request<BaseRecord>(
      "POST",
      buildUrl(apiUrl, resource, meta?.query as Query | undefined),
      variables,
    );
    return { data: data as never };
  },

  update: async ({ resource, id, variables, meta }) => {
    const data = await request<BaseRecord>(
      "PATCH",
      buildUrl(apiUrl, `${resource}/${id}`, meta?.query as Query | undefined),
      variables,
    );
    return { data: data as never };
  },

  deleteOne: async ({ resource, id, meta }) => {
    await request<void>(
      "DELETE",
      buildUrl(apiUrl, `${resource}/${id}`, meta?.query as Query | undefined),
    );
    return { data: { id } as never };
  },

  custom: async ({ url, method, filters, sorters, payload, query, headers }) => {
    const target = url.startsWith("http") || url.startsWith("/") ? url : buildUrl(apiUrl, url);
    const [path, existing] = target.split("?");
    const params = new URLSearchParams(existing);
    const extra: Query = {
      ...filtersToQuery(filters),
      ...sortersToQuery(sorters),
      ...(query as Query | undefined),
    };
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    const search = params.toString();
    const data = await request<BaseRecord>(
      method,
      search ? `${path}?${search}` : path,
      payload,
      headers as Record<string, string> | undefined,
    );
    return { data: data as never };
  },
});
