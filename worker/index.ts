/** Cloudflare Worker entry point for dealer settlement. */
import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { verifyAccessJwt } from "../app/access-jwt";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  AUTO_SYNC_SECRET?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

function koreanHour(timestamp: number) {
  return (new Date(timestamp).getUTCHours() + 9) % 24;
}

const worker = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
      return Response.json({ error: "로그인 서비스를 준비 중입니다. 잠시 후 다시 시도해주세요." }, { status: 503 });
    }
    try {
      await verifyAccessJwt(request.headers.get("Cf-Access-Jwt-Assertion") ?? "", env);
    } catch {
      return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    // Vite's compiled client chunks are not App Router routes. Keep them behind
    // the same JWT check, then serve them from the Workers asset binding.
    if (url.pathname.startsWith("/assets/")) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [
        ...DEFAULT_DEVICE_SIZES,
        ...DEFAULT_IMAGE_SIZES,
      ];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) =>
            env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return handler.fetch(request, env, ctx);
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const hour = koreanHour(controller.scheduledTime);
    if (hour < 9 || hour > 18 || !env.AUTO_SYNC_SECRET) return;

    const request = new Request(
      "https://worker.internal/api/salesforce/auto-sync",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-auto-sync-secret": env.AUTO_SYNC_SECRET,
        },
        body: JSON.stringify({
          source: "scheduled",
          cron: controller.cron,
        }),
      },
    );

    ctx.waitUntil(handler.fetch(request, env, ctx).then(async (response: Response) => {
      const result = await response.json() as { failedCount?: number };
      if (!response.ok || result.failedCount) throw new Error("Scheduled Salesforce sync failed");
    }));
  },
};

export default worker;
