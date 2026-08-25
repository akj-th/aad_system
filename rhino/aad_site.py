# -*- coding: utf-8 -*-
"""
AAD Site Import — 브이월드 대지 컨텍스트를 라이노로 가져오기

Rhino 7 (IronPython 2.7) 기준. _RunPythonScript 로 실행한다.
데이터는 AAD 서버(Next.js)를 경유해 받는다 — API 키는 서버에만 있고
플러그인에는 들어가지 않는다 (CLAUDE.md 절대 규칙).

가져오는 것
  - 필지 경계 폴리라인 (대상 필지 / 주변 필지 레이어 분리)
  - 항공사진 (타일 합성 → PictureFrame)
  - 대지 정보 텍스트 (용도지역·면적·건폐율·용적률)

좌표계
  대지 중심을 원점으로 하는 로컬 미터 좌표 (등장방형 근사).
  웹 앱의 lib/map/draw.ts 와 같은 방식이라 두 도구가 좌표를 공유한다.
  EarthAnchorPoint 도 함께 설정해 지리 좌표를 유지한다.
"""

import json
import math
import os
import tempfile
import threading

import Rhino
import rhinoscriptsyntax as rs
import scriptcontext as sc
import System
from System.Net import WebClient
from System.Drawing import Bitmap, Graphics, Rectangle

SERVER = os.environ.get("AAD_SERVER", "http://localhost:3000")

# 반경(m)과 항공사진 줌을 묶어둔다 — 조합을 잘못 골라 라이노가 터지는 것을 막는다.
# 실측(압구정): 500m 반경 필지 539개·정점 5,328개는 가볍지만,
# 500m를 z20으로 깔면 타일 1,156장·8704px(289MB)로 감당이 안 된다.
PRESETS = [
    {"name": "대상지 (100m, 최고화질)", "radius": 100, "zoom": 20},
    {"name": "근린 (300m, 고화질)", "radius": 300, "zoom": 19},
    {"name": "광역 (500m, 표준)", "radius": 500, "zoom": 18},
    {"name": "필지선만 (300m, 항공사진 없음)", "radius": 300, "zoom": 0},
]

MAX_TILES = 200  # 이보다 많으면 줌을 낮춘다
LAYERS = {
    "site": "AAD::대상필지",
    "parcels": "AAD::주변필지",
    "photo": "AAD::항공사진",
    "info": "AAD::대지정보",
}


# --- HTTP -------------------------------------------------------------------

def get_json(path):
    """서버에서 JSON 받기. IronPython 2.7 에는 requests 가 없어 .NET WebClient 를 쓴다."""
    client = WebClient()
    client.Encoding = System.Text.Encoding.UTF8
    try:
        text = client.DownloadString(SERVER + path)
    finally:
        client.Dispose()
    return json.loads(text)


def download_tile(url, index, results):
    client = WebClient()
    try:
        results[index] = client.DownloadData(url)
    except Exception:
        results[index] = None
    finally:
        client.Dispose()


# --- 좌표 변환 ---------------------------------------------------------------

class Frame(object):
    """대지 중심을 원점으로 하는 로컬 미터 좌표계"""

    def __init__(self, lon, lat):
        self.lon0 = lon
        self.lat0 = lat
        self.kx = 111320.0 * math.cos(math.radians(lat))
        self.ky = 111320.0

    def to_local(self, lon, lat):
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)


# --- 타일 -------------------------------------------------------------------

def deg2tile(lon, lat, z):
    n = 2.0 ** z
    x = int((lon + 180.0) / 360.0 * n)
    rad = math.radians(lat)
    y = int((1.0 - math.log(math.tan(rad) + 1.0 / math.cos(rad)) / math.pi) / 2.0 * n)
    return x, y


def tile2deg(x, y, z):
    """타일 좌상단 경위도"""
    n = 2.0 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


