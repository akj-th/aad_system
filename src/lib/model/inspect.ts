// glb 사전 검사. Cesium은 glTF 노드 계층을 재귀로 순회하므로 계층이 깊거나
// 순환 참조가 있으면 렌더 중 "Maximum call stack size exceeded"로 렌더 루프가 죽는다.
// 업로드 전에 구조를 읽어 위험을 미리 알린다.

export interface GlbReport {
  ok: boolean;
  /** 치명적 — 로드하면 렌더가 멈출 가능성이 높다 */
  fatal: string[];
  /** 경고 — 로드는 되지만 무겁다 */
  warnings: string[];
  stats: {
    fileMB: number;
    nodes: number;
    meshes: number;
    primitives: number;
    materials: number;
    images: number;
    /** 노드 계층 최대 깊이 */
    maxDepth: number;
    hasCycle: boolean;
    extensions: string[];
    generator?: string;
  };
}

// 한계값은 실측 기준. 조각 51,853개 / 노드 8,073개 / 100MB 모델에서
// Cesium이 로딩 중 "Maximum call stack size exceeded"로 렌더 루프를 멈췄다.
// 원인은 계층 깊이가 아니라 한 번에 처리하는 조각 수다.
const DEPTH_FATAL = 400;
const DEPTH_WARN = 80;
const PRIM_FATAL = 20_000;
const PRIM_WARN = 5_000;
const NODE_FATAL = 5_000;
const NODE_WARN = 1_500;
const SIZE_FATAL = 80;
const SIZE_WARN = 30;

interface GltfJson {
  asset?: { generator?: string };
  nodes?: { children?: number[]; mesh?: number }[];
  meshes?: { primitives?: unknown[] }[];
  materials?: unknown[];
  images?: unknown[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
  extensionsUsed?: string[];
}

/** glb 컨테이너에서 JSON 청크를 꺼낸다 (.gltf면 그대로 파싱) */
export function extractGltfJson(buffer: ArrayBuffer, isGlb: boolean): GltfJson | null {
  try {
    if (!isGlb) {
      return JSON.parse(new TextDecoder().decode(buffer)) as GltfJson;
    }
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67) return null; // 'glTF'
    let offset = 12;
    while (offset + 8 <= buffer.byteLength) {
      const chunkLength = view.getUint32(offset, true);
      const chunkType = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (chunkType === 0x4e4f534a) {
        // 'JSON'
        return JSON.parse(
          new TextDecoder().decode(new Uint8Array(buffer, start, chunkLength)),
        ) as GltfJson;
      }
      offset = start + chunkLength;
    }
    return null;
  } catch {
    return null;
  }
}

/** 노드 계층의 최대 깊이와 순환 여부 (반복 기반 — 여기서 스택이 터지면 안 된다) */
function analyzeHierarchy(nodes: NonNullable<GltfJson["nodes"]>, roots: number[]) {
  let maxDepth = 0;
  let hasCycle = false;
  // 방문 중(path) 집합으로 순환 감지, 명시적 스택으로 반복 순회
  const state = new Uint8Array(nodes.length); // 0=미방문 1=방문중 2=완료
  for (const root of roots) {
    const stack: { i: number; depth: number; phase: 0 | 1 }[] = [
      { i: root, depth: 1, phase: 0 },
    ];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.i < 0 || top.i >= nodes.length) {
        stack.pop();
        continue;
      }
      if (top.phase === 0) {
        if (state[top.i] === 1) {
          hasCycle = true;
          stack.pop();
          continue;
        }
        state[top.i] = 1;
        top.phase = 1;
        maxDepth = Math.max(maxDepth, top.depth);
        const children = nodes[top.i].children ?? [];
        for (const c of children) stack.push({ i: c, depth: top.depth + 1, phase: 0 });
      } else {
        state[top.i] = 2;
        stack.pop();
      }
      // 폭주 방지 — 비정상 구조에서 무한 루프를 막는다
      if (stack.length > 100_000) {
        hasCycle = true;
        break;
      }
    }
  }
  return { maxDepth, hasCycle };
}

