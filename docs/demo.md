# Dùng thử PocketLedger

1. Chọn **Explore a private demo** để tạo dữ liệu mẫu riêng.
2. Đổi tháng, xem tổng thu, tổng chi, số dư và biểu đồ.
3. Thêm khoản chi `12.50` vào danh mục Food.
4. Đặt ngân sách cho Food, rồi kiểm tra mức đã dùng.
5. Sửa hoặc xóa khoản chi vừa tạo; các tổng phải được cập nhật theo.
6. Lọc theo danh mục và xuất CSV.
7. Đăng xuất, tạo một lần dùng thử khác để kiểm tra dữ liệu được tách riêng.

Dữ liệu mẫu là hư cấu. Ứng dụng dùng USD và không kết nối ngân hàng.

## Các quy tắc cần kiểm tra

- `0.10` cộng `0.20` được tính thành 30 cent.
- CSV dùng cùng bộ lọc tháng và danh mục với danh sách.
- CSV xuất toàn bộ kết quả phù hợp, kể cả khi danh sách chỉ hiện 500 dòng.
- Tài khoản này không đọc hoặc sửa giao dịch của tài khoản khác.
- Đặt ngân sách không thay đổi các giao dịch đã ghi.

Chạy `npm test` để kiểm tra API và `npm run build` để kiểm tra TypeScript cùng bản build.
