import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { isProfileMediaPath } from "@/lib/media-paths";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const mediaPaths = (payload: Record<string, unknown> | null) => [
  typeof payload?.avatar_path === "string" ? payload.avatar_path : null,
  ...(Array.isArray(payload?.gallery_paths) ? payload.gallery_paths.filter((path): path is string => typeof path === "string") : []),
].filter(isProfileMediaPath);

export async function GET(request: NextRequest) {
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
    const output = await sharp(Buffer.from(await data.arrayBuffer()), { failOn: "error", limitInputPixels: 40_000_000 }).rotate().webp({ quality: 88 }).toBuffer();
    return new NextResponse(output, { headers: {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": publicAccess ? "public, max-age=3600, stale-while-revalidate=86400" : "private, no-store",
      "Vary": "Cookie",
    } });
  } catch {
    return NextResponse.json({ error: "Не удалось подготовить фотографию." }, { status: 422 });
  }
}
