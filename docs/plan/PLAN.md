# Plan: PWA điều khiển màn e-ink AESL0290C (NRF_EPD_F636)

## Context

Cần một PWA (Android Chrome, Web Bluetooth) để kết nối, cấu hình và điều khiển màn ESL 2.9" AESL0290C. App có 2 chế độ:
- **Một lần**: cài chế độ cho firmware (lịch, đồng hồ, đếm ngược, ảnh tĩnh), rồi ngắt kết nối.
- **Liên tục**: stream ảnh do miniapp ("Chỉ đường", "Spotify") render ra. Khi ngắt kết nối thì trả quyền hiển thị lại cho firmware.

Nguồn dữ liệu là các liên kết (Google Maps, Spotify), thiết kế mở để thêm liên kết khác sau này.

## Kết quả kiểm tra firmware (12/10/2026)

**Nguồn dữ liệu:**
- Kết nối thật tới thiết bị (log bạn gửi): version `0x26`, config `14 13 06 05 04 03 02 02 ff 12 07 08 01`, `mtu=244`.
- Đối chiếu với mã công cụ điều khiển của chính bản fork: https://tanhoangphuc842002-rgb.github.io/

**Thông tin thiết bị:**
- Firmware là fork tiếng Việt của tsl0922/EPD-nRF5, chạy trên nRF52811.
- Panel 2.9" 296×128 **đen/trắng/đỏ** (SSD1680). model `0x02`; vì version nằm trong 30–39 và không có byte panel `0x21` nên đây là profile 2.9".
- Màn đang ở **mode 0x08 = đếm ngược**. Firmware tự vẽ lịch âm và tiếng Việt.

**Đặc tả giao thức** (service `62750001-d828-918d-fb46-b6c11c675aec`; char `…0002` dùng để write/notify; char `…0003` là version):

| Lệnh | Payload | Dùng cho |
|---|---|---|
| `01` INIT | – | Thiết bị trả `mtu=N` và `t=<ts>` |
| `20` SET_TIME | `ts u32 BE (UTC)`, `tz int8 giờ`, `mode` | Chọn mode: 0 ảnh, 1 lịch, 2/3 đồng hồ mặt 1/2, `0x83` đồng hồ+ảnh 2.9" |
| `21` | `0/1` | Ngày đầu tuần |
| `D6` | `00 YL YH MM DD LEN ascii[≤8..16] ts[4] tz`. Gửi `D6 FF` để hỏi trạng thái | Đặt đếm ngược (mode 8). Firmware lưu flash. Reply `D6 st …` (st 0 = ok, 1 = đang lưu) |
| `D7` / `D8 FF` | – | Dừng đếm ngược / hỏi độ dài nhãn tối đa |
| `30` WRITE_IMG | `flag + data` (chunk = mtu−2 = 242, delay 8ms). Plane đen: `0x0F` gói đầu, `0xFF` gói sau. Plane đỏ: `0x00` gói đầu, `0xF0` gói sau | Ảnh. Pixel quét theo cột từ x = 295→0, y từ trên xuống, MSB trước. Plane đỏ đảo bit |
| `03`/`04` | thanh ghi / data SSD1680 thô | Vẽ vùng (đồng hồ + ảnh 194×128 bên trái) |
| `05` REFRESH | – | Hiển thị ảnh và lưu mode picture |
| `FB` | `FF` để hỏi; `en sh sm eh em` để đặt | Lịch ngủ màn hình |
| DFU | `FE59` buttonless Secure DFU | Có, nhưng **không cần dùng** |

Trình tự gửi ảnh: `20 ts tz 00` → `01` (chờ `t=`) → plane đen → plane đỏ → `20 ts tz 03` → `05` → chờ khoảng 32s cho full refresh 3 màu.

### Đánh giá tính khả thi

| Yêu cầu | Kết luận |
|---|---|
| Kết nối BLE từ PWA Android | ✅ Service mở, không cần pair |
| Một lần: lịch / đồng hồ | ✅ `20 … 01/02/03`. Thiết bị tự giữ giờ, đồng hồ tự tick mỗi phút |
| Một lần: đếm ngược | ✅ `D6`. Nhãn chỉ nhận ASCII (≤8, có thể tới 16 chữ); firmware tự vẽ phần "còn N ngày" |
| Một lần: ảnh tĩnh | ✅ Quy trình WRITE_IMG ở trên |
| Liên tục: stream ảnh | ✅ khả thi nhưng **chậm**: ~1 khung mỗi 30–35s (full refresh 3 màu). Phù hợp Spotify (đổi bài) và chỉ đường (bước rẽ tiếp theo); không phù hợp hiệu ứng nhanh. Có thêm lựa chọn "đồng hồ + ảnh" (`0x83`): đồng hồ do firmware chạy, miniapp vẽ ô 194×128 |
| Trả quyền khi ngắt kết nối | ⚠️ Firmware không tự khôi phục. App ghi nhớ mode trước đó (config byte 11 và tham số đếm ngược) rồi gửi lại `20 … mode` hoặc `D6 …` trước khi ngắt. Nếu rớt kết nối thì màn giữ ảnh cuối cho tới khi app kết nối lại và restore |
| Viết firmware mới | ❌ **Không cần.** Mã nguồn fork không công khai; nạp upstream sẽ mất tiếng Việt, đếm ngược và hỗ trợ 2.9". Giữ nguyên firmware |

