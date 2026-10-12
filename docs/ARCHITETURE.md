# ARCHITETURE — Màn E-Ink PWA

Trạng thái: **2026-10-12** (sau Giai đoạn 0 + 1; chưa test trên thiết bị thật).
Quyết định kiến trúc được ghi ở các file `adr/ADR-<date>.md`; kế hoạch gốc ở [`plan/PLAN.md`](plan/PLAN.md).

## 1. Mục tiêu và ranh giới

PWA chạy trên Android Chrome (và Chrome desktop) để điều khiển màn e-ink 2.9" 296×128 đen/trắng/đỏ (AESL0290C, BLE `NRF_EPD_F636`) qua Web Bluetooth.

- **Một lần:** app đặt chế độ cho firmware (lịch, đồng hồ, đếm ngược, ảnh tĩnh), rồi ngắt kết nối. Màn tự chạy.
- **Liên tục:** miniapp lấy dữ liệu từ liên kết, render thành ảnh, app gửi ảnh tới màn. Khi dừng, trả màn về chế độ trước đó.
- Không có backend. Mọi key, token và cấu hình lưu trong IndexedDB trên máy.
- **Firmware không thuộc repo này.** Dùng nguyên firmware fork tiếng Việt của tsl0922/EPD-nRF5 đang chạy trên màn (version `0x26`).

## 2. Stack

Vite · TypeScript (strict) · Preact · vite-plugin-pwa · idb-keyval · vitest. Hash routing, `base: './'` (deploy tĩnh được lên GitHub Pages).

## 3. Cấu trúc thư mục

```
app/src/
  ble/          Giao thức và kết nối thiết bị
    protocol.ts   UUID, opcode, encoder/decoder thuần (không đụng BLE)
    device.ts     EpdDevice: handshake, hàng đợi lệnh tuần tự, uploadImage, setMode, setCountdown, restoreMode
    connect.ts    connectNew / connectSaved (getDevices -> watchAdvertisements -> requestDevice fallback)
    emitter.ts    event emitter nhỏ
  render/       Từ canvas tới byte gửi màn
    canvas.ts, text.ts, testPattern.ts
    dither.ts     Floyd–Steinberg / Atkinson / ngưỡng; bảng màu bwr | bw
    pack.ts       RGBA -> plane đen + plane đỏ (quét cột x=295→0, MSB trước, plane đỏ đảo bit)
  integrations/ Liên kết dịch vụ ngoài (mở rộng bằng registry)
    types.ts, registry.ts, store.ts, pkce.ts
    googleMaps.ts (API key; Routes v2 + Places New: autocomplete, searchText; link mở Maps), spotify.ts (OAuth PKCE, currently-playing)
    share.ts      parse nội dung Web Share Target từ Google Maps (ADR-11)
  miniapps/     Ứng dụng nhỏ cố định, tạo ảnh từ dữ liệu liên kết
    types.ts, registry.ts, quality.ts, format.ts
    spotify/, directions/ (index, geo, maneuvers)
  modes/        Điều phối việc gửi ảnh
    oneShot.ts      lịch / đồng hồ / đếm ngược / ảnh tĩnh
    continuous.ts   ContinuousRunner + interface UpdateTransport
    transports.ts   KeepAliveTransport (giữ kết nối suốt phiên, kết nối lại khi rớt)
    active.ts       singleton phiên đang chạy, restore khi pagehide
    launch.ts       loadMiniAppConfig / startMiniApp (dùng chung cho tab Liên tục và ShareCard)
    frame.ts, wakeLock.ts
  devices/store.ts   thiết bị đã lưu (IndexedDB)
  state/            store quan sát được, log, session, settings, share (địa điểm chia sẻ từ Maps)
  diagnostics/      benchmark gửi ảnh (giữ kết nối), thống kê p50/p95
    fastRefresh.ts  (thí nghiệm, ADR-10) chuỗi lệnh thô 03/04 cho refresh đen/trắng, danh sách trắng giá trị update; LUT 0x32 cố định `fast25/15/8` (ADR-10)
  ui/               App shell + 5 tab: Thiết bị · Một lần · Liên tục · Liên kết · Chẩn đoán
```

## 4. Luồng dữ liệu (chế độ liên tục)

```
Integration (API) ──► MiniAppRun.tick() ──► data ──► MiniApp.key(data)  (đổi mới đi tiếp)
                                                   │
                                  MiniApp.render(ctx2d, data, area)  ──► canvas 296×128
                                                   │
                         dither(palette, algorithm, contrast) ──► packPlanes ──► {black, red}
                                                   │
                                 UpdateTransport.send(planes) ──► EpdDevice.uploadImage
                                                   │
          [mode 0] → INIT (chờ t=) → plane đen → plane đỏ → [mode 3] → REFRESH → chờ 20 s (đo thực tế 15,3 s). Palette đen/trắng (ADR-10): khung đầu của mỗi lần chạy luôn là full refresh; các khung sau: mode 0 → INIT → plane đen → `03 21`/`04 40 00` → `03 32` + 153 byte LUT `fast25` → `03 22`/`04 C7` → `03 20` → chờ 2 s (đo 1,4 s) → `06`; cứ N khung (mặc định 10) thay bằng một full refresh để xoá ghost
```

