<div align="center" markdown="1">
  <img src="assets/icon-transparent/icon_512x512.png" alt="โลโก้ Vyact" width="120" />

# Vyact

[English](README.md) · [한국어](README_KO.md) · [日本語](README_JA.md) · [ไทย](README_TH.md) · [Tiếng Việt](README_VI.md)

**Vyact คือพื้นที่ทำงาน AI ส่วนบุคคลแบบโอเพนซอร์สที่ให้ความสำคัญกับการประมวลผลภายในเครื่อง รองรับ llama.cpp, RAG, AI agent, ระบบวิเคราะห์เอกสาร และการเชื่อมต่อ Google Workspace**

### พื้นที่ทำงานส่วนตัวสำหรับการสนทนา ความรู้ และการทำงานให้สำเร็จ

เปลี่ยนไฟล์ โน้ต อีเมล และเครื่องมือที่ใช้ทุกวันให้เป็นบริบทที่เป็นประโยชน์สำหรับ AI โดยไม่ต้องออกจากขั้นตอนการทำงานเดิม

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-7c3aed.svg?style=flat-square)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/browser-Chrome%20Extension-4285f4.svg?style=flat-square)](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)
[![Latest release](https://img.shields.io/github/v/release/vyact/vyact?style=flat-square&label=release)](https://github.com/vyact/vyact/releases/latest)

[เริ่มต้นใช้งาน](#เริ่มต้นใช้งาน) · [ขั้นตอนการทำงาน](#พื้นที่ทำงานเดียวสำหรับงานประจำวัน) · [คุณสมบัติ](#ทุกสิ่งที่ช่วยให้คุณทำงานต่อเนื่องในบริบทเดิม) · [สนับสนุน Vyact](#สนับสนุน-vyact) · [ร่วมพัฒนา](CONTRIBUTING.md)
</div>

---

## โมเดลอาจเปลี่ยน แต่บริบทของคุณควรคงอยู่

คุณไม่ควรต้องค้นหาไฟล์ คัดลอกอีเมล และอธิบายที่มาใหม่ทุกครั้งที่เริ่มแชต AI Vyact รวมแชต AI เอกสาร โน้ต และเครื่องมือที่คุณใช้อยู่ไว้ในพื้นที่ทำงานเดียว คุณสามารถตรวจสอบแหล่งข้อมูลเบื้องหลังคำตอบ เปลี่ยนโน้ตให้เป็นความรู้ที่ค้นหาได้ และนำบริบทเดียวกันไปใช้กับ Gmail, Google Drive, ปฏิทิน และ Chrome

Vyact สร้างขึ้นโดยมี local LLM ผ่าน llama.cpp และ MLX เป็นศูนย์กลาง จึงช่วยเก็บบทสนทนา เอกสาร และบริบทการทำงานไว้ในสภาพแวดล้อมของคุณเอง และยังเชื่อมต่อผู้ให้บริการบนคลาวด์หรือ endpoint LLM ที่รองรับ OpenAI ของคุณได้เมื่อจำเป็น

<div align="center" markdown="1">

[![ดาวน์โหลด](https://img.shields.io/badge/Download-GitHub%20Releases-7c3aed?style=for-the-badge&logo=github&logoColor=white)](https://github.com/vyact/vyact/releases)
[![สนับสนุน Vyact](https://img.shields.io/badge/Support-Vyact-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/vyact)

</div>

## พื้นที่ทำงานเดียวสำหรับงานประจำวัน

### AI แชต ไฟล์ Google ในที่เดียว

แนบ PDF หรือเอกสารเพื่อถามคำถามและย้อนดูแหล่งข้อมูลที่รองรับคำตอบ เชื่อมต่อบัญชี Google หลายบัญชี แล้วเพิ่มข้อความและไฟล์แนบจาก Gmail รวมถึงไฟล์จาก Google Drive เข้าสู่บทสนทนาโดยตรง นอกจากนี้ Vyact ยังช่วยร่างอีเมลตอบกลับจากบริบทเดียวกันได้

<p align="center"><img src="assets/readme/feature-ai-workspace.png" alt="AI แชตของ Vyact พร้อมบริบทเอกสารและ Google Workspace" width="100%" /></p>

### ค้นหาโมเดลภายในเครื่องที่เหมาะกับฮาร์ดแวร์

ค้นหาและเปรียบเทียบโมเดล GGUF และ MLX ภายใน Vyact ดูขนาดโมเดล quantization ความจุ context, RAM / GPU VRAM ที่ตรวจพบ และการประเมินหน่วยความจำตามฮาร์ดแวร์ก่อนดาวน์โหลด ระบบ llama.cpp แบบหลาย GPU ที่รองรับจะปรับหน่วยความจำให้อัตโนมัติเป็นค่าเริ่มต้น พร้อมตัวเลือกแบ่ง GPU เองสำหรับผู้ใช้ขั้นสูง โมเดลสาธารณะไม่ต้องใช้ API key ส่วน Hugging Face key เป็นตัวเลือกสำหรับ gated model ที่บัญชีของคุณได้รับอนุญาต

<p align="center"><img src="assets/readme/feature-local-models.png" alt="การค้นหาโมเดลภายในเครื่องของ Vyact" width="100%" /></p>

#### การเร่งความเร็วด้วย MLX

บน Apple Silicon โมเดล MLX ทั้งข้อความและภาพทำงานผ่าน oMLX runtime เดียว Prefix KV Memory Cache เปิดใช้งานโดยค่าเริ่มต้นและเก็บสถานะ prompt ที่นำกลับมาใช้ได้ในหน่วยความจำและ cache แบบแบ่งหน้าบน SSD หากมี External MTP companion ที่เข้ากันได้ Vyact จะดาวน์โหลดและตรวจสอบคู่โมเดลเพื่อเร่งการถอดรหัส ความสามารถนี้อ่านจาก oMLX ที่ติดตั้งไว้ จึงติดตามเวอร์ชัน engine แทนรายการโมเดลแบบตายตัว ปัจจุบัน Speculative Prefill และ native MTP แบบฝังถูกปิดใช้งาน ส่วนโมเดล DFlash ที่รองรับจะใช้เส้นทางเร่งความเร็วเฉพาะ

### เปรียบเทียบการตั้งค่าบนฮาร์ดแวร์ของคุณ

เปิด **การตั้งค่าโมเดล > การทดสอบประสิทธิภาพ** เพื่อเปรียบเทียบ performance mode, KV cache quantization และ MTP ที่รองรับสำหรับ GGUF หรือ MTP ที่รองรับสำหรับ MLX การทดสอบใช้ข้อความสั้น ข้อความยาว และบทสนทนาต่อเนื่อง พร้อมแสดงเวลาไปยัง token แรก ความเร็วการสร้าง เวลาตอบสนองรวม prefix token ที่ใช้ซ้ำ และจำนวน token จริง ผลลัพธ์เรียงตามคะแนนความเร็วและสามารถคัดลอกค่าที่เลือกไปยังแบบฟอร์มได้ ระบบจะคืนค่าโมเดลและการตั้งค่าเดิมเมื่อเสร็จสิ้น ยกเลิก หรือล้มเหลว

<p align="center"><img src="assets/readme/feature-model-benchmark.png" alt="ผลการทดสอบประสิทธิภาพโมเดล Vyact" width="100%" /></p>

### เปลี่ยนเอกสารเป็นฐานความรู้

อัปโหลดและทำดัชนีเอกสารครั้งเดียว จากนั้น Vyact จะค้นหาส่วนที่เกี่ยวข้องกับคำถามและเพิ่มเข้า context โดยอัตโนมัติ จัดกลุ่มเอกสาร โน้ต และชุดข้อความอีเมลที่ทำดัชนีไว้เป็นคอลเลกชันความรู้เพื่อจำกัดขอบเขต RAG และตรวจสอบแหล่งข้อมูลที่ดึงมาได้เมื่อต้องการ

<p align="center"><img src="assets/readme/feature-document-rag.png" alt="การจัดการเอกสารและ RAG ใน Vyact" width="100%" /></p>

### เก็บแนวคิด แผน และการตัดสินใจ แล้วค้นหาด้วย RAG

สร้างโน้ต rich text ที่รองรับหัวข้อ คำพูด รายการ และ code block โน้ตจะถูกทำดัชนีเป็นส่วนหนึ่งของฐานความรู้เพื่อให้ RAG ค้นคืนระหว่างบทสนทนาปกติได้

<p align="center"><img src="assets/readme/feature-memo.png" alt="พื้นที่โน้ต rich text ของ Vyact" width="100%" /></p>

### ฟังคำตอบในโหมดเสียง

เปิดการอ่านออกเสียงอัตโนมัติได้ตามต้องการ ระบบจะอ่านข้อความที่สร้างเสร็จด้วยความเร็ว 1×–2× จดจำค่าการเปิด/ปิดและความเร็ว และหยุดได้ทุกเมื่อจากปุ่มหยุดของคำตอบ

### เรียนภาษาด้วยการพูด

ฝึกภาษาที่ต้องการผ่านบทสนทนาเสียงตามธรรมชาติ พูดกับ Vyact ฟังคำตอบ และสร้างความมั่นใจด้วยสำนวนจริงและการฝึกสนทนาซ้ำ ๆ

<p align="center"><img src="assets/readme/feature-voice-chat.png" alt="บทสนทนาเสียงของ Vyact" width="100%" /></p>

### เรียนภาษาจาก Netflix และทุกหน้าเว็บด้วยส่วนขยาย Chrome

ใช้คำบรรยายสองภาษา การนำทางคำบรรยาย เล่นซ้ำ หยุดอัตโนมัติ และคำอธิบาย AI แบบสั้นที่เน้นจุดอ่อนที่เลือกไว้ นอกจากนี้ยังแปลหน้าเว็บและส่งหน้าปัจจุบันหรือข้อความที่เลือกไปยังแชตได้

<p align="center"><img src="assets/readme/feature-plugin.png" alt="ส่วนขยาย Chrome ของ Vyact" width="100%" /></p>

### ปรับปรุงงานเขียนโดยไม่ออกจากหน้าเว็บ

ใช้ **ปรับปรุงงานเขียน** ในส่วนขยาย Chrome เพื่อแก้ไวยากรณ์หรือปรับสำนวนเป็นธรรมชาติ สุภาพ กระชับ หรือตลก เลือกคงภาษาเดิมหรือกำหนดภาษาผลลัพธ์ แล้วเปรียบเทียบ Before / After ก่อนคัดลอกกลับไปยังฉบับร่าง

<p align="center"><img src="assets/readme/feature-writing-assistant.png" alt="ผู้ช่วยเขียนของส่วนขยาย Chrome Vyact" width="100%" /></p>

## ทุกสิ่งที่ช่วยให้คุณทำงานต่อเนื่องในบริบทเดิม

| | ความสามารถ | ประโยชน์ |
| --- | --- | --- |
| 💬 | AI แชตแบบ streaming | สนทนาได้รวดเร็วทั้งกับโมเดลในเครื่องและบนคลาวด์ |
| 📚 | ไฟล์ คอลเลกชันความรู้ และ RAG | ใช้เอกสาร โน้ต และอีเมลเป็นบริบทที่ตรงกับงาน |
| ⚡ | ทดสอบประสิทธิภาพโมเดล | เปรียบเทียบการตั้งค่า เวลา และจำนวน token บนเครื่องของคุณ |
| 🔎 | คำตอบพร้อมแหล่งอ้างอิง | ตรวจสอบข้อความและเอกสารที่ใช้สร้างคำตอบ |
| 📝 | โน้ต rich text | จัดระเบียบแนวคิดที่ RAG สามารถค้นคืนได้ |
| 🗂️ | เชื่อมต่อ Google | ใช้ Gmail, Drive และปฏิทิน |
| ↗️ | OpenAI-compatible API ในเครื่อง | ใช้โมเดล Vyact จาก OpenClaw หรือแอปอื่นในเครือข่าย |
| 🎙️ | เรียนภาษาด้วยเสียง | ฝึกพูดด้วยเสียงเข้าและคำตอบจาก AI |
| 🌐 | ส่วนขยาย Chrome | เรียนจาก Netflix แปลเว็บ และถามคำถามจากหน้าเว็บ |
| ✍️ | ผู้ช่วยเขียนบนเบราว์เซอร์ | แก้ไวยากรณ์ ปรับโทน และเปรียบเทียบฉบับเดิมกับฉบับแก้ไข |
| 🧩 | การเชื่อมต่อเครื่องมือ MCP | เชื่อมเครื่องมือที่คุณใช้กับ Vyact |
| 🌍 | อินเทอร์เฟซหลายภาษา | รองรับเกาหลี อังกฤษ ญี่ปุ่น จีน ไทย เวียดนาม สเปน และฝรั่งเศส |

### ทำงานโดยไม่ต้องสร้างบริบทใหม่ซ้ำ ๆ

- **โปรเจกต์และประวัติการสนทนา** — จัดกลุ่มแชต กำหนดคำสั่งเฉพาะโปรเจกต์ เปลี่ยนชื่อหรือ export และกลับสู่เธรดเดิมได้
- **ไฟล์ที่ใช้งานต่อได้** — แนบครั้งเดียวหรือทำดัชนีเป็นความรู้ระยะยาว จัดเอกสาร โน้ต และอีเมลเป็นคอลเลกชันความรู้เพื่อจำกัด RAG
- **โน้ตที่ไม่หายไปในแชต** — เก็บโน้ต rich text, todo และการตัดสินใจให้ RAG เรียกใช้ภายหลัง
- **ควบคุม AI** — เลือก llama.cpp, MLX, OpenAI, Gemini, Claude หรือ OpenAI-compatible LLM และปรับ context, output, sampling, embedding และ chunking

### เชื่อมต่องานแล้วลงมือทำ

- **Gmail** — ค้นหา อ่าน แนบอีเมลและไฟล์ ร่างคำตอบ จัดการลายเซ็น โฟลเดอร์ และส่งอีเมล
- **Google Drive** — เรียกดู ค้นหา upload, download, rename, copy, share และแนบไฟล์เข้าบทสนทนาหรือฐานความรู้
- **Google Calendar** — ดู สร้าง แก้ไข และลบ event
- **การเชื่อมต่อ Google ในตัว** — ที่ **การตั้งค่า > Google** ให้อัปโหลด OAuth credentials JSON และเชื่อมหลายบัญชี เรียก Google API โดยตรงโดยไม่มี MCP server ภายนอก และไม่รวม OAuth token ใน backup export
- **สลับบัญชี** — สลับระหว่างบัญชี Google ที่เชื่อมต่อ กด **Cmd+Shift+G** บน macOS หรือ **Ctrl+Shift+G** บน Windows/Linux เพื่อเปิดหรือปิดแผง Google
- **MCP และ skill ที่ใช้ซ้ำได้** — เพิ่ม filesystem, GitHub หรือ custom MCP server ใน **การตั้งค่า > AI Tools** และจัดการคำสั่งที่ใช้ซ้ำใน **การตั้งค่า > Skills**

### รักษาความเป็นเจ้าของพื้นที่ทำงานของคุณ

- **Local-first** — ออกแบบโดยใช้ llama.cpp, MLX บน Apple Silicon และ embedding ภายในเครื่องเป็นหลัก
- **เลือกผู้ให้บริการได้** — ใช้โมเดลในเครื่อง OpenAI, Gemini, Claude หรือ endpoint ที่รองรับ OpenAI
- **ใช้โมเดลจากแอปอื่น** — เปิด **การตั้งค่า > API Server** เพื่อคัดลอก endpoint, model ID, การตั้งค่า OpenClaw หรือคำสั่ง curl รองรับ Bearer token แบบเลือกใช้
- **รู้ว่าข้อมูลออกจากเครื่องเมื่อใด** — เนื้อหาอีเมลหรือไฟล์คลาวด์ที่ใช้กับผู้ให้บริการ AI ภายนอกอาจถูกส่งไปยังผู้ให้บริการนั้น แต่เมื่อใช้โมเดลในเครื่องที่ Vyact จัดการ context แชตจะไม่ถูกส่งไปยังผู้ให้บริการ AI ภายนอก
- **สำรองข้อมูลสำคัญ** — export และ restore บทสนทนา เอกสาร ไฟล์ โน้ต prompt การตั้งค่า การเชื่อมต่อ project และคำศัพท์ รวมถึงบันทึกบน Google Drive
- **โอเพนซอร์ส** — เผยแพร่ภายใต้ AGPL-3.0

## วิธีเริ่มต้นวันนี้

| หากคุณต้องการ… | ลองทำสิ่งนี้ใน Vyact |
| --- | --- |
| เข้าใจรายงานอย่างรวดเร็ว | แนบ PDF ขอ briefing แบบกระชับ แล้วตรวจสอบ source ที่ดึงมา |
| ตอบอีเมลที่ยาก | แนบเธรดและไฟล์ Drive ขอร่างในสำนวนของคุณ แล้วแก้และส่งจาก Gmail |
| สร้างความจำส่วนตัวสำหรับงาน | ทำดัชนีเอกสารและบันทึกการตัดสินใจเป็นโน้ต เพื่อให้ RAG ค้นคืนภายหลัง |
| วางแผนโปรเจกต์โดยไม่เสียบริบท | สร้างโปรเจกต์ เพิ่มคำสั่ง เก็บการสนทนาไว้ด้วยกัน และ export เมื่อจำเป็น |
| ฝึกภาษาใหม่ทุกวัน | ใช้ voice chat หรือ Netflix พร้อมคำบรรยายสองภาษาและคำอธิบายจุดอ่อน |
| เปรียบเทียบการตั้งค่าโมเดล | เปิดการทดสอบประสิทธิภาพ เปรียบเทียบชุดค่า และใช้ค่าที่ต้องการ |
| ค้นคว้าระหว่างท่องเว็บ | ส่งข้อความที่เลือกหรือหน้าปัจจุบันจาก Chrome ไปยัง Vyact |

## เริ่มต้นใช้งาน

### ติดตั้งแอปเดสก์ท็อป

ดาวน์โหลดสำหรับ **Mac แบบ Apple Silicon (M1 ขึ้นไป)**, **Windows** หรือ **Linux x64** จาก [GitHub Releases](https://github.com/vyact/vyact/releases) macOS ใช้ DMG, Windows ใช้ EXE และ Linux ใช้ AppImage / DEB ปัจจุบันยังไม่รองรับ Mac ที่ใช้ Intel

Linux AppImage:

```bash
chmod +x Vyact-*.AppImage
./Vyact-*.AppImage
```

Ubuntu / Debian:

```bash
sudo apt install ./vyact_*_amd64.deb
```

หลังติดตั้ง DEB ให้เปิด **Vyact** จากเมนูแอปพลิเคชัน

### ก่อนเปิดใช้งานครั้งแรก

Vyact มี Python 3.12 ในตัวและจัดการ local model runtime ให้ GGUF ทำงานผ่าน llama.cpp / llama-swap และ MLX ที่รองรับบน Apple Silicon ทำงานผ่าน oMLX

| แพลตฟอร์ม | สิ่งที่แอปหลักต้องใช้ | ข้อกำหนดตามคุณสมบัติ |
| --- | --- | --- |
| macOS (Apple Silicon) | ไม่มี | **Local GGUF**: แนะนำ [Homebrew](https://brew.sh/) เพื่อติดตั้ง binary ที่ขาด หรือใช้ `llama-server` / `llama-swap` ที่เข้ากันได้<br><br>**Local MLX**: แนะนำ Homebrew เพื่อติดตั้งหรืออัปเดต oMLX หรือใช้ `omlx` ที่เข้ากันได้<br><br>**Elasticsearch**: native mode ไม่พึ่งพาภายนอก; Docker Desktop เป็นตัวเลือกสำหรับ container mode<br><br>**Kokoro TTS**: ต้องใช้ Homebrew เฉพาะเมื่อจำเป็นต้องติดตั้ง `espeak-ng` |
| Windows | ไม่มี | **Local GGUF**: แนะนำ `winget` เพื่อติดตั้ง binary ที่ขาด หรือใช้ `llama-server` / `llama-swap` ที่เข้ากันได้<br><br>**Elasticsearch**: native mode ไม่พึ่งพาภายนอก; Docker Desktop เป็นตัวเลือก<br><br>**Kokoro TTS**: ต้องใช้ `winget` เฉพาะเมื่อต้องติดตั้ง `espeak-ng` |
| Linux (x64) | desktop x86-64 ที่ใช้ glibc 2.35+; DEB ติดตั้ง desktop library dependency ที่ประกาศไว้ผ่าน APT | **Local GGUF**: มี CPU runtime ให้ ไม่ต้องใช้ Homebrew<br><br>**Elasticsearch**: native mode ไม่พึ่งพาภายนอก; Docker เป็นตัวเลือก<br><br>**Browser / Kokoro TTS**: เมื่อขาด library หรือ `espeak-ng` ต้องมี package manager (`apt-get`, `dnf`, `zypper`, `pacman`) และ PolicyKit authentication agent Vyact ขอสิทธิ์ผ่าน `pkexec`; หากไม่มีจะลองเฉพาะ passwordless/cached `sudo` |

บน macOS, Windows และ Linux Vyact ดาวน์โหลดและรัน native Elasticsearch ที่รองรับได้ จึงไม่จำเป็นต้องใช้ Docker package manager จำเป็นเฉพาะเมื่อคุณสมบัติที่เลือกต้องใช้ system binary ที่ยังไม่มี และการเปิดครั้งแรกจะเตรียม component ตาม configuration ที่เลือก

### ห้านาทีแรก

1. เปิด Vyact แล้วเลือก provider และ model เลือก **Vyact** เพื่อค้นหาและดาวน์โหลดโมเดล GGUF / MLX ในเครื่อง
2. วางเอกสารหรือเปิด **การจัดการเอกสาร** เพื่อทำดัชนี และสร้างคอลเลกชันความรู้เมื่อต้องการจำกัด RAG
3. ถามคำถามในแชตและตรวจสอบ context ที่ดึงมาเมื่อความถูกต้องสำคัญ
4. เชื่อม Google จาก **การตั้งค่า > Google** หรือติดตั้งส่วนขยาย Chrome
5. สร้างโน้ต project หรือ skill ที่นำกลับมาใช้ได้สำหรับงานที่ทำซ้ำ

### เชื่อมต่อผู้ให้บริการ LLM แบบกำหนดเอง

Vyact เชื่อมต่อ API ที่รองรับ OpenAI `/chat/completions` ได้ เลือก **Custom LLM** ระหว่างตั้งค่าเริ่มต้น หรือเพิ่มภายหลังจาก provider controls

- **ชื่อการเชื่อมต่อ** — ป้ายชื่อที่แสดงใน Vyact
- **Base URL** — API root ที่ไม่มี `/chat/completions` เช่น `http://localhost:11434/v1`
- **API key** — เลือกเว้นว่างได้สำหรับ local server; ต้องมีเมื่อ endpoint ใช้ Bearer authentication
- **Model ID** — model identifier ที่ API ต้องการ
- **Header เพิ่มเติม** — สำหรับ gateway หรือ authentication ขององค์กร

```text
Connection name: Local LLM
Base URL: http://localhost:8080/v1
API key: (leave blank)
Model ID: my-local-model
Additional headers: (none)
```

ค่าการเชื่อมต่อรวมอยู่ใน backup / restore ส่วน streaming, tool calling และภาพขึ้นอยู่กับความสามารถและ OpenAI compatibility ของ server / model

### ใช้ส่วนขยาย Chrome

1. [ติดตั้ง Vyact จาก Chrome Web Store](https://chromewebstore.google.com/detail/vyact/opfbakfhoojmdkbbhcglolkpgmenjbib)
2. เปิดแอปเดสก์ท็อป Vyact
3. ปักหมุด Vyact บนแถบเครื่องมือแล้วเปิด side panel บนหน้าใดก็ได้

## สนับสนุน Vyact

Vyact พัฒนาอย่างอิสระและเผยแพร่เป็นโอเพนซอร์ส การสนับสนุนช่วยดูแลการพัฒนา การทดสอบ ความเข้ากันได้ของโมเดล เอกสาร และขั้นตอนการทำงานใหม่ ๆ การแบ่งปัน Vyact ให้ผู้ที่น่าจะได้รับประโยชน์ก็มีคุณค่าไม่แพ้การสนับสนุนทางการเงิน

<div align="center" markdown="1">

[![Ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/vyact)
[![PayPal](https://img.shields.io/badge/Support%20with-PayPal-00457c?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/vyact)
[![Patreon](https://img.shields.io/badge/Support%20on-Patreon-f96854?style=for-the-badge&logo=patreon&logoColor=white)](https://www.patreon.com/cw/vyact)

**ขอบคุณที่ช่วยให้ Vyact ยังคงเป็นอิสระ เปิดกว้าง และได้รับการพัฒนาอย่างต่อเนื่อง**
</div>

## การร่วมพัฒนาและข้อเสนอแนะ

เรายินดีรับโค้ด เอกสาร งานแปล การทดสอบ ไอเดีย รายงานบั๊ก และข้อเสนอแนะเกี่ยวกับขั้นตอนการทำงาน โปรดอ่าน [CONTRIBUTING.md](CONTRIBUTING.md) ก่อนร่วมพัฒนา สำหรับช่องโหว่ด้านความปลอดภัย โปรดอย่าเปิด issue สาธารณะ และให้ปฏิบัติตาม [นโยบายความปลอดภัย](SECURITY.md)

บทบาทของโปรเจกต์และการตัดสินใจสาธารณะอธิบายใน [GOVERNANCE.md](GOVERNANCE.md) แผน discussion board, real-time chat และฐานความรู้ support อยู่ใน [community roadmap](COMMUNITY_ROADMAP.md) และ [AWS infrastructure plan](docs/AWS_COMMUNITY_INFRASTRUCTURE.md) หากต้องการความช่วยเหลือ ให้เปิด issue โดยขึ้นต้นชื่อด้วย `[Question]`

## ใบอนุญาต

Vyact ใช้ [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0) หากแก้ไขและให้ผู้ใช้เข้าถึงรุ่นแก้ไขผ่านเครือข่าย เช่น web app หรือ SaaS ต้องเปิดเผย source code ที่เกี่ยวข้องภายใต้ใบอนุญาตเดียวกัน

## แบรนด์และเครื่องหมายการค้า

ชื่อ โลโก้ และทรัพย์สินภาพแบรนด์ทางการของ Vyact ไม่ได้อยู่ภายใต้ AGPL-3.0 คุณอ้างถึงโปรเจกต์ทางการอย่างถูกต้องได้ แต่ fork และรุ่นแก้ไขต้องใช้ชื่อและอัตลักษณ์ที่ต่างอย่างชัดเจน โปรดอ่าน [นโยบายแบรนด์และเครื่องหมายการค้า](TRADEMARKS.md)
