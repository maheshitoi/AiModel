import { beforeEach, describe, expect, it, vi } from "vitest";

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

const ok = (data: unknown) => json(200, { success: true, data });
const unauthorized = () => json(401, { success: false, error: { statusCode: 401, message: "Invalid or expired access token" } });

// The module keeps the token in module state, so each test gets a fresh copy.
async function freshApi() {
  vi.resetModules();
  return import("./api");
}

describe("api client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("unwraps the success envelope and sends the bearer token", async () => {
    const { api, session } = await freshApi();
    session.setAccessToken("token-1");
    fetchMock.mockReturnValueOnce(ok({ hello: "world" }));

    await expect(api.get("/thing")).resolves.toEqual({ hello: "world" });
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer token-1");
  });

  it("throws ApiError with the server message and status", async () => {
    const { api, ApiError } = await freshApi();
    fetchMock.mockReturnValueOnce(json(409, { success: false, error: { statusCode: 409, message: "Already exists" } }));

    const error = await api.post("/users", {}).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: "Already exists" });
  });

  it("refreshes once on 401 and replays the request with the new token", async () => {
    const { api } = await freshApi();
    fetchMock
      .mockReturnValueOnce(unauthorized())
      .mockReturnValueOnce(ok({ accessToken: "fresh" }))
      .mockReturnValueOnce(ok([1, 2, 3]));

    await expect(api.get("/dashboard/overview")).resolves.toEqual([1, 2, 3]);
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/auth\/refresh$/);
    expect(fetchMock.mock.calls[2][1].headers.authorization).toBe("Bearer fresh");
  });

  it("shares a single refresh between concurrent requests", async () => {
    const { api } = await freshApi();
    fetchMock.mockImplementation((url: URL | string) => {
      const path = String(url);
      if (path.endsWith("/auth/refresh")) return ok({ accessToken: "fresh" });
      return fetchMock.mock.calls.filter((c) => String(c[0]) === path).length === 1 ? unauthorized() : ok(path);
    });

    await Promise.all([api.get("/a"), api.get("/b"), api.get("/c")]);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("signals session expiry when the refresh fails", async () => {
    const { api, session } = await freshApi();
    const expired = vi.fn();
    session.onExpired(expired);
    fetchMock.mockReturnValueOnce(unauthorized()).mockReturnValueOnce(unauthorized()).mockReturnValueOnce(unauthorized());

    await expect(api.get("/dashboard/overview")).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
  });

  it("never retries auth endpoints", async () => {
    const { api } = await freshApi();
    fetchMock.mockReturnValueOnce(json(401, { success: false, error: { statusCode: 401, message: "Invalid email or password" } }));

    await expect(api.post("/auth/login", {})).rejects.toMatchObject({ message: "Invalid email or password" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
