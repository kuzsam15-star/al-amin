import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { hasTrustedOrigin } from "@/lib/request-security";
import {
  assertResourceRuntimeConfigured,
  createBoundedExecutor,
  readBoundedFormData,
  RESOURCE_LIMITS,
  ResourceBoundaryError,
  validateImageMetadata,
} from "@/lib/resource-limits.mjs";

export const runtime = "nodejs";
const supported=new Set(["jpeg","png","webp","heif"]);
const mediaExecutor=createBoundedExecutor({concurrency:RESOURCE_LIMITS.mediaConcurrency,queueDepth:RESOURCE_LIMITS.mediaQueueDepth});

export async function POST(request:Request) {
  if (!hasTrustedOrigin(request)) return NextResponse.json({ error: "Недопустимый источник запроса." }, { status: 403 });
  const supabase=await createSupabaseServerClient(); const {data:{user}}=await supabase.auth.getUser();
  if(!user) return NextResponse.json({error:"Войдите или зарегистрируйтесь, чтобы загрузить фотографию."},{status:401});
  let form: FormData;
  try {
    assertResourceRuntimeConfigured();
    form=await readBoundedFormData(request,{maximumBytes:RESOURCE_LIMITS.mediaMultipartBytes,maximumFields:2});
  } catch(reason) {
    const status=reason instanceof ResourceBoundaryError?reason.status:400;
    return NextResponse.json({error:status===413?"Размер запроса превышает допустимый предел.":"Не удалось прочитать изображение."},{status});
  }
  if([...form.keys()].some((key)=>key!=="file"&&key!=="kind")||form.getAll("file").length!==1||form.getAll("kind").length!==1){
    return NextResponse.json({error:"Не удалось прочитать изображение."},{status:400});
  }
  const file=form.get("file"); const kind=form.get("kind");
  if(!(file instanceof File) || !["avatar","gallery"].includes(String(kind))) return NextResponse.json({error:"Не удалось прочитать изображение."},{status:400});
  if(file.size===0 || file.size>RESOURCE_LIMITS.mediaFileBytes) return NextResponse.json({error:"Размер исходного файла не должен превышать 12 МБ."},{status:413});
  try {
    const input=Buffer.from(await file.arrayBuffer());
    const {output,meta,avatar}=await mediaExecutor.run(async()=>{
      const source=sharp(input,{limitInputPixels:RESOURCE_LIMITS.imagePixels,failOn:"error"}).timeout({seconds:RESOURCE_LIMITS.imageProcessingSeconds}).rotate();
      const metadata=await source.metadata();
      if(!metadata.format||!supported.has(metadata.format)||!validateImageMetadata(metadata)) throw new ResourceBoundaryError("media_rejected",415);
      const isAvatar=kind === "avatar";
      const processed=isAvatar
        ? await source.resize(512,512,{fit:"fill"}).webp({quality:84,smartSubsample:true}).toBuffer()
        : await source.resize({width:1800,height:1800,fit:"inside",withoutEnlargement:true}).webp({quality:84,smartSubsample:true}).toBuffer();
      if(processed.length===0||processed.length>RESOURCE_LIMITS.mediaOutputBytes) throw new ResourceBoundaryError("media_output_too_large",413);
      const verified=await sharp(processed,{limitInputPixels:RESOURCE_LIMITS.imagePixels,failOn:"error"}).metadata();
      if(verified.format!=="webp"||!validateImageMetadata(verified)) throw new ResourceBoundaryError("media_rejected",415);
      return {output:processed,meta:metadata,avatar:isAvatar};
    });
    const path=`submissions/${user.id}/${avatar?"avatar":"gallery"}/${crypto.randomUUID()}.webp`;
    const admin=createSupabaseAdminClient();
    const {error}=await admin.storage.from("profile-media").upload(path,output,{contentType:"image/webp",cacheControl:"0",upsert:false});
    if(error) throw error;
    const digest=createHash("sha256").update(output).digest("hex");
    const registered=await admin.rpc("register_submission_media_v1",{p_owner_id:user.id,p_object_path:path,p_sha256:digest,p_byte_count:output.byteLength});
    if(registered.error||registered.data!==true) throw new Error("submission provenance registration failed");
    return NextResponse.json({path,width:avatar?512:Math.min(meta.width??1800,1800),height:avatar?512:Math.min(meta.height??1800,1800),bytes:output.byteLength,format:"webp"},{status:201});
  } catch(reason) {
    const status=reason instanceof ResourceBoundaryError?reason.status:422;
    return NextResponse.json({error:status===503?"Обработка изображений временно недоступна.":"Не удалось безопасно обработать изображение. Выберите другой файл."},{status});
  }
}
