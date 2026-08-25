// glTF Document → Rhino .3dm (rhino3dm)
//
// Rhino 7 은 glTF 가져오기를 지원하지 않고, OBJ 가져오기는 스크립트로 억제할 수 없는
// 모달 대화상자를 띄운다. 네이티브 .3dm 으로 주면 대화상자 없이 바로 열린다.
//
// 텍스처는 3dm 안에 포함하지 않고 옆에 PNG 로 풀어 두고 재질에서 상대경로로 참조한다
// (rhino3dm 의 임베드 지원이 제한적이다).

import type { Document } from "@gltf-transform/core";
import { flatten, dequantize, unpartition } from "@gltf-transform/functions";
import JSZip from "jszip";
import rhino3dm from "rhino3dm";

/** 4×4 column-major 행렬 곱 */
function multiply(a: number[], b: number[]): number[] {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function applyMatrix(m: number[], x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

export interface Rhino3dmResult {
  zip: Uint8Array;
  stats: { meshes: number; vertices: number; faces: number; textures: number };
}

export async function documentTo3dmZip(
  doc: Document,
  name = "vworld_buildings",
): Promise<Rhino3dmResult> {
  await doc.transform(dequantize(), flatten(), unpartition());

  const rh = await rhino3dm();
  const file = new rh.File3dm();
  file.settings().modelUnitSystem = rh.UnitSystem.Meters;

  const zip = new JSZip();
  const textureFiles = new Map<unknown, string>();
  const materialIndexes = new Map<unknown, number>();
  let meshCount = 0;
  let vertexCount = 0;
  let faceCount = 0;

  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error("씬이 없습니다");

  const walk = (node: ReturnType<typeof scene.listChildren>[number], parent: number[] | null) => {
    const world = parent ? multiply(parent, node.getMatrix() as number[]) : (node.getMatrix() as number[]);
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const position = prim.getAttribute("POSITION");
        if (!position) continue;
        const posArray = position.getArray();
        if (!posArray) continue;
        const uvArray = prim.getAttribute("TEXCOORD_0")?.getArray();
        const indices = prim.getIndices()?.getArray();
        const count = position.getCount();

        const rhMesh = new rh.Mesh();
        const verts = rhMesh.vertices();
        for (let i = 0; i < count; i++) {
          const [x, y, z] = applyMatrix(world, posArray[i * 3], posArray[i * 3 + 1], posArray[i * 3 + 2]);
          verts.add(x, y, z);
        }
        if (uvArray) {
          const tc = rhMesh.textureCoordinates();
          for (let i = 0; i < count; i++) {
            // glTF 와 Rhino 의 v 축 방향이 반대다
            tc.add(uvArray[i * 2], 1 - uvArray[i * 2 + 1]);
          }
        }
        const faces = rhMesh.faces();
        const triCount = indices ? indices.length / 3 : count / 3;
        for (let t = 0; t < triCount; t++) {
          const a = indices ? indices[t * 3] : t * 3;
          const b = indices ? indices[t * 3 + 1] : t * 3 + 1;
          const c = indices ? indices[t * 3 + 2] : t * 3 + 2;
          faces.addTriFace(a, b, c);
        }
        rhMesh.normals().computeNormals();
        rhMesh.compact();

        // 재질 — 텍스처는 zip 안에 PNG 로 두고 상대경로로 참조한다
        const material = prim.getMaterial();
        let matIndex = -1;
        if (material) {
          if (!materialIndexes.has(material)) {
            const rhMat = new rh.Material();
            rhMat.name = `mat_${materialIndexes.size}`;
            const base = material.getBaseColorTexture();
            if (base) {
              if (!textureFiles.has(base)) {
                const image = base.getImage();
                if (image) {
                  const mime = base.getMimeType() ?? "image/png";
                  const ext = mime.includes("jpeg") ? "jpg" : "png";
                  const fileName = `tex_${textureFiles.size}.${ext}`;
                  textureFiles.set(base, fileName);
                  zip.file(fileName, image);
                }
              }
              const fileName = textureFiles.get(base);
              // 텍스처는 3dm 옆에 풀리므로 파일명만 상대경로로 넣는다
              if (fileName) rhMat.setBitmapTextureFilename(fileName);
            } else {
              const c = material.getBaseColorFactor();
              rhMat.diffuseColor = [
                Math.round(c[0] * 255),
                Math.round(c[1] * 255),
                Math.round(c[2] * 255),
                255,
              ];
            }
            file.materials().add(rhMat);
            materialIndexes.set(material, materialIndexes.size);
          }
          matIndex = materialIndexes.get(material)!;
        }

        const attrs = new rh.ObjectAttributes();
        attrs.name = node.getName() || "building";
        if (matIndex >= 0) {
          attrs.materialIndex = matIndex;
          attrs.materialSource = rh.ObjectMaterialSource.MaterialFromObject;
        }
        file.objects().add(rhMesh, attrs);
        meshCount++;
        vertexCount += count;
        faceCount += triCount;
      }
    }
    for (const child of node.listChildren()) walk(child, world);
  };

  for (const node of scene.listChildren()) walk(node, null);

  // 버전을 지정하지 않으면 최신 포맷으로 저장되어 Rhino 7 이 열지 못한다.
  // 6 으로 쓰면 Rhino 6·7·8 모두 읽는다.
  const options = new rh.File3dmWriteOptions();
  options.version = 6;
  const bytes = file.toByteArrayOptions(options);
  zip.file(`${name}.3dm`, bytes);
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return {
    zip: out,
    stats: { meshes: meshCount, vertices: vertexCount, faces: faceCount, textures: textureFiles.size },
  };
}