## Cách triển khai

Code do **subagent chạy model `sonnet`** viết (`Agent` với `model: "sonnet"`, mỗi giai đoạn một agent, prompt kèm bảng giao thức ở trên). Agent chính review, chạy test và build.

### Giai đoạn 0 — Lõi BLE và trang Chẩn đoán (xác nhận trên thiết bị)
`/#/diagnostics` có:
- Kết nối bằng `requestDevice({filters:[{namePrefix:'NRF_EPD'}], optionalServices:[EPD_SVC, 0xFE59]})`.
- Hiển thị version, config đã giải mã, MTU, giờ thiết bị, trạng thái đếm ngược (`D6 FF`), `D8 FF`, lịch ngủ (`FB FF`).
- Ma trận test (bấm từng nút, có xác nhận trước): lịch → đồng hồ → đếm ngược → ảnh test B/W/R → đồng hồ+ảnh → restore mode ban đầu. Mỗi bước ghi thời gian refresh và kết quả bạn quan sát.
- Thí nghiệm tuỳ chọn: refresh nhanh 2 màu qua thanh ghi thô `03/04` (bỏ plane đỏ). Chỉ bật làm tuỳ chọn chất lượng nếu thật sự ổn định.
- **Test kết nối lại thiết bị đã lưu:** sau khi tải lại trang, lấy thiết bị từ `navigator.bluetooth.getDevices()`, rồi gọi `watchAdvertisements()` và `gatt.connect()`, không qua hộp chọn. Ghi nhận có chạy được trên Android Chrome của bạn hay không.
- **Benchmark 2 flow cho chế độ liên tục** (chạy tự động, mỗi flow 20 chu kỳ với cùng một ảnh test, xem bảng ở GĐ1):
  - A `keepAlive`: kết nối một lần, mỗi chu kỳ chỉ gửi ảnh và refresh.
  - B `connectPerUpdate`: mỗi chu kỳ kết nối, INIT, gửi ảnh, refresh rồi ngắt.
  - Ghi lại: thời gian kết nối (p50/p95), tỉ lệ kết nối thành công, tổng độ trễ từ lúc có dữ liệu tới khi màn cập nhật xong, số lần rớt kết nối, và lỗi khi ngắt kết nối giữa lúc màn đang refresh (busy).

### Giai đoạn 1 — PWA đầy đủ
**Stack:** Vite + TypeScript + Preact, `vite-plugin-pwa`, `idb-keyval`, vitest. Deploy tĩnh qua HTTPS (GitHub Pages).

```
app/src/
  ble/protocol.ts     # UUID, opcode, encode SET_TIME/D6/WRITE_IMG/FB, decode config/notify
  ble/device.ts       # EpdDevice: connect, reconnect backoff, hàng đợi lệnh tuần tự, chờ reply (t=, D6 st)
  render/canvas.ts    # canvas 296x128 (và 194x128 cho đồng hồ+ảnh)
  render/dither.ts    # Floyd-Steinberg/Atkinson/ngưỡng, ánh xạ về bảng màu đen/trắng/đỏ
  render/pack.ts      # quét cột x=295→0, 1bpp MSB, plane đỏ đảo bit
  integrations/{types,registry,googleMaps,spotify}.ts
  miniapps/{types,registry}.ts, miniapps/directions/, miniapps/spotify/
  modes/oneShot.ts    # lịch | đồng hồ | đếm ngược | ảnh tĩnh (upload file + crop + dither)
  modes/continuous.ts # tick → render → hash so sánh khung trước → upload → refresh; dừng thì restore
  ui/                 # Thiết bị · Một lần · Liên tục · Liên kết · Chẩn đoán
```