export function inspectGlb(buffer: ArrayBuffer, fileName: string): GlbReport {
  const fileMB = buffer.byteLength / 1024 / 1024;
  const fatal: string[] = [];
  const warnings: string[] = [];
  const isGlb = /\.glb$/i.test(fileName);
  const json = extractGltfJson(buffer, isGlb);

  if (!json) {
    return {
      ok: false,
      fatal: ["glTF 데이터를 읽을 수 없습니다 (손상되었거나 지원하지 않는 형식)"],
      warnings: [],
      stats: {
        fileMB, nodes: 0, meshes: 0, primitives: 0, materials: 0, images: 0,
        maxDepth: 0, hasCycle: false, extensions: [],
      },
    };
  }

  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  const primitives = meshes.reduce((n, m) => n + (m.primitives?.length ?? 0), 0);
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  const { maxDepth, hasCycle } = analyzeHierarchy(nodes, roots);
  const extensions = json.extensionsUsed ?? [];

  if (hasCycle) {
    fatal.push("노드 계층에 순환 참조가 있습니다 — 렌더 중 무한 재귀로 지도가 멈춥니다");
  }
  if (maxDepth >= DEPTH_FATAL) {
    fatal.push(
      `노드 계층이 ${maxDepth}단으로 너무 깊습니다 (한계 ${DEPTH_FATAL}단) — 렌더 중 스택 오버플로가 발생합니다`,
    );
  } else if (maxDepth >= DEPTH_WARN) {
    warnings.push(`노드 계층이 ${maxDepth}단으로 깊습니다 — 성능 저하나 렌더 오류가 날 수 있습니다`);
  }
  const n = (v: number) => v.toLocaleString("ko-KR");
  if (primitives >= PRIM_FATAL) {
    fatal.push(
      `메시 조각이 ${n(primitives)}개입니다 (한계 ${n(PRIM_FATAL)}개) — 로딩 중 스택 오버플로로 지도가 멈춥니다. 재질별 병합이 필요합니다`,
    );
  } else if (primitives >= PRIM_WARN) {
    warnings.push(`메시 조각이 ${n(primitives)}개입니다 — 병합하면 훨씬 가벼워집니다`);
  }
  if (nodes.length >= NODE_FATAL) {
    fatal.push(`노드가 ${n(nodes.length)}개입니다 (한계 ${n(NODE_FATAL)}개) — 병합 후 내보내세요`);
  } else if (nodes.length >= NODE_WARN) {
    warnings.push(`노드가 ${n(nodes.length)}개로 많습니다 — 로딩이 느립니다`);
  }
  if (fileMB >= SIZE_FATAL) {
    fatal.push(`파일이 ${fileMB.toFixed(0)}MB입니다 (권장 ${SIZE_FATAL}MB 미만) — 브라우저 메모리가 부족할 수 있습니다`);
  } else if (fileMB >= SIZE_WARN) {
    warnings.push(`파일이 ${fileMB.toFixed(0)}MB로 큽니다 — 로딩이 오래 걸립니다`);
  }
  const unsupported = extensions.filter((e) => e === "KHR_draco_mesh_compression");
  if (unsupported.length) {
    warnings.push(`압축 확장(${unsupported.join(", ")}) 사용 — 브이월드 Cesium 버전에 따라 안 열릴 수 있습니다`);
  }

  return {
    ok: fatal.length === 0,
    fatal,
    warnings,
    stats: {
      fileMB,
      nodes: nodes.length,
      meshes: meshes.length,
      primitives,
      materials: json.materials?.length ?? 0,
      images: json.images?.length ?? 0,
      maxDepth,
      hasCycle,
      extensions,
      generator: json.asset?.generator,
    },
  };
}
