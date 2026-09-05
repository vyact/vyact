<div align="center" markdown="1">
  <img src="assets/icon-transparent/icon_512x512.png" alt="Logo Vyact" width="120" />

# Vyact

[English](README.md) · [한국어](README_KO.md) · [日本語](README_JA.md) · [ไทย](README_TH.md) · [Tiếng Việt](README_VI.md)

**Vyact là không gian làm việc AI cá nhân mã nguồn mở, ưu tiên xử lý cục bộ, dành cho llama.cpp, RAG, AI agent, trí tuệ tài liệu và tích hợp Google Workspace / Microsoft.**

### Không gian riêng tư cho hội thoại, tri thức và công việc

Biến tệp, ghi chú, email và công cụ hằng ngày thành ngữ cảnh hữu ích cho AI mà không làm gián đoạn quy trình làm việc.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-7c3aed.svg?style=flat-square)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/browser-Chrome%20Extension-4285f4.svg?style=flat-square)](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)
[![Latest release](https://img.shields.io/github/v/release/vyact/vyact?style=flat-square&label=release)](https://github.com/vyact/vyact/releases/latest)

[Bắt đầu](#bắt-đầu) · [Quy trình](#một-không-gian-cho-công-việc-hằng-ngày) · [Tính năng](#mọi-thứ-bạn-cần-để-duy-trì-ngữ-cảnh) · [Ủng hộ Vyact](#ủng-hộ-vyact) · [Đóng góp](CONTRIBUTING.md)
</div>

---

## Mô hình có thể thay đổi, nhưng ngữ cảnh của bạn nên được giữ lại

Bạn không cần tìm lại tệp, sao chép email và giải thích bối cảnh từ đầu mỗi khi mở một cuộc trò chuyện AI. Vyact kết hợp AI chat, tài liệu, ghi chú và các công cụ quen thuộc trong một không gian làm việc. Bạn có thể kiểm tra nguồn của câu trả lời, biến ghi chú thành tri thức có thể tìm kiếm và sử dụng cùng ngữ cảnh với Gmail, Outlook, Google Drive, OneDrive, lịch và Chrome.

Được xây dựng xoay quanh LLM cục bộ qua llama.cpp và MLX, Vyact giúp giữ hội thoại, tài liệu và ngữ cảnh làm việc trong môi trường của bạn. Khi cần, bạn vẫn có thể kết nối nhà cung cấp đám mây hoặc endpoint LLM tương thích OpenAI của riêng mình.

<div align="center" markdown="1">

[![Tải xuống](https://img.shields.io/badge/Download-GitHub%20Releases-7c3aed?style=for-the-badge&logo=github&logoColor=white)](https://github.com/vyact/vyact/releases)
[![Ủng hộ Vyact](https://img.shields.io/badge/Support-Vyact-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/vyact)

</div>

## Một không gian cho công việc hằng ngày

### AI chat, tệp, Google và Microsoft trong cùng một nơi

Đính kèm PDF hoặc tài liệu để đặt câu hỏi rồi truy ngược đến nguồn hỗ trợ câu trả lời. Kết nối nhiều tài khoản Google và Microsoft; đưa thư và tệp đính kèm từ Gmail hoặc Outlook, cũng như tệp Google Drive hoặc OneDrive, trực tiếp vào cuộc trò chuyện. Vyact cũng có thể giúp soạn email trả lời từ chính ngữ cảnh đó.

<p align="center"><img src="assets/readme/feature-ai-workspace.png" alt="AI chat Vyact với ngữ cảnh tài liệu và Google Workspace" width="100%" /></p>

### Tìm mô hình cục bộ phù hợp với phần cứng

Tìm kiếm và so sánh mô hình GGUF và MLX ngay trong Vyact. Xem kích thước, mức lượng tử hóa, dung lượng context, RAM / GPU VRAM được phát hiện và ước tính bộ nhớ theo phần cứng trước khi tải. Trên hệ thống llama.cpp đa GPU tương thích, tự động cân chỉnh bộ nhớ là mặc định và người dùng nâng cao có thể chia GPU thủ công. Mô hình công khai không cần API key; Hugging Face key tùy chọn cho phép truy cập gated model mà tài khoản của bạn được cấp quyền.

<p align="center"><img src="assets/readme/feature-local-models.png" alt="Tìm kiếm mô hình cục bộ trong Vyact" width="100%" /></p>

#### Cách tăng tốc MLX hoạt động

Trên Apple Silicon, mô hình MLX hỗ trợ văn bản và hình ảnh chạy qua một oMLX runtime duy nhất. Prefix KV Memory Cache được bật mặc định, lưu trạng thái prompt có thể tái sử dụng trong bộ nhớ và cache SSD phân trang. Khi có External MTP companion tương thích, Vyact tải xuống, xác thực cặp mô hình và dùng MTP để giải mã nhanh hơn. Khả năng này được đọc từ oMLX đã cài đặt nên bám theo phiên bản engine thay vì danh sách mô hình cố định. Speculative Prefill và native MTP nhúng hiện bị tắt; mô hình DFlash tương thích dùng đường tăng tốc riêng.

### So sánh cài đặt trên phần cứng của bạn

Mở **Cài đặt mô hình > Kiểm tra hiệu năng** để so sánh performance mode, KV cache quantization và MTP được hỗ trợ cho GGUF, hoặc MTP được hỗ trợ cho MLX. Mỗi tổ hợp chạy đầu vào ngắn, đầu vào dài và hội thoại tiếp nối; hiển thị thời gian đến token đầu tiên, tốc độ sinh, tổng thời gian phản hồi, prefix token tái sử dụng và số token vào/ra thực tế. Kết quả được xếp theo điểm tốc độ và có thể sao chép vào biểu mẫu cài đặt. Vyact khôi phục mô hình cùng cài đặt trước đó sau khi hoàn tất, hủy hoặc gặp lỗi.

<p align="center"><img src="assets/readme/feature-model-benchmark.png" alt="Kết quả kiểm tra hiệu năng mô hình Vyact" width="100%" /></p>

### Biến tài liệu thành cơ sở tri thức

Tải lên và lập chỉ mục tài liệu một lần. Trong hội thoại bình thường, Vyact tự động truy xuất đoạn liên quan nhất rồi thêm vào context. Nhóm tài liệu, ghi chú và chuỗi email đã lập chỉ mục thành bộ sưu tập tri thức để giới hạn phạm vi RAG, đồng thời kiểm tra nguồn đã truy xuất khi cần.

<p align="center"><img src="assets/readme/feature-document-rag.png" alt="Quản lý tài liệu và RAG trong Vyact" width="100%" /></p>

### Lưu ý tưởng, kế hoạch, quyết định và tìm lại bằng RAG

Tạo ghi chú rich text với tiêu đề, trích dẫn, danh sách và code block. Ghi chú cũng được lập chỉ mục trong cơ sở tri thức để RAG tự động truy xuất trong hội thoại.

<p align="center"><img src="assets/readme/feature-memo.png" alt="Không gian ghi chú rich text của Vyact" width="100%" /></p>

### Chế độ giọng nói và học ngôn ngữ

Tùy chọn đọc tự động phát các câu đã hoàn tất với tốc độ điều chỉnh từ 1× đến 2×. Bạn có thể luyện ngôn ngữ bằng hội thoại giọng nói tự nhiên, hoặc dùng tiện ích Chrome để học với Netflix qua phụ đề song ngữ, điều hướng phụ đề, phát lặp, tự động tạm dừng và giải thích AI ngắn tập trung vào điểm yếu đã chọn. Tiện ích cũng có thể dịch trang và gửi trang hiện tại hoặc đoạn văn được chọn vào chat.

<p align="center"><img src="assets/readme/feature-voice-chat.png" alt="Hội thoại giọng nói Vyact" width="100%" /></p>
<p align="center"><img src="assets/readme/feature-plugin.png" alt="Tiện ích Chrome Vyact" width="100%" /></p>

### Cải thiện bài viết mà không rời trang

Dùng **Cải thiện bài viết** trong tiện ích Chrome để sửa ngữ pháp hoặc đổi cách diễn đạt thành tự nhiên, lịch sự, súc tích hay hài hước. Giữ nguyên ngôn ngữ hoặc chọn ngôn ngữ đầu ra, rồi so sánh Before / After trước khi sao chép kết quả về bản nháp.

<p align="center"><img src="assets/readme/feature-writing-assistant.png" alt="Trợ lý viết trong tiện ích Chrome Vyact" width="100%" /></p>

## Mọi thứ bạn cần để duy trì ngữ cảnh

| | Khả năng | Lợi ích |
| --- | --- | --- |
| 💬 | AI chat streaming | Hội thoại nhanh với cả mô hình cục bộ và đám mây. |
| 📚 | Tệp, bộ sưu tập tri thức và RAG | Dùng tài liệu, ghi chú và email làm đúng ngữ cảnh cho công việc. |
| ⚡ | Kiểm tra hiệu năng mô hình | So sánh cài đặt, thời gian và số token trên máy của bạn. |
| 🔎 | Câu trả lời có nguồn | Kiểm tra đoạn văn và tài liệu đã cung cấp thông tin cho câu trả lời. |
| 📝 | Ghi chú rich text | Sắp xếp ý tưởng để RAG có thể tìm lại khi trò chuyện. |
| 🗂️ | Tích hợp Google / Microsoft | Làm việc với Gmail, Outlook, Drive, OneDrive và lịch. |
| ↗️ | API cục bộ tương thích OpenAI | Dùng mô hình Vyact từ OpenClaw hoặc ứng dụng khác trong mạng. |
| 🎙️ | Học ngôn ngữ bằng giọng nói | Luyện nói với đầu vào giọng nói và phản hồi AI. |
| 🌐 | Tiện ích Chrome | Học từ Netflix, dịch trang và hỏi từ nội dung web. |
| ✍️ | Trợ lý viết trên trình duyệt | Sửa ngữ pháp, đổi giọng văn và so sánh bản gốc với bản sửa. |
| 🧩 | Kết nối công cụ MCP | Kết nối các công cụ bạn dùng với Vyact. |
| 🌍 | Giao diện đa ngôn ngữ | Có tiếng Hàn, Anh, Nhật, Trung, Thái, Việt, Tây Ban Nha và Pháp. |

### Giữ quyền sở hữu không gian làm việc

- **Ưu tiên cục bộ** — Thiết kế xoay quanh llama.cpp, MLX trên Apple Silicon và embedding cục bộ.
- **Tự chọn nhà cung cấp** — Dùng mô hình cục bộ, OpenAI, Gemini, Claude hoặc endpoint tương thích OpenAI.
- **Dùng mô hình từ ứng dụng khác** — Mở **Cài đặt > API Server** để sao chép endpoint, model ID, cấu hình OpenClaw hoặc lệnh curl. Hỗ trợ Bearer token tùy chọn.
- **Biết khi nào dữ liệu rời máy** — Nội dung email hoặc tệp đám mây dùng với nhà cung cấp AI bên ngoài có thể được gửi đến nhà cung cấp đó. Với mô hình cục bộ do Vyact quản lý, context chat không được gửi đến nhà cung cấp AI bên ngoài.
- **Sao lưu dữ liệu quan trọng** — Export và restore hội thoại, tài liệu, tệp, ghi chú, prompt, cài đặt, kết nối, project và từ vựng; có thể lưu lên Google Drive / OneDrive.
- **Mã nguồn mở** — Phát hành theo AGPL-3.0.

## Bắt đầu

### Cài đặt ứng dụng desktop

Tải Vyact cho **Mac Apple Silicon (M1 trở lên)**, **Windows** hoặc **Linux x64** từ [GitHub Releases](https://github.com/vyact/vyact/releases). macOS dùng DMG, Windows dùng EXE, Linux dùng AppImage / DEB. Mac Intel hiện chưa được hỗ trợ.

Linux AppImage:

```bash
chmod +x Vyact-*.AppImage
./Vyact-*.AppImage
```

Ubuntu / Debian:

```bash
sudo apt install ./vyact_*_amd64.deb
```

Vyact tích hợp Python 3.12 và quản lý local model runtime. GGUF chạy qua llama.cpp / llama-swap; mô hình MLX tương thích trên Apple Silicon chạy qua oMLX. Homebrew trên macOS và `winget` trên Windows được khuyến nghị để tự động cài binary còn thiếu. Gói Linux gồm CPU runtime dựng trên Ubuntu 22.04 (glibc 2.35 trở lên) và ưu tiên runtime tương thích có sẵn, kể cả bản hỗ trợ GPU. Vyact có thể tải bản phân phối Elasticsearch native tương thích nên không bắt buộc dùng Docker.

### Năm phút đầu tiên

1. Khởi động Vyact rồi chọn provider và model. Chọn **Vyact** để tìm và tải mô hình GGUF / MLX cục bộ.
2. Thả tài liệu vào hoặc mở **Quản lý tài liệu** để lập chỉ mục; tạo bộ sưu tập tri thức khi cần giới hạn RAG.
3. Đặt câu hỏi trong chat và kiểm tra context được truy xuất khi độ chính xác quan trọng.
4. Kết nối Google từ **Cài đặt > Google**, Microsoft từ **Cài đặt > Microsoft**, hoặc cài tiện ích Chrome.
5. Tạo ghi chú, project hoặc skill tái sử dụng cho quy trình lặp lại.

### Kết nối nhà cung cấp LLM tùy chỉnh

Vyact kết nối được với API triển khai `/chat/completions` tương thích OpenAI. Hãy cấu hình tên kết nối, Base URL không có `/chat/completions`, API key tùy chọn, Model ID chính xác và header bổ sung nếu cần. Streaming, tool calling và đầu vào hình ảnh phụ thuộc vào khả năng của server và model được kết nối.

### Dùng tiện ích Chrome

1. [Cài Vyact từ Chrome Web Store](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib).
2. Khởi động ứng dụng desktop Vyact.
3. Ghim Vyact vào thanh công cụ và mở side panel trên bất kỳ trang nào.

## Ủng hộ Vyact

Vyact được phát triển độc lập và phát hành dưới dạng mã nguồn mở. Sự ủng hộ giúp duy trì việc phát triển, kiểm thử, tương thích mô hình, tài liệu và các quy trình mới. Chia sẻ Vyact với người có thể hưởng lợi cũng quý giá như hỗ trợ tài chính.

<div align="center" markdown="1">

[![Ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/vyact)
[![PayPal](https://img.shields.io/badge/Support%20with-PayPal-00457c?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/vyact)
[![Patreon](https://img.shields.io/badge/Support%20on-Patreon-f96854?style=for-the-badge&logo=patreon&logoColor=white)](https://www.patreon.com/cw/vyact)

**Cảm ơn bạn đã giúp Vyact duy trì tính độc lập, cởi mở và phát triển liên tục.**
</div>

## Đóng góp và phản hồi

Chúng tôi hoan nghênh mã nguồn, tài liệu, bản dịch, kiểm thử, ý tưởng, báo lỗi và phản hồi về quy trình. Vui lòng đọc [CONTRIBUTING.md](CONTRIBUTING.md) trước khi đóng góp. Với lỗ hổng bảo mật, đừng mở issue công khai; hãy làm theo [chính sách bảo mật](SECURITY.md).

## Giấy phép và thương hiệu

Vyact được cấp phép theo [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). Nếu sửa đổi Vyact và cung cấp phiên bản đó cho người dùng qua mạng, bạn phải cung cấp mã nguồn tương ứng theo cùng giấy phép. Tên, logo và tài sản nhận diện chính thức của Vyact không thuộc giấy phép AGPL-3.0. Các fork và phiên bản sửa đổi phải dùng tên và nhận diện khác biệt rõ ràng. Xem [Chính sách thương hiệu và nhãn hiệu Vyact](TRADEMARKS.md).
