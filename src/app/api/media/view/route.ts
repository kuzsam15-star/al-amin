import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { isCanonicalProfileMediaPath, isProfileMediaPath } from "@/lib/media-paths";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { RESOURCE_LIMITS, validateImageMetadata } from "@/lib/resource-limits.mjs";

export const runtime = "nodejs";

const mediaPaths = (payload: Record<string, unknown> | null) => [
  typeof payload?.avatar_path === "string" ? payload.avatar_path : null,
  ...(Array.isArray(payload?.gallery_paths) ? payload.gallery_paths.filter((path): path is string => typeof path === "string") : []),
].filter(isProfileMediaPath);

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.getAll("path").length !== 1 || [...request.nextUrl.searchParams.keys()].some((key) => key !== "path")) {
    return NextResponse.json({ error: "Некорректный запрос фотографии." }, { status: 400 });
  }
  const path = request.nextUrl.searchParams.get("path") ?? "";
  if (!isProfileMediaPath(path)) return NextResponse.json({ error: "Некорректный путь к фотографии." }, { status: 400 });

  const [supabase, admin] = await Promise.all([createSupabaseServerClient(), Promise.resolve(createSupabaseAdminClient())]);
  const { data: { user } } = await supabase.auth.getUser();
  let privateAccess = false;

  if (user) {
    const [{ data: role }, { data: profile }, { data: application }, { data: revisions }] = await Promise.all([
      supabase.from("moderators").select("role").eq("user_id", user.id).maybeSingle(),
      supabase.from("specialists").select("avatar_path,gallery_paths").eq("owner_id", user.id).maybeSingle(),
      supabase.from("owner_applications_v1").select("main_image_path,gallery_paths").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("specialist_revisions").select("payload").eq("owner_id", user.id).in("status", ["pending", "changes_requested"]).order("updated_at", { ascending: false }).limit(1),
    ]);
    privateAccess = role?.role === "admin" || role?.role === "moderator" || path.startsWith(`submissions/${user.id}/`)
      || mediaPaths(profile as Record<string, unknown> | null).includes(path)
      || mediaPaths(application ? { avatar_path: application.main_image_path, gallery_paths: application.gallery_paths } : null).includes(path)
      || (revisions ?? []).some((revision) => mediaPaths(revision.payload as Record<string, unknown>).includes(path));
  }

  const [{ data: avatar }, { data: gallery }] = await Promise.all([
    admin.from("specialists").select("id").eq("status", "published").eq("avatar_path", path).limit(1).maybeSingle(),
    admin.from("specialists").select("id").eq("status", "published").contains("gallery_paths", [path]).limit(1).maybeSingle(),
  ]);
  const publicAccess = Boolean(avatar || gallery);
  if (!privateAccess && !publicAccess) return NextResponse.json({ error: "Фотография недоступна." }, { status: user ? 403 : 404 });

  const { data, error } = await admin.storage.from("profile-media").download(path);
  if (error || !data) return NextResponse.json({ error: "Фотография не найдена." }, { status: 404 });
  try {
    if (data.size === 0 || data.size > RESOURCE_LIMITS.mediaOutputBytes) throw new Error("bounded media source rejected");
    const input = Buffer.from(await data.arrayBuffer());
    let output: Buffer;
    let cacheControl = "private, no-store";
    if (publicAccess && isCanonicalProfileMediaPath(path)) {
      const expectedHash = path.slice(path.lastIndexOf("/") + 1, -".webp".length);
      if (createHash("sha256").update(input).digest("hex") !== expectedHash) throw new Error("canonical media hash mismatch");
      output = input;
      cacheControl = "public, max-age=31536000, immutable";
    } else {
      const image = sharp(input, { failOn: "error", limitInputPixels: RESOURCE_LIMITS.imagePixels }).timeout({ seconds: RESOURCE_LIMITS.imageProcessingSeconds });
      const metadata = await image.metadata();
      if (!validateImageMetadata(metadata)) throw new Error("bounded media source rejected");
      output = await image.rotate().webp({ quality: 88 }).toBuffer();
      if (output.length === 0 || output.length > RESOURCE_LIMITS.mediaOutputBytes) throw new Error("bounded media output rejected");
    }
    return new NextResponse(new Uint8Array(output), { headers: {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": cacheControl,
      "Vary": "Cookie",
    } });
  } catch {
    return NextResponse.json({ error: "Не удалось подготовить фотографию." }, { status: 422 });
  }
}
