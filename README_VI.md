<div align="center">
  <img src="assets/icon-transparent/icon_512x512.png" alt="Biểu trưng Vyact" width="120" />

# Vyact

**Không gian làm việc AI ưu tiên xử lý cục bộ, kết nối hội thoại, tài liệu, ghi chú và các công cụ Google, Microsoft.**

[English](README.md) · [한국어](README_KO.md) · [日本語](README_JA.md) · [ไทย](README_TH.md) · [Tiếng Việt](README_VI.md)

[Tải ứng dụng](https://github.com/vyact/vyact/releases/latest) · [Tiện ích Chrome](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)
</div>

## Vyact giúp bạn làm gì?

Vyact giữ tài liệu, email và ghi chú trong cùng một không gian để bạn không phải liên tục sao chép dữ liệu và giải thích lại bối cảnh. Đính kèm tài liệu để đặt câu hỏi, kiểm tra nguồn của câu trả lời hoặc lưu nội dung thành kiến thức có thể tìm kiếm về sau.

Ứng dụng hỗ trợ mô hình cục bộ qua llama.cpp và MLX trên Apple Silicon, đồng thời có thể kết nối OpenAI, Gemini, Claude hoặc API tương thích OpenAI của bạn. Khi chọn nhà cung cấp AI bên ngoài, nội dung tài liệu và email dùng trong hội thoại có thể được gửi đến nhà cung cấp đó.

## Cài đặt và trải nghiệm đầu tiên

1. Tải gói phù hợp từ [GitHub Releases](https://github.com/vyact/vyact/releases/latest):
   - **macOS:** DMG cho Apple Silicon từ M1 trở lên. Hiện chưa hỗ trợ Intel Mac.
   - **Windows:** Bộ cài EXE.
   - **Linux x64:** AppImage hoặc DEB; cần glibc 2.35 trở lên.
2. Cài đặt rồi mở Vyact. Để chạy mô hình cục bộ, chọn **Vyact** trong bước thiết lập ban đầu. Kiểm tra bộ nhớ máy và mức sử dụng ước tính trước khi tải mô hình.
3. Mac hỗ trợ GGUF hoặc MLX; Windows và Linux hỗ trợ GGUF. Lần tải mô hình và chuẩn bị môi trường chạy đầu tiên có thể mất thời gian.
4. Khi mô hình đã sẵn sàng, gửi một câu hỏi ngắn. Sau đó đính kèm PDF và yêu cầu tóm tắt kèm căn cứ.
5. Lập chỉ mục các tài liệu thường dùng trong phần quản lý tài liệu, rồi hỏi lại trong hội thoại thông thường để thử RAG. Bạn có thể kết nối email và cài tiện ích Chrome sau.

### Chuẩn bị môi trường

Ứng dụng đi kèm Python 3.12. Để tự động cài môi trường chạy mô hình, nên dùng [Homebrew](https://brew.sh/) trên macOS hoặc `winget` trên Windows. Vyact cũng có thể dùng môi trường tương thích đã được cài sẵn.

Gói Linux đi kèm môi trường chạy bằng CPU. Việc bổ sung thư viện hệ thống còn thiếu có thể cần trình quản lý gói và quyền quản trị. Elasticsearch có thể chạy trực tiếp trên máy, không bắt buộc dùng Docker.

Chạy AppImage từ thư mục tải xuống:

```bash
chmod +x Vyact-*.AppImage
./Vyact-*.AppImage
```

Trên Ubuntu / Debian, cài DEB rồi mở Vyact từ menu ứng dụng:

```bash
sudo apt install ./vyact_*_amd64.deb
```

## Kết nối Google và Microsoft

| Google | Microsoft |
| --- | --- |
| Tìm, đọc, soạn, gửi Gmail và quản lý nhãn | Tìm, đọc, soạn, gửi email Outlook và quản lý thư mục |
| Quản lý, chia sẻ tệp Google Drive | Quản lý, chia sẻ tệp OneDrive |
| Xem, tạo, sửa và xóa sự kiện Google Calendar | Xem, tạo, sửa và xóa sự kiện trong lịch Microsoft |

**Google:** Mở **Google** trong phần cài đặt, làm theo hướng dẫn chuẩn bị, tải lên tệp thông tin xác thực OAuth dạng JSON rồi đăng nhập qua trình duyệt.

**Microsoft:** Mở **Microsoft** trong phần cài đặt. Đăng ký ứng dụng trong Microsoft Entra, chọn loại tài khoản cần hỗ trợ và thêm URI chuyển hướng dành cho ứng dụng di động/máy tính theo địa chỉ Vyact hiển thị. Nhập Application (client) ID vào Vyact rồi đăng nhập qua trình duyệt. Kết nối dùng PKCE nên không cần client secret. Việc đăng ký ứng dụng cần tenant Entra và quyền đăng ký; tài khoản công ty hoặc trường học có thể cần sự đồng ý của quản trị viên.

Chuyển tài khoản trong danh sách chung có ký hiệu **G / M**. Google nằm trên, Microsoft nằm dưới; tài khoản được chọn gần nhất của mỗi dịch vụ đứng đầu nhóm đó. Dùng **Cmd+Shift+G** trên macOS hoặc **Ctrl+Shift+G** trên Windows / Linux để mở hoặc đóng bảng làm việc chung.

<p align="center">
  <img src="assets/readme/feature-ai-workspace.png" alt="Vyact làm việc với tài liệu và Google Workspace" width="100%" />
</p>

## Tính năng chính

- **RAG và bộ sưu tập kiến thức:** Gom tài liệu, ghi chú và email đã lập chỉ mục; tìm đoạn liên quan đến câu hỏi và kiểm tra văn bản nguồn của câu trả lời.
- **Tìm và kiểm tra hiệu năng mô hình cục bộ:** So sánh GGUF / MLX theo kích thước và bộ nhớ ước tính. Bài kiểm tra hiệu năng cho phép so sánh thời gian đến token đầu tiên, tốc độ sinh và số token trên máy của bạn. Điểm tốc độ không phải thước đo chất lượng câu trả lời.
- **MLX trên Apple Silicon:** Chạy qua oMLX với bộ nhớ đệm RAM và SSD. Mô hình tương thích có thể dùng MTP để tăng tốc sinh; khả năng hỗ trợ tùy thuộc mô hình và môi trường chạy.
- **Ghi chú và dự án:** Lưu ghi chú có tiêu đề, danh sách và mã; tổ chức hội thoại cùng chỉ dẫn theo từng dự án.
- **Hội thoại bằng giọng nói:** Đặt câu hỏi bằng giọng nói và luyện ngoại ngữ. Tự động đọc câu trả lời trong chế độ giọng nói mặc định tắt; tốc độ đọc có thể chỉnh từ 1–2 lần.
- **MCP và kỹ năng:** Kết nối máy chủ MCP trong phần công cụ AI và lưu các chỉ dẫn dùng lại trong phần kỹ năng.
- **Máy chủ API:** Lấy thông tin kết nối để dùng mô hình cục bộ đang chạy từ ứng dụng khác, với tùy chọn xác thực bằng token.
- **Sao lưu:** Xuất và khôi phục hội thoại, tài liệu, ghi chú, cài đặt. Chọn tài khoản Google Drive hoặc OneDrive để sao lưu lên đám mây. Token OAuth không được đưa vào bản sao lưu.
- **Giao diện đa ngôn ngữ:** Hỗ trợ tiếng Việt, Anh, Hàn, Nhật, Trung, Thái, Tây Ban Nha và Pháp.

<p align="center">
  <img src="assets/readme/feature-document-rag.png" alt="Quản lý tài liệu và RAG trong Vyact" width="100%" />
</p>

## Tiện ích Chrome

Cài từ [Chrome Web Store](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib), mở ứng dụng Vyact trên máy tính rồi mở bảng bên của tiện ích.

- Gửi trang hiện tại hoặc đoạn văn được chọn vào hội thoại để đặt câu hỏi và dịch.
- Học với Netflix bằng phụ đề song ngữ, chuyển giữa các câu, phát lặp và tự động tạm dừng.
- Cải thiện bản nháp bằng sửa ngữ pháp hoặc điều chỉnh giọng văn; so sánh trước và sau rồi sao chép kết quả.

## Kết nối LLM riêng

Chọn **Custom LLM** khi thiết lập để kết nối máy chủ có API `/chat/completions` tương thích OpenAI. Nhập Base URL, ví dụ `http://localhost:8080/v1`, Model ID và API key nếu máy chủ yêu cầu. Khả năng truyền phản hồi liên tục, gọi công cụ và nhận ảnh phụ thuộc vào máy chủ và mô hình được kết nối.

## Góp ý, hỗ trợ và giấy phép

Báo lỗi hoặc đặt câu hỏi tại [Issues](https://github.com/vyact/vyact/issues); thêm `[Question]` vào đầu tiêu đề câu hỏi. Xem [hướng dẫn đóng góp](CONTRIBUTING.md) để tham gia phát triển hoặc dịch thuật. Báo lỗ hổng theo [chính sách bảo mật](SECURITY.md).

Bạn có thể hỗ trợ phát triển qua [Ko-fi](https://ko-fi.com/vyact), [PayPal](https://paypal.me/vyact) hoặc [Patreon](https://www.patreon.com/cw/vyact).

Mã nguồn được cấp phép theo [AGPL-3.0](LICENSE). Nếu cung cấp phiên bản đã sửa đổi qua mạng, bạn phải cung cấp mã nguồn tương ứng theo điều kiện giấy phép. Tên và biểu trưng Vyact chịu [chính sách nhãn hiệu](TRADEMARKS.md) riêng. Xem thêm [nguyên tắc quản trị](GOVERNANCE.md).
