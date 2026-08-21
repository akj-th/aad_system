// 2패스 캡처 (B-4 Phase 3). 같은 카메라에서 뷰티/실루엣 두 장을 뽑고
// 실루엣의 마젠타 영역을 임계값 처리해 건물 마스크를 만든다.
//
// Cesium 캔버스는 preserveDrawingBuffer 없이 생성되므로 toDataURL을 아무 때나
// 부르면 빈 이미지가 나온다. scene.postRender 콜백 안에서는 드로잉 버퍼가
// 아직 유효하므로 그 시점에 캡처한다 (B-4 기술 주의사항의 우회법).

import { getCameraPose, getViewer, type CameraPose } from "./controller";

const MODEL_ENTITY_ID = "aad-building-model";
const SITE_ENTITY_PREFIX = "aad-site-";
const MASS_ENTITY_PREFIX = "aad-mass";

export interface CaptureResult {
  camera: CameraPose;
  /** 캡처 당시 뷰어 시계(태양 위치 기준 시각), ISO */
  clockTime: string;
  beauty: string;
  silhouette: string;
  mask: string;
}

/**
 * n프레임 뒤 postRender 시점에 캔버스를 캡처한다.
 * 브이월드 뷰어는 requestRenderMode라서 (시계가 멈춰 있으면) 프레임이 저절로
 * 돌지 않는다 — 매 프레임 requestRender로 직접 렌더를 요청해야 한다.
 */
function captureAfterFrames(viewer: ReturnType<typeof getViewer>, frames: number): Promise<string> {
  // 엔티티 재질을 바꾸면 폴리곤 지오메트리가 워커에서 비동기로 다시 만들어진다 —
  // 최소 프레임 수를 채운 뒤에도 dataSourceDisplay.ready가 될 때까지(최대 120프레임) 기다린다.
  const MAX_EXTRA_FRAMES = 120;
  return new Promise((resolve) => {
    let remaining = frames;
    let extra = 0;
    const remove = viewer.scene.postRender.addEventListener(() => {
      remaining -= 1;
      const entitiesReady = viewer.dataSourceDisplay?.ready !== false;
      if (remaining > 0 || (!entitiesReady && extra++ < MAX_EXTRA_FRAMES)) {
        viewer.scene.requestRender();
        return;
      }
      remove();
      resolve(viewer.scene.canvas.toDataURL("image/png"));
    });
    viewer.scene.requestRender();
  });
}

interface SavedState {
  imagery: { layer: unknown; brightness: number; saturation: number }[];
  tilesetStyles: { tileset: { style: unknown }; style: unknown }[];
  hiddenEntities: { show: boolean; entity: { show: boolean } }[];
  /** 매스 압출 폴리곤(aad-mass-*)의 원래 재질 */
  massMaterials: { entity: { polygon: { material: unknown } }; material: unknown }[];
  modelColor: unknown;
  modelBlendMode: unknown;
  globeMaterial: unknown;
  light: unknown;
  shadowMapEnabled: boolean;
  enableLighting: boolean;
  globeShadows: unknown;
  skyAtmosphereShow: boolean | undefined;
  sunShow: boolean | undefined;
  moonShow: boolean | undefined;
  skyBoxShow: boolean | undefined;
}

function saveState(viewer: ReturnType<typeof getViewer>): SavedState {
  const scene = viewer.scene;
  const imagery: SavedState["imagery"] = [];
  for (let i = 0; i < viewer.imageryLayers.length; i++) {
    const layer = viewer.imageryLayers.get(i);
    imagery.push({ layer, brightness: layer.brightness, saturation: layer.saturation });
  }
  const tilesetStyles: SavedState["tilesetStyles"] = [];
  for (let i = 0; i < scene.primitives.length; i++) {
    const p = scene.primitives.get(i);
    if (p instanceof Cesium.Cesium3DTileset) {
      tilesetStyles.push({ tileset: p, style: p.style });
    }
  }
  const hiddenEntities: SavedState["hiddenEntities"] = [];
  const massMaterials: SavedState["massMaterials"] = [];
  for (const e of viewer.entities.values) {
    if (String(e.id).startsWith(SITE_ENTITY_PREFIX)) {
      hiddenEntities.push({ entity: e, show: e.show });
    } else if (String(e.id).startsWith(MASS_ENTITY_PREFIX)) {
      massMaterials.push({ entity: e, material: e.polygon.material });
    }
  }
  const model = viewer.entities.getById(MODEL_ENTITY_ID);
  return {
    imagery,
    tilesetStyles,
    hiddenEntities,
    massMaterials,
    modelColor: model?.model.color,
    modelBlendMode: model?.model.colorBlendMode,
    globeMaterial: scene.globe.material,
    light: scene.light,
    shadowMapEnabled: viewer.shadowMap.enabled,
    enableLighting: scene.globe.enableLighting,
    globeShadows: scene.globe.shadows,
    skyAtmosphereShow: scene.skyAtmosphere?.show,
    sunShow: scene.sun?.show,
    moonShow: scene.moon?.show,
    skyBoxShow: scene.skyBox?.show,
  };
}