def build_aerial(frame, radius, zoom):
    """항공사진 타일을 받아 한 장으로 합성하고 (파일경로, 로컬좌표 범위) 를 돌려준다"""
    dlon = radius / frame.kx
    dlat = radius / frame.ky
    x0, y0 = deg2tile(frame.lon0 - dlon, frame.lat0 + dlat, zoom)  # 좌상단
    x1, y1 = deg2tile(frame.lon0 + dlon, frame.lat0 - dlat, zoom)  # 우하단
    cols = x1 - x0 + 1
    rows = y1 - y0 + 1
    total = cols * rows
    if total > MAX_TILES:
        return None, None, "타일 %d장 — 상한(%d) 초과" % (total, MAX_TILES)

    urls = []
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            urls.append("%s/api/vworld/tile/Satellite/%d/%d/%d" % (SERVER, zoom, ty, tx))

    # 병렬로 받는다 — 타일 1장이 왕복 0.6초라 순차로 받으면 121장에 80초가 걸린다
    results = [None] * len(urls)
    batch = 12
    for start in range(0, len(urls), batch):
        threads = []
        for i in range(start, min(start + batch, len(urls))):
            t = threading.Thread(target=download_tile, args=(urls[i], i, results))
            t.start()
            threads.append(t)
        for t in threads:
            t.join()

    bitmap = Bitmap(cols * 256, rows * 256)
    graphics = Graphics.FromImage(bitmap)
    idx = 0
    ok = 0
    for row in range(rows):
        for col in range(cols):
            data = results[idx]
            idx += 1
            if not data:
                continue
            stream = System.IO.MemoryStream(data)
            try:
                tile = Bitmap(stream)
                graphics.DrawImage(tile, Rectangle(col * 256, row * 256, 256, 256))
                ok += 1
            except Exception:
                pass
            finally:
                stream.Dispose()
    graphics.Dispose()

    path = os.path.join(tempfile.gettempdir(), "aad_aerial_%d.png" % System.Environment.TickCount)
    bitmap.Save(path, System.Drawing.Imaging.ImageFormat.Png)
    bitmap.Dispose()

    # 합성 이미지의 지리 범위 → 로컬 미터
    nw_lon, nw_lat = tile2deg(x0, y0, zoom)
    se_lon, se_lat = tile2deg(x1 + 1, y1 + 1, zoom)
    p0 = frame.to_local(nw_lon, se_lat)  # 좌하단
    p1 = frame.to_local(se_lon, nw_lat)  # 우상단
    return path, (p0, p1), "타일 %d/%d장" % (ok, total)


# --- 라이노 객체 생성 ---------------------------------------------------------

def ensure_layer(name, color):
    if not rs.IsLayer(name):
        rs.AddLayer(name, color)
    return name


def add_parcel_curves(features, frame, target_pnu, radius):
    """
    필지 경계를 폴리라인으로. 대상 필지는 별도 레이어로 강조한다.

    도로·하천 필지는 수 km로 길게 이어져 있어 bbox에 조금만 걸쳐도 통째로 딸려온다
    (실측: 반경 300m 요청에 2,441m 도로 필지가 들어와 도면 범위가 4배로 늘어남).
    요청 반경에 비해 지나치게 큰 필지는 건너뛴다.
    """
    ensure_layer(LAYERS["parcels"], (120, 120, 120))
    ensure_layer(LAYERS["site"], (255, 120, 0))
    max_span = radius * 1.5
    count = 0
    skipped = 0
    for feature in features:
        props = feature.get("properties", {})
        geom = feature.get("geometry", {})
        polys = (
            [geom.get("coordinates", [])]
            if geom.get("type") == "Polygon"
            else geom.get("coordinates", [])
        )
        is_target = target_pnu and props.get("pnu") == target_pnu

        if not is_target:
            xs, ys = [], []
            for rings in polys:
                for ring in rings:
                    for pair in ring:
                        x, y = frame.to_local(pair[0], pair[1])
                        xs.append(x)
                        ys.append(y)
            if xs and max(max(xs) - min(xs), max(ys) - min(ys)) > max_span:
                skipped += 1
                continue

        rs.CurrentLayer(LAYERS["site"] if is_target else LAYERS["parcels"])
        for rings in polys:
            for ring in rings:
                pts = []
                for pair in ring:
                    x, y = frame.to_local(pair[0], pair[1])
                    pts.append((x, y, 0))
                if len(pts) < 3:
                    continue
                if pts[0] != pts[-1]:
                    pts.append(pts[0])
                curve = rs.AddPolyline(pts)
                if curve:
                    count += 1
                    if props.get("jibun"):
                        rs.SetUserText(curve, "jibun", props["jibun"])
                    if props.get("pnu"):
                        rs.SetUserText(curve, "pnu", props["pnu"])
    return count, skipped


