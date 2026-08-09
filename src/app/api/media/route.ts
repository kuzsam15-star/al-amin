import { NextResponse } from "next/server";
import sharp from "sharp";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasTrustedOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
const maximumInputBytes=12*1024*1024;
const supported=new Set(["jpeg","png","webp","heif"]);

export async function POST(request:Request) {
  if (!hasTrustedOrigin(request)) return NextResponse.json({ error: "Недопустимый источник запроса." }, { status: 403 });
  const supabase=await createSupabaseServerClient(); const {data:{user}}=await supabase.auth.getUser();
  if(!user) return NextResponse.json({error:"Войдите или зарегистрируйтесь, чтобы загрузить фотографию."},{status:401});
  const form=await request.formData(); const file=form.get("file"); const kind=form.get("kind");
  if(!(file instanceof File) || !["avatar","gallery"].includes(String(kind))) return NextResponse.json({error:"Не удалось прочитать изображение."},{status:400});
  if(file.size===0 || file.size>maximumInputBytes) return NextResponse.json({error:"Размер исходного файла не должен превышать 12 МБ."},{status:413});
  try {
    const input=Buffer.from(await file.arrayBuffer()); const source=sharp(input,{limitInputPixels:40_000_000,failOn:"error"}).rotate(); const meta=await source.metadata();
    if(!meta.format || !supported.has(meta.format)) return NextResponse.json({error:"Поддерживаются JPEG, PNG, WebP и совместимые HEIF-изображения."},{status:415});
    const avatar=kind === "avatar";
    // AvatarCropper supplies an already selected square. Do not crop it again:
    // this processed WebP is the canonical avatar used everywhere.
    const output=avatar ? await source.resize(512,512,{fit:"fill"}).webp({quality:84,smartSubsample:true}).toBuffer() : await source.resize({width:1800,height:1800,fit:"inside",withoutEnlargement:true}).webp({quality:84,smartSubsample:true}).toBuffer();
    const path=`submissions/${user.id}/${avatar?"avatar":"gallery"}/${crypto.randomUUID()}.webp`;
    const {error}=await supabase.storage.from("profile-media").upload(path,output,{contentType:"image/webp",upsert:false});
    if(error) throw error;
    return NextResponse.json({path,width:avatar?512:Math.min(meta.width??1800,1800),height:avatar?512:Math.min(meta.height??1800,1800),bytes:output.byteLength,format:"webp"},{status:201});
  } catch {
    return NextResponse.json({error:"Не удалось безопасно обработать изображение. Выберите другой файл."},{status:422});
  }
}
