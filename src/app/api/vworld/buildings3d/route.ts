// 브이월드 3D 건물(b3dm)을 대지 중심 로컬 좌표로 변환해 내려준다.
// 건축물대장 높이로 압출한 매스와 달리 형태·재질이 실제 데이터다.
//
// format=obj (기본): OBJ + MTL + 텍스처 zip — Rhino 7 은 glTF 가져오기를 지원하지 않는다
//                    (내보내기만 가능. 가져오기는 Rhino 8부터)
// format=glb:        glb 그대로 — Rhino 8·블렌더 등

import { buildLocalDocument, documentToGlb, findBuildingTiles } from "@/lib/server/tiles3d";
import { documentToObjZip } from "@/lib/server/gltfToObj";
import { documentTo3dmZip } from "@/lib/server/gltfTo3dm";

// 타일 수십 개 다운로드 + Draco 디코딩 + 변환
export const maxDuration = 180;

// probe(타일 세기)는 tileset JSON 만 읽으므로 상한을 넉넉히 둔다.
// 실제 변환은 타일마다 b3dm 다운로드 + Draco 디코딩이 붙는다.
const MAX_TILES = 1200;

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const bbox = (sp.get("bbox") ?? "").split(",").map(Number);
  if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) {
    return Response.json({ error: "bbox=minLon,minLat,maxLon,maxLat required" }, { status: 400 });
  }
  const [west, south, east, north] = bbox as [number, number, number, number];
  const detail = Math.max(0, Math.min(80, Number(sp.get("detail") ?? "5")));
  const maxTiles = Math.max(1, Math.min(MAX_TILES, parseInt(sp.get("maxTiles") ?? "40", 10) || 40));
  const originLon = Number(sp.get("lon") ?? (west + east) / 2);
  const originLat = Number(sp.get("lat") ?? (south + north) / 2);
  // textures=0 이면 단색 매스로 받는다 (재질 1개 — 라이노가 훨씬 빨리 연다)
  const plain = sp.get("textures") === "0";
  const requested = sp.get("format");
  // 3dm 이 기본 — Rhino 7 은 glTF 가져오기를 못 하고 OBJ 는 모달 대화상자를 띄운다
  const format: "3dm" | "obj" | "glb" =
    requested === "glb" ? "glb" : requested === "obj" ? "obj" : "3dm";

  try {
    const tiles = await findBuildingTiles([west, south, east, north], detail, maxTiles);
    if (!tiles.length) {
      return Response.json(
        { error: "이 범위에는 브이월드 3D 건물 데이터가 없습니다", tiles: 0 },
        { status: 404 },
      );
    }
    if (sp.get("probe") === "1") {
      return Response.json({
        tiles: tiles.length,
        geometricErrors: [...new Set(tiles.map((t) => t.geometricError))].sort((a, b) => a - b),
      });
    }

    const { doc, merged, failed } = await buildLocalDocument(tiles, originLon, originLat);
    if (!doc) {
      return Response.json({ error: "타일을 변환하지 못했습니다", tiles: tiles.length }, { status: 502 });
    }

    if (format === "glb") {
      const glb = await documentToGlb(doc);
      return new Response(new Uint8Array(glb), {
        headers: {
          "Content-Type": "model/gltf-binary",
          "Content-Disposition": 'attachment; filename="vworld_buildings.glb"',
          "X-Tiles-Found": String(tiles.length),
          "X-Tiles-Merged": String(merged),
          "Cache-Control": "no-store",
        },
      });
    }

    const { zip, stats } =
      format === "3dm"
        ? await documentTo3dmZip(doc, "vworld_buildings", { plain })
        : await documentToObjZip(doc);
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="vworld_buildings_${format}.zip"`,
        "X-Format": format,
        "X-Tiles-Found": String(tiles.length),
        "X-Tiles-Merged": String(merged),
        "X-Tiles-Failed": String(failed),
        "X-Vertices": String(stats.vertices),
        "X-Faces": String(stats.faces),
        "X-Textures": String(stats.textures),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "3D 건물 변환 실패" },
      { status: 502 },
    );
  }
}