Runner bỏ qua khung khi `key` không đổi, giữ khung mới nhất nếu chưa đủ khoảng cập nhật tối thiểu (mặc định 25 s với 3 màu, 5 s với đen/trắng), và thử lại sau 10 s khi upload lỗi.

## 5. Các hợp đồng mở rộng

- **`Integration`** (`integrations/types.ts`): `id, name, configFields, auth ('apiKey' | 'oauthPkce'), isReady, connect?, handleRedirect?, test?, info?`. Thêm liên kết = thêm một file và đăng ký vào `registry.ts`. UI cấu hình sinh từ `configFields` (`FieldSpec`).
- **`MiniApp`** (`miniapps/types.ts`): `requires[], settingsSchema, defaultSettings, pollIntervalMs, start(ctx) -> {tick, stop}, key(data), render(ctx, data, area, settings)`. Chất lượng ảnh (`QualitySettings`: palette, algorithm, contrast, minIntervalSec, layout) do runner áp dụng, miniapp không tự xử lý.
- **`UpdateTransport`** (`modes/continuous.ts`): `open, send, restore, dispose`. Bản triển khai duy nhất là `KeepAliveTransport`: giữ một kết nối GATT suốt phiên, kết nối lại với backoff khi rớt. Không có phương thức ngắt rồi kết nối lại mỗi khung (ADR-7).

## 6. Giao thức BLE (đã xác minh từ log thật + mã công cụ của fork)

Service `62750001-d828-918d-fb46-b6c11c675aec`; char `…0002` (write + notify), char `…0003` (version, đọc `0x26`). MTU 244, chunk ảnh 242 byte, cách nhau 8 ms.

| Opcode | Dùng cho |
|---|---|
| `01` INIT | Trả `mtu=N`, `t=<ts>`, và gói config |
| `20` SET_TIME `ts[4] tz mode` | Chọn mode: 0 ảnh, 1 lịch, 2/3 đồng hồ, `0x83` đồng hồ+ảnh |
| `21` | Ngày đầu tuần |
| `D6` / `D7` / `D8` | Đặt, dừng, hỏi đếm ngược (mode 8, ASCII, firmware lưu flash) |
| `30` WRITE_IMG | Plane đen cờ `0F`/`FF`; plane đỏ cờ `00`/`F0` |
| `05` REFRESH | Hiển thị và lưu mode picture |
| `FB` | Lịch ngủ màn hình |
| `03`/`04` | Ghi thanh ghi / data SSD1680 thô. Chỉ dùng trong thí nghiệm refresh nhanh (Chẩn đoán) |
| `06` | Đưa controller panel vào ngủ (opcode upstream, chưa kiểm chứng trên fork) |

Config byte: `[7]` model, `[11]` mode hiện tại, `[12]` ngày đầu tuần. Full refresh 3 màu mất khoảng 15 s, đen/trắng nhanh bằng LUT `fast25` khoảng 1,4 s (đo trên panel 2.9"; waveform OTP đen/trắng là ~8 s).

## 7. Trạng thái dữ liệu

| Dữ liệu | Nơi lưu |
|---|---|
| Thiết bị đã lưu (`id`, `advName`, tên đặt, `lastMode`, `countdownParams`) | IndexedDB `devices/store.ts` |
| Config + token liên kết | IndexedDB `integrations/store.ts` |
| Cài đặt miniapp, chất lượng ảnh, miniapp dùng gần nhất | IndexedDB `state/settings.ts` |
| Phiên đang chạy, snapshot mode | RAM (`state/session.ts`, `modes/active.ts`) |

## 8. Giới hạn đã biết

- Web Bluetooth không cho đọc MAC; định danh thiết bị bằng `device.id` của Chrome + tên quảng bá.
- Firmware không tự khôi phục mode khi rớt kết nối; app phải restore.
- Layout `clockImage` (0x83) tắt vì chưa có code ghi vùng ảnh.
- Snapshot mode không bền qua crash (chưa lưu marker "pending restore").
- Dừng phiên chờ refresh đang chạy xong (~20 s); `pagehide` chỉ best effort.
- Chữ đi qua dither chung với ảnh: palette đen/trắng dùng `threshold` mặc định, 3 màu dùng Floyd–Steinberg nên mép chữ 3 màu có thể lấm tấm (ADR-3, ADR-4).
- Dừng chế độ liên tục mà không khôi phục được mode ban đầu thì chuyển sang app lịch trước khi ngắt kết nối (ADR-3, ADR-4).
- Refresh đen/trắng nhanh dùng LUT `0x32` cố định (ADR-10): độ phân giải/độ rõ thấp hơn waveform OTP (độ đậm 3–4 so với 4–5), chưa kiểm chứng ghost sau nhiều khung liên tiếp; polarity, điện áp và nhiệt độ thấp chưa thử.
- Chữ miniapp Chỉ đường dùng Helvetica thường + ngưỡng cứng 128, mặc định đen/trắng (ADR-12): chưa kiểm chứng trên màn thật; miniapp Spotify vẫn font hệ thống.
- Chia sẻ từ Google Maps (ADR-11): tuyến do app tự tính có thể khác tuyến trong Maps; link rút gọn không giải được; Maps ở nền có thể làm PWA ngừng cập nhật.
- Chưa xác nhận trên thiết bị: `getDevices`/`watchAdvertisements`, CORS ảnh bìa Spotify, độ ổn định của kết nối giữ suốt phiên dài.
