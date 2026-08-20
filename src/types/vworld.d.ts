// 브이월드 웹지엘 3D지도 API 3.0 전역 타입 선언.
// 공식 샘플(V-world/V-world_API_sample)에서 확인된 표면만 최소로 선언한다.
// 스크립트: https://map.vworld.kr/js/webglMapInit.js.do?version=3.0&apiKey=...

declare namespace vw {
  class CoordZ {
    constructor(longitude: number, latitude: number, altitude: number)
  }

  class Direction {
    constructor(heading: number, tilt: number, roll: number)
  }

  class CameraPosition {
    constructor(coord: CoordZ, direction: Direction)
  }

  interface MapOptions {
    mapId: string
    initPosition: CameraPosition
    logo?: boolean
    navigation?: boolean
  }

  class Map {
    setOption(options: MapOptions): void
    setMapId(containerId: string): void
    setInitPosition(position: CameraPosition): void
    setNavigationZoomVisible(visible: boolean): void
    start(): void
  }

  /** 3D 엔진 초기화 완료 시 호출되는 콜백 (샘플에서 확인) */
  let ws3dInitCallBack: (() => void) | undefined
}

// 내부 Cesium 뷰어 접근용 전역 (샘플: ws3d.viewer, 전역 Cesium).
// 브이월드가 번들한 Cesium이라 공식 타입 패키지와 버전이 안 맞을 수 있어 any로 둔다.
declare const ws3d: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewer: any
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Cesium: any
