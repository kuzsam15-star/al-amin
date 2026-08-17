import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { isProfileMediaPath } from "@/lib/media-paths";
import { RESOURCE_LIMITS, validateImageMetadata } from "@/lib/resource-limits.mjs";

export const runtime = "nodejs";

const mediaPaths = (payload: Record<string, unknown> | null) => [
  typeof payload?.avatar_path === "string" ? payload.avatar_path : null,
  ...(Array.isArray(payload?.gallery_paths) ? payload!.gallery_paths.filter((path): path is string => typeof path === "string") : []),
].filter((path): path is string => Boolean(path));

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path") ?? "";
  if (!isProfileMediaPath(path)) return NextResponse.json({ error: "Некорректный путь к фотографии." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Требуется вход в кабинет." }, { status: 401 });

  const [{ data: profile }, { data: pending }, { data: application }] = await Promise.all([
    supabase.from("specialists").select("avatar_path,gallery_paths").eq("owner_id", user.id).maybeSingle(),
    supabase.from("specialist_revisions").select("payload").eq("owner_id", user.id).eq("status", "pending").maybeSingle(),
    supabase.from("owner_applications_v1").select("main_image_path,gallery_paths").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const allowed = new Set<string>([
    ...(profile ? [profile.avatar_path, ...(profile.gallery_paths ?? [])].filter((item): item is string => typeof item === "string") : []),
    ...mediaPaths((pending?.payload ?? null) as Record<string, unknown> | null),
    ...(application ? [application.main_image_path, ...(application.gallery_paths ?? [])].filter((item): item is string => typeof item === "string") : []),
  ]);
  // A freshly cropped file lives under the authenticated user's own upload folder
  // until the profile form is submitted as a revision. It must remain editable in
  // that short interval, without granting access to another user's draft upload.
  const isOwnFreshUpload = path.startsWith(`submissions/${user.id}/`);
  if (!allowed.has(path) && !isOwnFreshUpload) return NextResponse.json({ error: "Фотография недоступна." }, { status: 403 });

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from("profile-media").download(path);
  if (error || !data) return NextResponse.json({ error: "Фотография не найдена." }, { status: 404 });
  try {
    if (data.size === 0 || data.size > RESOURCE_LIMITS.mediaOutputBytes) throw new Error("bounded media source rejected");
    const input = Buffer.from(await data.arrayBuffer());
    const image = sharp(input, { failOn: "error", limitInputPixels: RESOURCE_LIMITS.imagePixels }).timeout({ seconds: RESOURCE_LIMITS.imageProcessingSeconds });
    const metadata = await image.metadata();
    if (!validateImageMetadata(metadata)) throw new Error("bounded media source rejected");
    const output = await image.rotate().webp({ quality: 90 }).toBuffer();
    if (output.length === 0 || output.length > RESOURCE_LIMITS.mediaOutputBytes) throw new Error("bounded media output rejected");
    return new NextResponse(output, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ error: "Не удалось подготовить фотографию для редактора." }, { status: 422 });
  }
}
