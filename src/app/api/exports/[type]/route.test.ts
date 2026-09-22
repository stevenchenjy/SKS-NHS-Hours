import { beforeEach, describe, expect, it, vi } from "vitest";
const { getViewer, createClient } = vi.hoisted(() => ({
  getViewer: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/access", () => ({ getViewer }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));
import { GET } from "./route";

describe("export authorization", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects a teacher before any data or export audit is queried", async () => {
    getViewer.mockResolvedValue({
      activeMembership: { id: "teacher" },
      isTeacherAdmin: true,
      isAdmin: false,
    });
    const response = await GET(new Request("http://localhost/api/exports/hours"), {
      params: Promise.resolve({ type: "hours" }),
    });
    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "accepts Admin capability regardless of protected ownership (%s)",
    async (isPlatformOwner) => {
      getViewer.mockResolvedValue({
        activeMembership: { id: "admin" },
        isTeacherAdmin: false,
        isAdmin: true,
        isPlatformOwner,
      });
      const response = await GET(new Request("http://localhost/api/exports/invalid"), {
        params: Promise.resolve({ type: "invalid" }),
      });
      expect(response.status).toBe(404);
    },
  );
});
