<div align="center" markdown="1">
  <img src="assets/icon-transparent/icon_512x512.png" alt="Biểu trưng Vyact" width="120" />

# Vyact

[English](README.md) · [한국어](README_KO.md) · [日本語](README_JA.md) · [ไทย](README_TH.md) · [Tiếng Việt](README_VI.md)

  **Vyact là không gian làm việc AI cá nhân mã nguồn mở, ưu tiên xử lý cục bộ dành cho llama.cpp, RAG, AI agent, trí tuệ tài liệu và tích hợp Google Workspace / Microsoft.**

### Không gian riêng tư cho hội thoại, kiến thức và hoàn thành công việc.

  **Biến tệp, ghi chú, email và công cụ hằng ngày thành ngữ cảnh AI hữu ích mà không rời khỏi quy trình làm việc.**

  [![Giấy phép: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-7c3aed.svg?style=flat-square)](LICENSE)
  [![Tiện ích Chrome](https://img.shields.io/badge/browser-Chrome%20Extension-4285f4.svg?style=flat-square)](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)
  <a href="https://github.com/vyact/vyact/releases/latest"><img alt="Nền tảng hỗ trợ: macOS, Windows và Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-475569.svg?style=flat-square"></a>
  [![Bản phát hành mới nhất](https://img.shields.io/github/v/release/vyact/vyact?style=flat-square&label=release)](https://github.com/vyact/vyact/releases/latest)

  [Bắt đầu](#bắt-đầu) · [Quy trình](#một-không-gian-cho-công-việc-hằng-ngày) · [Tính năng](#mọi-thứ-cần-thiết-để-giữ-nguyên-bối-cảnh) · [Hỗ trợ Vyact](#hỗ-trợ-vyact) · [Đóng góp](CONTRIBUTING.md)
</div>

---

## Vyact giúp bạn làm gì?

Vyact giữ tài liệu, email và ghi chú trong cùng một không gian để bạn không phải liên tục sao chép dữ liệu và giải thích lại bối cảnh. Đính kèm tài liệu để đặt câu hỏi, kiểm tra nguồn của câu trả lời hoặc lưu nội dung thành kiến thức có thể tìm kiếm về sau.

Ứng dụng hỗ trợ mô hình cục bộ qua llama.cpp và MLX trên Apple Silicon, đồng thời có thể kết nối OpenAI, Gemini, Claude hoặc API tương thích OpenAI của bạn. Khi chọn nhà cung cấp AI bên ngoài, nội dung tài liệu và email dùng trong hội thoại có thể được gửi đến nhà cung cấp đó.

## Một không gian cho công việc hằng ngày

### AI chat, tệp, Google và Microsoft trong cùng một nơi

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

### Tính năng chính

- **RAG và bộ sưu tập kiến thức:** Gom tài liệu, ghi chú và email đã lập chỉ mục; tìm đoạn liên quan đến câu hỏi và kiểm tra văn bản nguồn của câu trả lời.
- **Tìm và kiểm tra hiệu năng mô hình cục bộ:** So sánh GGUF / MLX theo kích thước và bộ nhớ ước tính. Bài kiểm tra hiệu năng cho phép so sánh thời gian đến token đầu tiên, tốc độ sinh và số token trên máy của bạn. Điểm tốc độ không phải thước đo chất lượng câu trả lời.
- **MLX trên Apple Silicon:** Chạy qua oMLX với bộ nhớ đệm RAM và SSD. Mô hình tương thích có thể dùng MTP để tăng tốc sinh; khả năng hỗ trợ tùy thuộc mô hình và môi trường chạy.
- **Ghi chú và dự án:** Lưu ghi chú có tiêu đề, danh sách và mã; tổ chức hội thoại cùng chỉ dẫn theo từng dự án.
- **Hội thoại bằng giọng nói:** Đặt câu hỏi bằng giọng nói và luyện ngoại ngữ. Tự động đọc câu trả lời trong chế độ giọng nói mặc định tắt; tốc độ đọc có thể chỉnh từ 1–2 lần.
- **MCP và kỹ năng:** Kết nối máy chủ MCP trong phần công cụ AI và lưu các chỉ dẫn dùng lại trong phần kỹ năng.
- **Máy chủ API:** Lấy thông tin kết nối để dùng mô hình cục bộ đang chạy từ ứng dụng khác, với tùy chọn xác thực bằng token.
- **Sao lưu:** Xuất và khôi phục hội thoại, tài liệu, ghi chú, cài đặt. Chọn tài khoản Google Drive hoặc OneDrive để sao lưu lên đám mây. Token OAuth không được đưa vào bản sao lưu.
- **Giao diện đa ngôn ngữ:** Hỗ trợ tiếng Việt, Anh, Hàn, Nhật, Trung, Thái, Tây Ban Nha và Pháp.

### Tăng tốc MLX trên Apple Silicon

Các mô hình MLX dạng văn bản và có khả năng xử lý hình ảnh chạy qua một môi trường oMLX thống nhất. Prefix KV Memory Cache được bật mặc định để lưu trạng thái lời nhắc có thể tái sử dụng trong RAM và bộ đệm SSD phân trang. Khi có External MTP tương thích, Vyact tải cùng mô hình, xác thực cặp ghép và dùng MTP để tăng tốc giải mã trong khi vẫn giữ Memory Cache. Khả năng tương thích được đọc từ oMLX đã cài thay vì một danh sách mô hình cố định. Các mô hình DFlash tương thích dùng đường tăng tốc riêng.

### So sánh thiết lập mô hình trên phần cứng của bạn

Mở **Cài đặt mô hình > Kiểm tra hiệu năng** để so sánh chế độ hiệu năng, lượng tử hóa KV cache và MTP được hỗ trợ cho GGUF, hoặc MTP được hỗ trợ cho MLX. Mỗi tổ hợp chạy đầu vào ngắn, đầu vào dài và hội thoại tiếp nối, sau đó hiển thị thời gian đến token đầu tiên, tốc độ sinh, tổng thời gian, token tiền tố được tái sử dụng và số token vào/ra thực tế. Thời gian và tốc độ Prefill chỉ được hiển thị khi engine báo riêng; số liệu không có vẫn được ghi là không khả dụng.

Kết quả được sắp theo điểm tốc độ kết hợp thời gian đến token đầu tiên và thời gian sinh đã chuẩn hóa về 256 token đầu ra cho ba tác vụ. Đây không phải phép đo chất lượng câu trả lời hay mức tiết kiệm bộ nhớ. Chọn **Dùng thiết lập này**, rồi **Áp dụng** để kích hoạt. Vyact khôi phục mô hình và thiết lập trước đó sau khi hoàn tất, hủy hoặc gặp lỗi.

<p align="center">
  <img src="assets/readme/feature-model-benchmark.png" alt="Kết quả kiểm tra hiệu năng mô hình Vyact với thiết lập đề xuất, thời gian và số token cho từng tác vụ" width="100%" />
</p>

### Lưu ý tưởng và tìm lại bằng RAG

Sắp xếp ý tưởng, kế hoạch, quyết định và bước tiếp theo trong ghi chú rich-text có tiêu đề, trích dẫn, danh sách và khối mã. Ghi chú cũng được lập chỉ mục vào cơ sở kiến thức để RAG tự tìm thấy nội dung liên quan trong hội thoại thông thường.

<p align="center">
  <img src="assets/readme/feature-document-rag.png" alt="Quản lý tài liệu và RAG trong Vyact" width="100%" />
</p>

## Mọi thứ cần thiết để giữ nguyên bối cảnh

- **Dự án và lịch sử hội thoại:** Nhóm cuộc trò chuyện theo dự án, đặt chỉ dẫn làm việc riêng, đổi tên hoặc xuất hội thoại và quay lại đúng luồng công việc.
- **Tệp và bộ sưu tập kiến thức:** Đính kèm tệp cho một hội thoại hoặc lập chỉ mục thành kiến thức dài hạn; gom tài liệu, ghi chú và email để giới hạn phạm vi RAG.
- **Quyền chọn AI:** Dùng llama.cpp hoặc MLX cục bộ, OpenAI, Gemini, Claude hay LLM tương thích OpenAI; điều chỉnh ngữ cảnh, đầu ra, lấy mẫu, embedding và chia đoạn.
- **Google và Microsoft:** Làm việc với Gmail, Outlook, Google Drive, OneDrive và lịch ngay bên cạnh hội thoại; quản lý nhiều tài khoản bằng một danh sách chuyển đổi.
- **API tương thích OpenAI cục bộ:** Sao chép endpoint, model ID, cấu hình OpenClaw và lệnh curl từ **Cài đặt > Máy chủ API**, với xác thực Bearer token tùy chọn.
- **MCP và kỹ năng tái sử dụng:** Kết nối hệ thống tệp, GitHub hoặc MCP cục bộ/từ xa trong **Cài đặt > Công cụ AI**; quản lý chỉ dẫn lặp lại trong **Cài đặt > Kỹ năng**.
- **Quyền sở hữu dữ liệu:** Mô hình cục bộ giúp giữ bối cảnh làm việc chính trên máy. Nếu chọn AI bên ngoài, email hoặc tệp dùng làm ngữ cảnh có thể được gửi tới nhà cung cấp đó.
- **Mã nguồn mở:** Vyact được phát hành theo AGPL-3.0 để bạn kiểm tra, điều chỉnh và đóng góp.

## Một vài cách bắt đầu ngay hôm nay

| Bạn muốn… | Hãy thử trong Vyact |
| --- | --- |
| Hiểu nhanh một báo cáo | Đính kèm PDF, yêu cầu bản tóm tắt rồi mở các nguồn được truy xuất để kiểm tra. |
| Trả lời một email khó | Đính kèm chuỗi email và tệp liên quan, tạo bản nháp rồi sửa và gửi từ Gmail hoặc Outlook. |
| Xây dựng trí nhớ công việc cá nhân | Lập chỉ mục tài liệu thường dùng và lưu quyết định thành ghi chú để RAG tìm lại sau. |
| Lập kế hoạch mà không mất mạch | Tạo dự án, thêm chỉ dẫn làm việc và giữ các cuộc trao đổi liên quan cùng nhau. |
| Luyện ngoại ngữ hằng ngày | Mở hội thoại giọng nói hoặc học với phụ đề song ngữ Netflix và giải thích theo điểm yếu. |
| So sánh thiết lập mô hình cục bộ | Chạy các tổ hợp kiểm tra, so sánh kết quả rồi áp dụng thiết lập mong muốn. |
| Nghiên cứu khi duyệt web | Gửi đoạn đã chọn hoặc trang hiện tại từ Chrome thẳng vào Vyact. |

## Bắt đầu

### Cài đặt ứng dụng máy tính

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

### Kết nối LLM riêng

Chọn **Custom LLM** khi thiết lập để kết nối máy chủ có API `/chat/completions` tương thích OpenAI. Nhập Base URL, ví dụ `http://localhost:8080/v1`, Model ID và API key nếu máy chủ yêu cầu. Khả năng truyền phản hồi liên tục, gọi công cụ và nhận ảnh phụ thuộc vào máy chủ và mô hình được kết nối.

### Sử dụng tiện ích Chrome

Cài từ [Chrome Web Store](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib), mở ứng dụng Vyact trên máy tính rồi mở bảng bên của tiện ích.

- Gửi trang hiện tại hoặc đoạn văn được chọn vào hội thoại để đặt câu hỏi và dịch.
- Học với Netflix bằng phụ đề song ngữ, chuyển giữa các câu, phát lặp và tự động tạm dừng.
- Cải thiện bản nháp bằng sửa ngữ pháp hoặc điều chỉnh giọng văn; so sánh trước và sau rồi sao chép kết quả.

<p align="center">
  <img src="assets/readme/feature-writing-assistant.png" alt="Tiện ích Vyact so sánh văn bản trước và sau khi cải thiện" width="100%" />
</p>

## Hỗ trợ Vyact

Vyact là dự án mã nguồn mở được phát triển độc lập. Sự hỗ trợ giúp duy trì công việc phát triển, kiểm thử, tương thích mô hình, tài liệu và các quy trình mới. Bạn có thể hỗ trợ qua [Ko-fi](https://ko-fi.com/vyact), [PayPal](https://paypal.me/vyact) hoặc [Patreon](https://www.patreon.com/cw/vyact). Chia sẻ Vyact với người có thể thấy hữu ích cũng rất đáng quý.

## Đóng góp và góp ý

Báo lỗi hoặc đặt câu hỏi tại [Issues](https://github.com/vyact/vyact/issues); thêm `[Question]` vào đầu tiêu đề câu hỏi. Chúng tôi hoan nghênh mã nguồn, tài liệu, bản dịch, kiểm thử, ý tưởng và phản hồi quy trình. Hãy đọc [hướng dẫn đóng góp](CONTRIBUTING.md) trước khi tham gia. Vai trò và quyết định công khai được mô tả trong [nguyên tắc quản trị](GOVERNANCE.md), còn kế hoạch cộng đồng nằm trong [lộ trình cộng đồng](COMMUNITY_ROADMAP.md). Với lỗ hổng bảo mật, đừng mở issue công khai; hãy làm theo [chính sách bảo mật](SECURITY.md).

## Giấy phép

Vyact được cấp phép theo [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). Nếu cung cấp phiên bản đã sửa đổi cho người dùng qua mạng, chẳng hạn dưới dạng ứng dụng web hoặc SaaS, bạn phải cung cấp mã nguồn tương ứng theo cùng giấy phép.

## Thương hiệu và nhãn hiệu

Tên Vyact, biểu trưng và tài sản hình ảnh chính thức không được cấp phép theo AGPL-3.0. Bạn có thể nhắc chính xác đến dự án chính thức, nhưng các bản fork và phiên bản đã sửa đổi phải dùng tên và nhận diện hình ảnh khác biệt rõ ràng. Xem [Chính sách thương hiệu và nhãn hiệu Vyact](TRADEMARKS.md).
