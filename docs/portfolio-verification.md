# Kiểm chứng portfolio — 03/11/2026

## Thay đổi

- Giữ nguyên source nghiệp vụ, dữ liệu và MIT License.
- Cập nhật patch được ghim của Zod, Vite và concurrently; lockfile cũng lấy các
  bản sửa transitive. Không dùng `npm audit fix --force` hoặc đổi major version.
  Trước cập nhật npm báo 6 advisories; sau cập nhật báo 0 tại thời điểm kiểm tra.
  Đây không phải chứng nhận ứng dụng không còn lỗ hổng.
- Chụp lại ảnh ngân sách desktop/mobile từ bản build thật qua `e2e/browser.mjs`;
  dữ liệu trong ảnh là fixture hư cấu, không phải giao dịch của người dùng thật.
- Làm rõ cách chạy trên PowerShell và đưa các quyết định backend lên đầu README.

## Đã chạy trên Windows, Node.js 24.19.0

```powershell
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm audit
```

19 bài API/logic và build TypeScript/Vite vượt qua. Năm bài Chromium vượt qua:
phân trang hơn 500 giao dịch, lỗi mạng/response đến muộn, sao chép ngân sách khi
mất phản hồi, mobile 390 px và phiên hết hạn. Các bài dùng database local riêng.

Ảnh mới: `docs/screenshots/budgets-desktop.png` và `budgets-mobile.png`.
Đã xem lại ảnh để kiểm tra nội dung và bố cục. Các ảnh JPG khác là ảnh đã có trong repo.

## Bằng chứng backend

- `server/domain.ts` nhận chuỗi tiền thập phân và chuyển thành cent nguyên;
  giới hạn giá trị tránh số vượt phạm vi an toàn. Đây là sổ USD, chưa đa tiền tệ.
- `server/store.ts` giới hạn dữ liệu theo tài khoản; keyset cursor giữ vị trí khi
  thêm giao dịch mới. CSV lấy toàn bộ kết quả phù hợp, không bị giới hạn ở trang đang xem.
- Sao chép ngân sách kiểm tra tháng nguồn/đích và thực hiện cả nhóm trong một
  transaction; không ghi đè tháng có kế hoạch hoặc sao chép giao dịch.
- Cookie phiên HttpOnly, hash token trong SQLite; thao tác ghi cần Origin và CSRF hợp lệ.

## Hosting và phần chưa kiểm tra

`https://giang-pocketledger.onrender.com/api/health` trả HTTP 200 với `{"ok":true}`.
Chưa thử lại toàn bộ luồng trình duyệt production, kiểm tra Render logs hoặc chạy
Docker trong đợt này. E2E/ảnh local không chứng minh bản hosting cùng commit.
SQLite trên Render Free có thể bị reset; không dùng demo để giữ số liệu tài chính thật.
Xem [deployment.md](deployment.md) và [render-free.md](render-free.md).