def add_aerial(path, extent):
    """합성 항공사진을 바닥에 PictureFrame 으로 깐다"""
    ensure_layer(LAYERS["photo"], (200, 200, 200))
    rs.CurrentLayer(LAYERS["photo"])
    (x0, y0), (x1, y1) = extent
    # 필지선보다 살짝 아래에 둬서 선이 가리지 않게 한다
    plane = Rhino.Geometry.Plane(
        Rhino.Geometry.Point3d(x0, y0, -0.05),
        Rhino.Geometry.Vector3d.XAxis,
        Rhino.Geometry.Vector3d.YAxis,
    )
    return sc.doc.Objects.AddPictureFrame(
        plane, path, False, abs(x1 - x0), abs(y1 - y0), False, False
    )


def add_info_text(lines, frame_radius):
    ensure_layer(LAYERS["info"], (0, 0, 0))
    rs.CurrentLayer(LAYERS["info"])
    height = max(1.5, frame_radius * 0.02)
    y = frame_radius * 0.9
    ids = []
    for line in lines:
        ids.append(rs.AddText(line, (-frame_radius * 0.95, y, 0), height))
        y -= height * 1.6
    return ids


def set_earth_anchor(lon, lat):
    """지리 좌표 유지 — 나중에 다른 지리 데이터를 겹칠 때 기준이 된다"""
    anchor = Rhino.DocObjects.EarthAnchorPoint()
    anchor.EarthBasepointLatitude = lat
    anchor.EarthBasepointLongitude = lon
    anchor.EarthBasepointElevation = 0.0
    anchor.ModelBasePoint = Rhino.Geometry.Point3d(0, 0, 0)
    anchor.ModelNorth = Rhino.Geometry.Vector3d(0, 1, 0)
    anchor.ModelEast = Rhino.Geometry.Vector3d(1, 0, 0)
    sc.doc.EarthAnchorPoint = anchor


# --- 메인 -------------------------------------------------------------------

