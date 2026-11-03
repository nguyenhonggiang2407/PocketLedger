# Chạy PocketLedger

## Máy cá nhân

`npm ci`, `npm run build` rồi `npm start` dùng Node.js 24 trở lên.
Đặt `APP_ORIGIN=http://127.0.0.1:3002` khi mở trực tiếp bản build.
Lệnh `docker compose up --build -d` là một lựa chọn khác: cổng chỉ mở trên `127.0.0.1:3002`.
Compose dùng chế độ development cho bản xem thử HTTP trên máy cá nhân.

## Host có HTTPS

- Dùng Docker image từ Dockerfile của repo. Đặt `NODE_ENV=production`,
  `APP_ORIGIN=https://ten-mien-cua-ban`, `HOST=0.0.0.0`, `COOKIE_SECURE=true`.
- Đặt reverse proxy HTTPS phía trước, giữ backend trong mạng nội bộ. Không mở cổng database.
- Gắn volume ghi được vào `/app/data`; image chạy với user `node` (UID 1000).
- Chỉ chạy một tiến trình ứng dụng dùng chung file SQLite. Chưa hỗ trợ nhiều replica.
- `GET /api/health` kiểm tra kết nối SQLite. Docker healthcheck dùng cùng API.
- Không đưa `.env`, cookie hoặc file database thật lên GitHub.

## Sao lưu

Dừng ứng dụng trước khi sao chép database nếu không dùng SQLite backup API.
Giữ một bản sao database để phục hồi trước khi thay image. `docker compose down` giữ volume;
thêm `-v` sẽ xóa volume và dữ liệu, vì vậy chỉ dùng cho dữ liệu thử đã chủ động bỏ.

## Phân trang và sao chép hạn mức

`GET /api/transactions?month=2030-04&category=Food&limit=50` trả `entries`, `total`, `nextCursor`.
Gửi cursor bằng tham số `after` để tải trang tiếp theo. Cursor gắn với tài khoản, tháng và danh mục;
API kiểm tra quyền trong truy vấn SQLite ở mọi trang. Kích thước được giới hạn 1–500;
không truyền `limit` giữ kích thước trang 500 cho client cũ. Danh sách dùng thứ tự ngày giảm dần,
sau đó ID giảm dần, và truy vấn theo vị trí hàng cuối thay vì OFFSET.

`POST /api/budgets/copy` với JSON `{"month":"2030-04"}` và CSRF token sao chép hạn mức từ
tháng 03 sang tháng 04. API trả 409 nếu tháng đích có bất kỳ hạn mức nào, 404 nếu tháng trước
không có hạn mức, 400 nếu tháng không hợp lệ. Thao tác không sao chép giao dịch.
