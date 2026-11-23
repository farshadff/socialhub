import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildUrl,
  filtersToQuery,
  socialHubDataProvider,
  sortersToQuery,
  toHttpError,
} from "./data-provider";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("query helpers", () => {
  it("adds the trailing slash Django expects", () => {
    expect(buildUrl("/api/v1", "plans")).toBe("/api/v1/plans/");
    expect(buildUrl("/api/v1/", "/plans/12/")).toBe("/api/v1/plans/12/");
    expect(buildUrl("/api/v1", "plans", { page: 2, status: undefined })).toBe(
      "/api/v1/plans/?page=2",
    );
  });

  it("maps eq and in filters to comma-separated query parameters", () => {
    expect(
      filtersToQuery([
        { field: "status", operator: "in", value: ["open", "reserved"] },
        { field: "plan", operator: "eq", value: 7 },
        { field: "empty", operator: "eq", value: "" },
      ]),
    ).toEqual({ status: "open,reserved", plan: "7" });
  });

  it("maps sorters to the ordering parameter", () => {
    expect(
      sortersToQuery([
        { field: "scheduled_at", order: "desc" },
        { field: "id", order: "asc" },
      ]),
    ).toEqual({ ordering: "-scheduled_at,id" });
  });

  it("turns the API error envelope into a Refine HttpError", () => {
    const error = toHttpError(
      400,
      {
        error: {
          code: "validation_error",
          message: "Some fields need attention.",
          fields: [{ path: "goals.0.target_value", code: "min_value", message: "Too low." }],
          request_id: "req-1",
          retryable: false,
        },
      },
      "400 Bad Request",
    );
    expect(error).toMatchObject({
      statusCode: 400,
      code: "validation_error",
      requestId: "req-1",
      errors: { "goals.0.target_value": "Too low." },
    });
  });
});

describe("socialHubDataProvider", () => {
  it("reads DRF pages into data and total", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { count: 3, next: null, previous: null, results: [{ id: 1 }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await socialHubDataProvider().getList({
      resource: "plans",
      pagination: { currentPage: 2, pageSize: 10 },
      sorters: [{ field: "week_start", order: "desc" }],
    });

    expect(result).toEqual({ data: [{ id: 1 }], total: 3 });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/plans/?ordering=-week_start&page=2&page_size=10",
    );
  });

  it("rejects with the API's code and request id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          error: { code: "state_conflict", message: "Changed.", request_id: "req-9" },
        }),
      ),
    );

    await expect(
      socialHubDataProvider().update({ resource: "plans", id: 4, variables: {} }),
    ).rejects.toMatchObject({ statusCode: 409, code: "state_conflict", requestId: "req-9" });
  });
});