def run(address=None, preset_index=None):
    # 1) 주소 검색
    if address is None:
        address = rs.GetString("대지 주소 또는 지번 (예: 압구정로29길 17)")
    if not address:
        return

    try:
        found = get_json("/api/vworld/search?q=" + System.Uri.EscapeDataString(address))
    except Exception as e:
        rs.MessageBox("서버에 연결할 수 없습니다.\n%s\n\n%s" % (SERVER, e), 16)
        return
    items = found.get("items", [])
    if not items:
        rs.MessageBox("검색 결과가 없습니다: %s" % address, 48)
        return

    if len(items) == 1 or preset_index is not None:
        picked = items[0]
    else:
        labels = [it.get("title") or it.get("parcelAddr") for it in items]
        chosen = rs.ListBox(labels, "대지를 선택하세요", "AAD Site")
        if not chosen:
            return
        picked = items[labels.index(chosen)]

    lon = float(picked["lon"])
    lat = float(picked["lat"])

    # 2) 프리셋
    if preset_index is None:
        names = [p["name"] for p in PRESETS]
        chosen = rs.ListBox(names, "가져올 범위와 화질", "AAD Site")
        if not chosen:
            return
        preset = PRESETS[names.index(chosen)]
    else:
        preset = PRESETS[preset_index]
    radius = preset["radius"]
    zoom = preset["zoom"]

    frame = Frame(lon, lat)
    dlon = radius / frame.kx
    dlat = radius / frame.ky
    bbox = "%f,%f,%f,%f" % (lon - dlon, lat - dlat, lon + dlon, lat + dlat)

    # 3) 필지
    try:
        fc = get_json("/api/vworld/parcels?bbox=" + bbox)
    except Exception as e:
        rs.MessageBox("필지 조회 실패\n%s" % e, 16)
        return
    features = fc.get("features", [])

    # 대상 필지 = 검색 좌표를 품은 필지
    target_pnu = None
    try:
        one = get_json("/api/vworld/parcel?lon=%f&lat=%f" % (lon, lat))
        if one.get("parcel"):
            target_pnu = one["parcel"].get("pnu")
    except Exception:
        pass

    rs.EnableRedraw(False)
    prev_layer = rs.CurrentLayer()
    try:
        set_earth_anchor(lon, lat)
        curve_count, skipped = add_parcel_curves(features, frame, target_pnu, radius)

        # 4) 항공사진
        tile_note = "생략"
        if zoom > 0:
            path, extent, tile_note = build_aerial(frame, radius, zoom)
            if path:
                add_aerial(path, extent)

        # 5) 대지 정보
        info_lines = [u"AAD 대지 컨텍스트", picked.get("title", address)]
        if target_pnu:
            try:
                land = get_json("/api/vworld/landinfo?pnu=" + target_pnu).get("landInfo", {})
                if land.get("useZone"):
                    info_lines.append(u"용도지역: %s" % land["useZone"])
                if land.get("officialArea"):
                    info_lines.append(u"대지면적: %s m2 (공부)" % land["officialArea"])
                if land.get("roadSide"):
                    info_lines.append(u"도로접면: %s / 지형: %s" % (land.get("roadSide"), land.get("terrain")))
                for b in (land.get("buildings") or [])[:1]:
                    info_lines.append(
                        u"기존건축물: %s %s 지상%s층" % (b.get("mainUse"), b.get("structure"), b.get("groundFloors"))
                    )
            except Exception:
                pass
        info_lines.append(
            u"반경 %dm · 필지 %d개%s · 항공사진 %s"
            % (radius, len(features) - skipped, (u" (대형 %d개 제외)" % skipped) if skipped else u"", tile_note)
        )
        info_lines.append(u"참고용 — 최종 확인은 담당 건축사 책임")
        add_info_text(info_lines, radius)
    finally:
        rs.CurrentLayer(prev_layer)
        rs.EnableRedraw(True)

    # 대상 필지가 화면 중앙에 오도록 — 전체 ZoomExtents 는 외곽 필지 때문에 너무 넓어진다
    site_objs = rs.ObjectsByLayer(LAYERS["site"])
    if site_objs:
        rs.ZoomBoundingBox(rs.BoundingBox(site_objs), None, True)
        rs.Command("_Zoom _Out _Enter", False)
        rs.Command("_Zoom _Out _Enter", False)
    else:
        rs.ZoomExtents()
    print(
        "AAD: 필지 %d개(대형 %d개 제외) · 폴리라인 %d개 · %s"
        % (len(features) - skipped, skipped, curve_count, tile_note)
    )


if __name__ == "__main__":
    # 자동 테스트용 진입점 (환경변수로 대화 없이 실행)
    test_addr = os.environ.get("AAD_TEST_ADDRESS")
    if test_addr:
        run(test_addr, int(os.environ.get("AAD_TEST_PRESET", "1")))
    else:
        run()