function restoreState(viewer: ReturnType<typeof getViewer>, s: SavedState) {
  const scene = viewer.scene;
  for (const { layer, brightness, saturation } of s.imagery) {
    (layer as { brightness: number; saturation: number }).brightness = brightness;
    (layer as { brightness: number; saturation: number }).saturation = saturation;
  }
  for (const { tileset, style } of s.tilesetStyles) tileset.style = style;
  for (const { entity, show } of s.hiddenEntities) entity.show = show;
  for (const { entity, material } of s.massMaterials) entity.polygon.material = material;
  const model = viewer.entities.getById(MODEL_ENTITY_ID);
  if (model) {
    model.model.color = s.modelColor;
    model.model.colorBlendMode = s.modelBlendMode;
  }
  scene.globe.material = s.globeMaterial;
  scene.light = s.light;
  viewer.shadowMap.enabled = s.shadowMapEnabled;
  scene.globe.enableLighting = s.enableLighting;
  scene.globe.shadows = s.globeShadows;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = s.skyAtmosphereShow;
  if (scene.sun) scene.sun.show = s.sunShow;
  if (scene.moon) scene.moon.show = s.moonShow;
  if (scene.skyBox) scene.skyBox.show = s.skyBoxShow;
}

/** 실루엣(마젠타) → 건물 영역 불투명, 배경 투명 마스크 PNG */
async function buildMask(silhouetteDataUrl: string): Promise<string> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("silhouette image load failed"));
    img.src = silhouetteDataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    // 마젠타 판정: 조명 음영으로 어두워져도 R·B 우세는 유지된다
    const isBuilding = r > 60 && b > 60 && g < Math.min(r, b) * 0.5;
    if (isBuilding) {
      px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255;
    } else {
      px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0;
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}

export async function capture2Pass(): Promise<CaptureResult> {
  const viewer = getViewer();
  if (!viewer) throw new Error("viewer not ready");
  const model = viewer.entities.getById(MODEL_ENTITY_ID);
  const camera = getCameraPose()!;
  const clockTime = Cesium.JulianDate.toDate(viewer.clock.currentTime).toISOString();
  const scene = viewer.scene;
  const saved = saveState(viewer);
  if (!model && saved.massMaterials.length === 0) {
    throw new Error("건물 모델(glb) 또는 활성 매스 대안이 없습니다");
  }
  // 건물 = glb 모델 + 매스 압출체. 둘 다 같은 색으로 덮는다
  const paintBuilding = (color: unknown) => {
    if (model) {
      model.model.color = color;
      model.model.colorBlendMode = Cesium.ColorBlendMode.REPLACE;
    }
    for (const { entity } of saved.massMaterials) entity.polygon.material = color;
  };

  try {
    // 공통: 필지 하이라이트·등고선·명칭은 캡처에서 제외 (POI는 표시 옵션과 무관하게 숨김)
    for (const { entity } of saved.hiddenEntities) entity.show = false;
    scene.globe.material = undefined;
    const poiShown: { p: { show: boolean } }[] = [];
    for (let i = 0; i < scene.primitives.length; i++) {
      const p = scene.primitives.get(i);
      if (
        p instanceof Cesium.Cesium3DTileset &&
        String(p._url ?? "").includes("/TDServer/services/poi/") &&
        p.show
      ) {
        poiShown.push({ p });
        p.show = false;
      }
    }

    // --- A패스: 뷰티 — 건물 무광 흰색, 그림자 on, 지형 저채도 ---
    paintBuilding(Cesium.Color.WHITE);
    for (const { layer } of saved.imagery) {
      (layer as { saturation: number }).saturation = 0.25;
    }
    if (!(scene.light instanceof Cesium.SunLight)) {
      scene.light = new Cesium.SunLight();
    }
    viewer.shadowMap.enabled = true;
    viewer.shadowMap.size = 2048;
    scene.globe.enableLighting = true;
    scene.globe.shadows = Cesium.ShadowMode.RECEIVE_ONLY;

    const beauty = await captureAfterFrames(viewer, 4);

    // --- B패스: 실루엣 — 건물 마젠타, 나머지 어둡게, 그림자·조명 변수 제거 ---
    paintBuilding(Cesium.Color.MAGENTA);
    for (const { layer } of saved.imagery) {
      const l = layer as { brightness: number; saturation: number };
      l.brightness = 0.06;
      l.saturation = 0;
    }
    for (const { tileset } of saved.tilesetStyles) {
      tileset.style = new Cesium.Cesium3DTileStyle({ color: "color('#0b0b0b')" });
    }
    viewer.shadowMap.enabled = false;
    scene.globe.enableLighting = false;
    scene.globe.shadows = Cesium.ShadowMode.DISABLED;
    scene.light = saved.light;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    if (scene.skyBox) scene.skyBox.show = false;

    const silhouette = await captureAfterFrames(viewer, 4);

    for (const { p } of poiShown) p.show = true;

    const mask = await buildMask(silhouette);
    return { camera, clockTime, beauty, silhouette, mask };
  } finally {
    restoreState(viewer, saved);
  }
}