- **Thiết kế mở:** `Integration {id, name, configFields, auth: 'apiKey'|'oauthPkce', connect(), getClient()}` và `MiniApp {id, requires[], settingsSchema, tick(), render(ctx, state, quality)}`. Muốn thêm thì tạo file mới và đăng ký vào registry. UI cấu hình sinh tự động từ schema.
- **Chất lượng ảnh** (theo từng miniapp): bảng màu (3 màu, hoặc đen trắng nếu GĐ0 xác nhận được), thuật toán dither, độ tương phản, khoảng cập nhật tối thiểu (mặc định 35s), bố cục toàn màn hoặc đồng hồ+ảnh.
- **Thiết bị đã lưu** (`devices/store.ts`, UI "Thiết bị"):
  - Web Bluetooth **không cung cấp MAC address**. Mỗi thiết bị được định danh bằng `device.id` (ID ổn định theo origin do Chrome cấp) kèm tên quảng bá (`NRF_EPD_F636`; hậu tố F636 nhiều khả năng lấy từ MAC). Nếu cần MAC thật thì phải dùng app native.
  - Lưu trong IndexedDB: `{id, advName, displayName (tên bạn đặt), version, model, lastMode, countdownParams, lastSeen}`. Cho phép đổi tên và xoá.
  - Lần sau: bấm chọn thiết bị đã lưu, app lấy lại qua `getDevices()` (khớp id) và kết nối thẳng. Nếu trình duyệt không hỗ trợ (theo kết quả GĐ0) thì gọi `requestDevice({filters:[{name: advName}]})`; hộp chọn chỉ còn đúng thiết bị đó, chạm một lần là xong.
- **Hai flow cập nhật cho chế độ liên tục** (`modes/continuous.ts`, interface `UpdateTransport`):
  - `keepAlive`: giữ kết nối suốt phiên (ví dụ chỉ đường 30 phút) và gửi ảnh mỗi khi nội dung đổi. Ưu điểm: không tốn thời gian kết nối lại. Nhược điểm: màn tốn pin hơn khi kết nối liên tục, và rớt kết nối giữa chừng phải xử lý reconnect.
  - `connectPerUpdate`: chỉ kết nối khi có khung mới, gửi, refresh, chờ hết busy rồi ngắt. Trong lúc ngắt, màn vẫn giữ ảnh vì mode picture đã được lưu. Ưu điểm: tiết kiệm pin màn, tự hồi phục khi rớt. Nhược điểm: mỗi lần thêm vài giây kết nối.
  - Quy tắc chọn mặc định dựa trên benchmark GĐ0: nếu B có p95 kết nối ≤ 5s và tỉ lệ thành công ≥ 95% thì mặc định B (vì đằng nào mỗi khung cũng mất ~30s refresh); nếu không thì mặc định A. Cả hai đều có thể chọn trong cài đặt miniapp. Kết thúc phiên ở cả hai flow đều chạy bước restore mode.
- **Trả quyền:** khi bắt đầu stream thì snapshot mode hiện tại (và tham số đếm ngược app đã lưu). Khi bấm Dừng hoặc `pagehide`, gửi lệnh restore rồi `disconnect()`. Nếu rớt kết nối thì thử kết nối lại và restore. Dùng Wake Lock để giữ màn hình điện thoại sáng khi stream; đây là giới hạn của PWA trên Android.
- **Google Maps:** người dùng nhập API key (giới hạn theo HTTP referrer). Dùng Routes API `computeRoutes` + Places Autocomplete + `geolocation.watchPosition`. Miniapp vẽ mũi tên rẽ, khoảng cách, tên đường và ETA, không vẽ tile bản đồ.
- **Spotify:** OAuth Authorization Code + PKCE (Client ID do người dùng đăng ký), redirect `/#/auth/spotify`, tự refresh token, gọi `GET /v1/me/player/currently-playing`. Miniapp vẽ ảnh bìa đã dither (khối 128×128 bên trái), tên bài, nghệ sĩ, năm phát hành (`album.release_date`) và thời lượng (`duration_ms` → m:ss). **Không có thanh tiến độ**: chỉ cập nhật màn khi `item.id` đổi. Poll API mỗi 10–15s nhưng chỉ upload khi đổi bài. Chữ Việt do app render bằng canvas nên hiển thị đầy đủ dấu.
- Token và key lưu trong IndexedDB trên máy, không có backend.

## Kiểm thử
1. `npm test`: unit test cho `pack.ts` (so byte với `canvas2bytes_bw` của trang fork), encode `20`/`D6`/`30` và decode config mẫu `1413060504030202ff12070801`.
2. `npm run build && npm run preview`, mở trên Android Chrome qua HTTPS. Trang Chẩn đoán phải đọc được `0x26` và mode 8.
3. Chạy ma trận GĐ0 trên màn thật, cuối cùng khôi phục đếm ngược như cũ.
4. Một lần: đặt từng chế độ, ngắt kết nối, kiểm tra màn tự cập nhật (đồng hồ theo phút, đếm ngược theo ngày).
5. Thiết bị đã lưu: đặt tên, tải lại app, chọn thiết bị đã lưu và kết nối được ngay.
6. Liên tục: chạy benchmark A/B, chọn flow mặc định theo quy tắc và ghi kết quả vào `docs/transport-benchmark.md`. Spotify chỉ cập nhật màn khi đổi bài; chỉ đường với tuyến thật; bấm Dừng thì màn quay về mode trước; tắt Bluetooth giữa chừng để test reconnect/restore.
