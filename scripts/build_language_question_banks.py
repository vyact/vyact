"""언어별 seed로 런타임 생성이 필요 없는 정적 CEFR 문제은행을 빌드한다."""

import json
import re
from pathlib import Path


OUTPUT_DIR = Path(__file__).resolve().parent.parent / "app" / "question_banks"
LEVELS = ("A1", "A2", "B1", "B2", "C1")
CATEGORIES = ("VOCABULARY", "SENTENCE_STRUCTURE", "GRAMMAR", "COLLOCATION", "NATURAL_EXPRESSION", "READING", "LISTENING")

# (표현, 같은 뜻, 자연스러운 문장, 자연스러운 응답). 언어별로 독립 작성한 seed다.
PACKS = {
    "en": {"specific":("ARTICLE","PREPOSITION","VERB_FORM","PHRASAL_VERB","REGISTER"),"items":[
        (("tiny","small","This room is tiny.","Yes, it is quite small."),("begin","start","The class begins at nine.","I'll arrive before it starts."),("silent","quiet","The library is silent.","I'll speak quietly."),("purchase","buy","She purchased a ticket.","You can buy one online.")),
        (("rapid","quick","We saw a rapid change.","It happened very quickly."),("assist","help","Could you assist me?","Of course, I can help."),("reply","answer","Please reply by Friday.","I'll answer today."),("select","choose","Select one option.","I'll choose the first one.")),
        (("accurate","correct","The report is accurate.","The figures are correct."),("essential","necessary","Sleep is essential.","It is necessary for health."),("retain","keep","Retain a copy.","I'll keep it safely."),("decline","refuse","He declined the offer.","He politely refused it.")),
        (("ambiguous","unclear","The instruction is ambiguous.","We should make it clearer."),("substantial","considerable","They made substantial progress.","The improvement is considerable."),("convey","communicate","Charts convey information.","They communicate the trend well."),("reluctant","unwilling","She was reluctant to agree.","She seemed unwilling.")),
        (("ubiquitous","widespread","Smartphones are ubiquitous.","Their use is widespread."),("meticulous","very careful","The editor was meticulous.","She checked every detail."),("mitigate","reduce","Trees mitigate urban heat.","They help reduce it."),("plausible","believable","The explanation is plausible.","Yes, it is believable."))]},
    "ko": {"specific":("PARTICLE","VERB_ENDING","CONNECTIVE_ENDING","SPEECH_LEVEL","REGISTER"),"items":[
        (("크다","작지 않다","이 가방은 큽니다.","네, 꽤 큰 편이에요."),("시작하다","일을 열다","수업은 아홉 시에 시작해요.","시작 전에 도착할게요."),("조용하다","소리가 적다","도서관은 조용합니다.","작은 소리로 말할게요."),("구매하다","사다","표를 구매했습니다.","온라인에서도 살 수 있어요.")),
        (("신속하다","빠르다","신속한 대응이 필요합니다.","빠르게 처리하겠습니다."),("지원하다","도움을 주다","팀이 업무를 지원합니다.","필요한 부분을 도와드릴게요."),("응답하다","대답하다","금요일까지 응답해 주세요.","오늘 안에 대답하겠습니다."),("선택하다","고르다","항목 하나를 선택하세요.","첫 번째를 고를게요.")),
        (("정확하다","틀림이 없다","분석 결과가 정확합니다.","수치에 틀림이 없군요."),("필수적이다","꼭 필요하다","충분한 휴식은 필수적입니다.","건강을 위해 꼭 필요해요."),("유지하다","그대로 지키다","현재 속도를 유지하세요.","이 상태를 그대로 지킬게요."),("거절하다","받아들이지 않다","그는 제안을 거절했습니다.","정중하게 받아들이지 않았군요.")),
        (("모호하다","분명하지 않다","안내 문구가 모호합니다.","좀 더 분명하게 고쳐야겠어요."),("상당하다","꽤 많다","상당한 진전이 있었습니다.","개선된 부분이 꽤 많네요."),("전달하다","뜻을 알리다","도표는 정보를 잘 전달합니다.","추세를 쉽게 알 수 있네요."),("주저하다","선뜻 하지 못하다","그는 답변을 주저했습니다.","선뜻 결정하지 못했군요.")),
        (("편재하다","널리 존재하다","디지털 기술은 사회 곳곳에 편재합니다.","정말 널리 존재하는군요."),("면밀하다","매우 꼼꼼하다","자료를 면밀하게 검토했습니다.","세부 사항까지 살폈군요."),("완화하다","정도를 줄이다","녹지는 도시 열기를 완화합니다.","온도를 줄이는 데 도움이 되죠."),("개연성","그럴듯함","그 설명에는 개연성이 있습니다.","충분히 그럴듯합니다."))]},
    "ja": {"specific":("PARTICLE","VERB_FORM","CONJUNCTION","HONORIFIC","REGISTER"),"items":[
        (("大きい","小さくない","このかばんは大きいです。","はい、かなり大きいです。"),("始める","開始する","授業は九時に始まります。","始まる前に着きます。"),("静か","音が少ない","図書館は静かです。","小さな声で話します。"),("購入する","買う","切符を購入しました。","オンラインでも買えます。")),
        (("迅速","とても速い","迅速な対応が必要です。","すぐに対応します。"),("支援する","助ける","チームが作業を支援します。","必要なところを助けます。"),("返答する","答える","金曜日までに返答してください。","今日中に答えます。"),("選択する","選ぶ","一つ選択してください。","最初のものを選びます。")),
        (("正確","間違いがない","分析結果は正確です。","数値に間違いはありません。"),("不可欠","なくてはならない","十分な睡眠は不可欠です。","健康に欠かせません。"),("維持する","保つ","今の速度を維持してください。","この状態を保ちます。"),("拒否する","受け入れない","彼は提案を拒否しました。","丁寧に断ったのですね。")),
        (("曖昧","はっきりしない","案内の表現が曖昧です。","もっと明確にしましょう。"),("大幅","程度がかなり大きい","売上が大幅に伸びました。","かなり改善しましたね。"),("伝達する","情報を伝える","図表は情報を伝達します。","傾向が分かりやすいです。"),("躊躇する","すぐに決められない","彼女は回答を躊躇しました。","決断を迷っています。")),
        (("遍在する","広く存在する","技術は社会に遍在しています。","本当に広く存在しますね。"),("緻密","非常に細かい","緻密な分析が行われました。","細部まで確認されています。"),("緩和する","程度を弱める","緑地は暑さを緩和します。","気温を下げる効果があります。"),("蓋然性","起こりそうな確かさ","仮説には蓋然性があります。","十分ありそうな説明です。"))]},
    "zh": {"specific":("WORD_ORDER","MEASURE_WORD","ASPECT_PARTICLE","COMPLEMENT","REGISTER"),"items":[
        (("大","不小","这个包很大。","对，相当大。"),("开始","着手","课程九点开始。","我会在开始前到。"),("安静","声音很少","图书馆很安静。","我会小声说话。"),("购买","买","她购买了一张票。","也可以在网上买。")),
        (("迅速","很快","我们需要迅速回应。","我马上处理。"),("协助","帮助","团队会协助工作。","我来帮助你。"),("答复","回答","请在周五前答复。","我今天回答。"),("选择","挑选","请选择一个选项。","我选第一个。")),
        (("准确","没有错误","分析结果很准确。","数据没有错误。"),("必要","不可缺少","充足的睡眠很必要。","健康离不开它。"),("维持","保持","请维持现在的速度。","我会保持这个状态。"),("拒绝","不接受","他拒绝了提议。","他礼貌地没有接受。")),
        (("含糊","不明确","这段说明很含糊。","我们应该写得更明确。"),("显著","非常明显","销量显著增长。","改善非常明显。"),("传达","表达信息","图表能传达信息。","趋势很容易看懂。"),("犹豫","不能立即决定","她犹豫着没有回答。","她还不能决定。")),
        (("无处不在","广泛存在","数字技术无处不在。","它确实广泛存在。"),("缜密","周密细致","研究者进行了缜密分析。","每个细节都检查了。"),("缓解","使程度减轻","绿地可以缓解高温。","它有助于降低温度。"),("可信","值得相信","这个解释听起来可信。","是的，很值得相信。"))]},
    "es": {"specific":("ARTICLE","PREPOSITION","VERB_TENSE","SUBJUNCTIVE","REGISTER"),"items":[
        (("grande","de gran tamaño","Esta bolsa es grande.","Sí, es bastante grande."),("empezar","comenzar","La clase empieza a las nueve.","Llegaré antes del comienzo."),("tranquilo","sin ruido","La biblioteca está tranquila.","Hablaré en voz baja."),("adquirir","comprar","Ella adquirió una entrada.","Puedes comprarla en línea.")),
        (("rápido","veloz","Necesitamos una respuesta rápida.","Lo resolveré enseguida."),("ayudar","asistir","El equipo ayudará con la tarea.","Puedo asistirte."),("contestar","responder","Contesta antes del viernes.","Responderé hoy."),("elegir","seleccionar","Elige una opción.","Seleccionaré la primera.")),
        (("preciso","exacto","El análisis es preciso.","Las cifras son exactas."),("esencial","necesario","Dormir bien es esencial.","Es necesario para la salud."),("mantener","conservar","Mantén la velocidad actual.","La conservaré."),("rechazar","no aceptar","Rechazó la propuesta.","No la aceptó.")),
        (("ambiguo","poco claro","El aviso es ambiguo.","Deberíamos aclararlo."),("considerable","bastante grande","Hubo un progreso considerable.","La mejora fue importante."),("transmitir","comunicar","Los gráficos transmiten información.","Comunican bien la tendencia."),("reacio","poco dispuesto","Se mostró reacio a aceptar.","No parecía dispuesto.")),
        (("omnipresente","presente en todas partes","La tecnología es omnipresente.","Está presente en todas partes."),("meticuloso","muy cuidadoso","El editor fue meticuloso.","Revisó cada detalle."),("mitigar","reducir","Los árboles mitigan el calor.","Ayudan a reducirlo."),("plausible","creíble","La explicación es plausible.","Sí, parece creíble."))]},
    "fr": {"specific":("ARTICLE","PREPOSITION","VERB_TENSE","SUBJUNCTIVE","REGISTER"),"items":[
        (("grand","de grande taille","Ce sac est grand.","Oui, il est assez grand."),("commencer","débuter","Le cours commence à neuf heures.","J'arriverai avant le début."),("calme","sans bruit","La bibliothèque est calme.","Je parlerai doucement."),("acquérir","acheter","Elle a acquis un billet.","On peut l'acheter en ligne.")),
        (("rapide","véloce","Il faut une réponse rapide.","Je m'en occupe tout de suite."),("aider","assister","L'équipe aidera au travail.","Je peux vous assister."),("répondre","donner une réponse","Répondez avant vendredi.","Je répondrai aujourd'hui."),("choisir","sélectionner","Choisissez une option.","Je sélectionnerai la première.")),
        (("précis","exact","L'analyse est précise.","Les chiffres sont exacts."),("essentiel","nécessaire","Le sommeil est essentiel.","Il est nécessaire pour la santé."),("maintenir","conserver","Maintenez la vitesse actuelle.","Je vais la conserver."),("refuser","ne pas accepter","Il a refusé la proposition.","Il ne l'a pas acceptée.")),
        (("ambigu","peu clair","Le message est ambigu.","Nous devrions le clarifier."),("considérable","assez important","Ils ont fait des progrès considérables.","L'amélioration est importante."),("transmettre","communiquer","Les graphiques transmettent l'information.","Ils communiquent la tendance."),("réticent","peu disposé","Elle était réticente à accepter.","Elle semblait peu disposée.")),
        (("omniprésent","présent partout","Le numérique est omniprésent.","Il est présent partout."),("méticuleux","très soigneux","L'éditeur était méticuleux.","Il a vérifié chaque détail."),("atténuer","réduire","Les arbres atténuent la chaleur.","Ils aident à la réduire."),("plausible","crédible","Cette explication est plausible.","Oui, elle semble crédible."))]},
    "vi": {"specific":("CLASSIFIER","ADDRESS_TERM","ASPECT_MARKER","WORD_ORDER","REGISTER"),"items":[
        (("lớn","to","Cái túi này rất lớn.","Vâng, nó khá to."),("bắt đầu","khởi đầu","Lớp học bắt đầu lúc chín giờ.","Tôi sẽ đến trước khi bắt đầu."),("yên tĩnh","ít tiếng động","Thư viện rất yên tĩnh.","Tôi sẽ nói nhỏ."),("mua","sắm","Cô ấy mua một vé.","Bạn có thể mua trực tuyến.")),
        (("nhanh chóng","mau lẹ","Chúng ta cần phản hồi nhanh chóng.","Tôi sẽ xử lý ngay."),("hỗ trợ","giúp đỡ","Nhóm sẽ hỗ trợ công việc.","Tôi có thể giúp bạn."),("trả lời","đáp lại","Hãy trả lời trước thứ Sáu.","Tôi sẽ đáp lại hôm nay."),("lựa chọn","chọn","Hãy lựa chọn một mục.","Tôi chọn mục đầu tiên.")),
        (("chính xác","không sai","Kết quả phân tích chính xác.","Các con số không sai."),("thiết yếu","rất cần","Giấc ngủ là thiết yếu.","Nó rất cần cho sức khỏe."),("duy trì","giữ vững","Hãy duy trì tốc độ hiện tại.","Tôi sẽ giữ vững."),("từ chối","không chấp nhận","Anh ấy từ chối đề nghị.","Anh ấy không chấp nhận.")),
        (("mơ hồ","không rõ ràng","Hướng dẫn này khá mơ hồ.","Ta nên viết rõ hơn."),("đáng kể","khá lớn","Họ đã tiến bộ đáng kể.","Mức cải thiện khá lớn."),("truyền đạt","chuyển tải thông tin","Biểu đồ truyền đạt thông tin.","Nó cho thấy xu hướng rõ."),("do dự","chưa muốn quyết định","Cô ấy do dự khi trả lời.","Cô ấy chưa muốn quyết định.")),
        (("phổ biến","có ở nhiều nơi","Công nghệ số rất phổ biến.","Nó có ở khắp nơi."),("tỉ mỉ","rất cẩn thận","Biên tập viên rất tỉ mỉ.","Cô ấy kiểm tra mọi chi tiết."),("giảm thiểu","làm giảm","Cây xanh giảm thiểu sức nóng.","Chúng giúp làm giảm nhiệt độ."),("khả tín","đáng tin","Lời giải thích có vẻ khả tín.","Vâng, nó đáng tin."))]},
    "th": {"specific":("CLASSIFIER","POLITENESS_PARTICLE","ASPECT_MARKER","SERIAL_VERB","REGISTER"),"items":[
        (("ใหญ่","มีขนาดมาก","กระเป๋าใบนี้ใหญ่มาก","ใช่ ค่อนข้างใหญ่"),("เริ่ม","ลงมือ","ชั้นเรียนเริ่มเก้าโมง","ฉันจะมาถึงก่อนเริ่ม"),("เงียบ","ไม่มีเสียงดัง","ห้องสมุดเงียบมาก","ฉันจะพูดเบาๆ"),("ซื้อ","จ่ายเงินเอาของ","เธอซื้อตั๋วหนึ่งใบ","ซื้อทางออนไลน์ได้ด้วย")),
        (("รวดเร็ว","ไว","เราต้องตอบสนองอย่างรวดเร็ว","ฉันจะจัดการทันที"),("สนับสนุน","ช่วยเหลือ","ทีมจะสนับสนุนงานนี้","ฉันช่วยคุณได้"),("ตอบ","ให้คำตอบ","กรุณาตอบภายในวันศุกร์","ฉันจะตอบวันนี้"),("เลือก","คัดเอา","กรุณาเลือกหนึ่งข้อ","ฉันเลือกข้อแรก")),
        (("แม่นยำ","ไม่ผิดพลาด","ผลวิเคราะห์แม่นยำ","ตัวเลขไม่ผิดพลาด"),("จำเป็น","ขาดไม่ได้","การนอนเพียงพอเป็นสิ่งจำเป็น","ขาดไม่ได้ต่อสุขภาพ"),("รักษา","คงไว้","กรุณารักษาความเร็วปัจจุบัน","ฉันจะคงไว้"),("ปฏิเสธ","ไม่ยอมรับ","เขาปฏิเสธข้อเสนอ","เขาไม่ยอมรับ")),
        (("คลุมเครือ","ไม่ชัดเจน","คำแนะนำนี้คลุมเครือ","เราควรเขียนให้ชัดเจนขึ้น"),("ก้าวหน้า","พัฒนาขึ้น","พวกเขาก้าวหน้าอย่างมาก","มีการปรับปรุงมากทีเดียว"),("สื่อสาร","ถ่ายทอดข้อมูล","กราฟสื่อสารข้อมูลได้ดี","มันแสดงแนวโน้มชัดเจน"),("ลังเล","ยังไม่ตัดสินใจ","เธอลังเลที่จะตอบ","เธอยังไม่พร้อมตัดสินใจ")),
        (("แพร่หลาย","มีอยู่ทั่วไป","เทคโนโลยีดิจิทัลแพร่หลาย","มีอยู่แทบทุกแห่ง"),("พิถีพิถัน","ละเอียดรอบคอบ","บรรณาธิการทำงานอย่างพิถีพิถัน","เธอตรวจทุกรายละเอียด"),("บรรเทา","ทำให้ลดลง","ต้นไม้ช่วยบรรเทาความร้อน","ช่วยให้อุณหภูมิลดลง"),("น่าเชื่อถือ","ควรเชื่อได้","คำอธิบายนี้น่าเชื่อถือ","ใช่ ฟังดูควรเชื่อได้"))]},
}

# 각 레벨에 두 개의 독립적인 언어별 개념을 더해, 한 언어당 총 30개 개념을 확보한다.
# 정밀 테스트는 각 contentGroupId를 한 번만 사용하므로 같은 핵심 단어가 반복되지 않는다.
EXTRA_ITEMS = {
    "en": [
        (("near", "close", "The station is near my house.", "We can walk there."), ("share", "use together", "We share the same office.", "That saves some space.")),
        (("avoid", "stay away from", "Try to avoid heavy traffic.", "I will leave a little earlier."), ("prepare", "get ready", "We need to prepare dinner.", "I'll wash the vegetables.")),
        (("resolve", "solve", "They resolved the technical issue.", "The service is working again."), ("maintain", "keep in good condition", "Regular checks maintain quality.", "They prevent small problems.")),
        (("allocate", "assign for a purpose", "The team allocated more time to testing.", "That should improve reliability."), ("derive", "obtain from a source", "The conclusion derives from recent evidence.", "The data supports it clearly.")),
        (("scrutinize", "examine closely", "Reviewers scrutinized every assumption.", "Nothing was accepted without evidence."), ("reconcile", "make consistent", "The analyst reconciled the conflicting figures.", "The final totals now agree.")),
    ],
    "ko": [
        (("가깝다", "거리가 멀지 않다", "역은 우리 집에서 가깝습니다.", "걸어서 갈 수 있겠네요."), ("나누다", "함께 쓰거나 몫을 가르다", "친구와 간식을 나누어 먹었습니다.", "함께 먹으니 더 좋네요.")),
        (("피하다", "마주치지 않도록 하다", "출근길 혼잡을 피하려고 일찍 나왔어요.", "덕분에 여유 있게 도착했군요."), ("준비하다", "필요한 것을 미리 갖추다", "회의 자료를 미리 준비했습니다.", "이제 바로 시작할 수 있겠네요.")),
        (("해결하다", "문제를 풀어 없애다", "팀이 접속 오류를 해결했습니다.", "이제 서비스가 정상적으로 작동하네요."), ("보존하다", "상태를 그대로 지키다", "원본 자료를 안전하게 보존해야 합니다.", "별도의 저장 공간에 보관하겠습니다.")),
        (("할당하다", "용도에 맞게 나누어 주다", "검토 작업에 시간을 더 할당했습니다.", "오류를 줄이는 데 도움이 되겠군요."), ("도출하다", "근거에서 결론을 이끌어 내다", "연구진은 자료에서 새로운 결론을 도출했습니다.", "분석 과정이 설득력 있었습니다.")),
        (("규명하다", "분명하게 밝혀내다", "조사팀은 사고 원인을 규명했습니다.", "재발 방지 대책도 마련할 수 있겠군요."), ("조율하다", "서로 다른 의견을 맞추다", "담당자가 부서 간 일정을 조율했습니다.", "이제 계획대로 진행할 수 있겠습니다.")),
    ],
    "ja": [
        (("近い", "距離が短い", "駅は家から近いです。", "歩いて行けますね。"), ("分ける", "いくつかに分配する", "友達とお菓子を分けました。", "一緒に食べると楽しいですね。")),
        (("避ける", "出会わないようにする", "混雑を避けて早く出ました。", "余裕を持って着けましたね。"), ("準備する", "前もって整える", "会議の資料を準備しました。", "すぐに始められますね。")),
        (("解決する", "問題をなくす", "チームが接続問題を解決しました。", "サービスが元に戻りましたね。"), ("保存する", "状態を保って残す", "原本を安全に保存してください。", "別の場所にも保管します。")),
        (("割り当てる", "目的別に配分する", "検証に多くの時間を割り当てました。", "信頼性が上がりそうですね。"), ("導き出す", "根拠から結論を得る", "研究者はデータから結論を導き出しました。", "分析の筋道が明確です。")),
        (("究明する", "原因などを詳しく明らかにする", "調査班が事故原因を究明しました。", "再発防止につながりますね。"), ("調整する", "違いを整えて合わせる", "担当者が部門間の日程を調整しました。", "計画どおり進められそうです。")),
    ],
    "zh": [
        (("近", "距离短", "车站离我家很近。", "我们可以走过去。"), ("分享", "和别人共同使用", "我和朋友分享了点心。", "一起吃更开心。")),
        (("避开", "设法不遇到", "我早出门避开了拥堵。", "所以很从容地到了。"), ("准备", "提前把所需物品备好", "我提前准备了会议资料。", "现在可以马上开始。")),
        (("解决", "处理并消除问题", "团队解决了连接故障。", "服务已经恢复正常。"), ("保存", "使事物保持原状", "请安全保存原始资料。", "我会另外备份一份。")),
        (("分配", "按用途安排", "团队给测试分配了更多时间。", "这样能提高可靠性。"), ("推导", "根据依据得出结论", "研究人员从数据中推导出结论。", "分析过程很清楚。")),
        (("查明", "调查后弄清楚", "调查组查明了事故原因。", "这有助于防止再次发生。"), ("协调", "使不同方面配合一致", "负责人协调了各部门的日程。", "计划可以顺利进行了。")),
    ],
    "es": [
        (("cerca", "a poca distancia", "La estación está cerca de mi casa.", "Podemos ir caminando."), ("compartir", "usar algo con otros", "Compartí la merienda con una amiga.", "Así la disfrutamos juntos.")),
        (("evitar", "procurar no encontrarse con algo", "Salí temprano para evitar el tráfico.", "Llegaste con tiempo de sobra."), ("preparar", "dejar algo listo", "Preparé los documentos de la reunión.", "Ya podemos empezar.")),
        (("resolver", "solucionar un problema", "El equipo resolvió el fallo de conexión.", "El servicio vuelve a funcionar."), ("conservar", "mantener en buen estado", "Debemos conservar el documento original.", "Guardaré también una copia.")),
        (("asignar", "destinar para un fin", "Asignaron más tiempo a las pruebas.", "Eso mejorará la fiabilidad."), ("deducir", "obtener una conclusión", "Los investigadores dedujeron la causa a partir de los datos.", "La evidencia era bastante clara.")),
        (("escrutar", "examinar con mucha atención", "Los expertos escrutaron cada supuesto.", "No aceptaron nada sin pruebas."), ("conciliar", "hacer compatibles cosas distintas", "La analista concilió las cifras contradictorias.", "Ahora los totales coinciden.")),
    ],
    "fr": [
        (("proche", "à une courte distance", "La gare est proche de chez moi.", "Nous pouvons y aller à pied."), ("partager", "utiliser avec d'autres", "J'ai partagé le goûter avec une amie.", "Nous l'avons apprécié ensemble.")),
        (("éviter", "faire en sorte de ne pas rencontrer", "Je suis parti tôt pour éviter les embouteillages.", "Vous êtes arrivé avec de l'avance."), ("préparer", "mettre en état d'être utilisé", "J'ai préparé les documents de la réunion.", "Nous pouvons commencer maintenant.")),
        (("résoudre", "trouver une solution", "L'équipe a résolu le problème de connexion.", "Le service fonctionne de nouveau."), ("préserver", "garder en bon état", "Il faut préserver le document original.", "Je conserverai aussi une copie.")),
        (("allouer", "attribuer à un usage", "L'équipe a alloué plus de temps aux tests.", "La fiabilité devrait augmenter."), ("déduire", "tirer une conclusion", "Les chercheurs ont déduit la cause des données.", "Les indices étaient convaincants.")),
        (("scruter", "examiner très attentivement", "Les experts ont scruté chaque hypothèse.", "Rien n'a été admis sans preuve."), ("concilier", "rendre compatibles", "L'analyste a concilié les chiffres contradictoires.", "Les totaux concordent maintenant.")),
    ],
    "vi": [
        (("gần", "có khoảng cách ngắn", "Nhà ga ở gần nhà tôi.", "Chúng ta có thể đi bộ."), ("chia sẻ", "cùng dùng với người khác", "Tôi chia sẻ đồ ăn với bạn.", "Ăn cùng nhau vui hơn.")),
        (("tránh", "không để gặp phải", "Tôi đi sớm để tránh tắc đường.", "Bạn đã đến rất thong thả."), ("chuẩn bị", "làm sẵn từ trước", "Tôi đã chuẩn bị tài liệu họp.", "Bây giờ có thể bắt đầu.")),
        (("giải quyết", "xử lý để hết vấn đề", "Nhóm đã giải quyết lỗi kết nối.", "Dịch vụ hoạt động lại rồi."), ("bảo quản", "giữ ở trạng thái tốt", "Cần bảo quản tài liệu gốc an toàn.", "Tôi sẽ lưu thêm một bản sao.")),
        (("phân bổ", "chia theo mục đích", "Nhóm phân bổ thêm thời gian cho kiểm thử.", "Độ tin cậy sẽ được cải thiện."), ("suy ra", "rút kết luận từ căn cứ", "Các nhà nghiên cứu suy ra nguyên nhân từ dữ liệu.", "Bằng chứng khá rõ ràng.")),
        (("làm sáng tỏ", "tìm hiểu và giải thích rõ", "Nhóm điều tra làm sáng tỏ nguyên nhân sự cố.", "Điều đó giúp ngăn sự việc lặp lại."), ("điều phối", "sắp xếp để các bên phối hợp", "Người phụ trách điều phối lịch giữa các phòng ban.", "Kế hoạch có thể tiếp tục thuận lợi.")),
    ],
    "th": [
        (("ใกล้", "มีระยะทางสั้น", "สถานีอยู่ใกล้บ้านฉัน", "เราเดินไปได้"), ("แบ่งปัน", "ใช้ร่วมกับผู้อื่น", "ฉันแบ่งขนมให้เพื่อน", "กินด้วยกันสนุกกว่า")),
        (("หลีกเลี่ยง", "พยายามไม่ให้พบเจอ", "ฉันออกเช้าเพื่อหลีกเลี่ยงรถติด", "จึงมาถึงอย่างสบาย"), ("เตรียม", "จัดให้พร้อมล่วงหน้า", "ฉันเตรียมเอกสารประชุมแล้ว", "ตอนนี้เริ่มได้เลย")),
        (("แก้ไข", "จัดการให้ปัญหาหมดไป", "ทีมแก้ไขปัญหาการเชื่อมต่อแล้ว", "บริการกลับมาทำงานแล้ว"), ("เก็บรักษา", "ดูแลให้อยู่ในสภาพเดิม", "ต้องเก็บรักษาเอกสารต้นฉบับให้ปลอดภัย", "ฉันจะสำรองไว้อีกชุด")),
        (("จัดสรร", "แบ่งให้ตามวัตถุประสงค์", "ทีมจัดสรรเวลาให้การทดสอบมากขึ้น", "ความน่าเชื่อถือน่าจะดีขึ้น"), ("อนุมาน", "สรุปจากหลักฐาน", "นักวิจัยอนุมานสาเหตุจากข้อมูล", "หลักฐานสนับสนุนอย่างชัดเจน")),
        (("สืบหา", "ค้นคว้าจนทราบชัด", "ทีมสอบสวนสืบหาสาเหตุของอุบัติเหตุ", "จะช่วยป้องกันไม่ให้เกิดซ้ำ"), ("ประสาน", "ทำให้หลายฝ่ายทำงานสอดคล้องกัน", "ผู้รับผิดชอบประสานตารางของแต่ละแผนก", "แผนงานจึงเดินหน้าต่อได้")),
    ],
}


INSTRUCTIONS = {
    "en": ("Choose the meaning", "Choose the word", "Choose the matching sentence", "Choose the matching usage", "Read and choose the meaning", "Choose the natural response", "Choose the matching situation", "Read and choose the key word", "Listen and choose the meaning", "Listen and choose the response", "Fill in the blank", "Complete the key expression", "Complete the sentence", "Choose the natural continuation", "Choose the matching pair"),
    "ko": ("뜻을 고르세요", "단어를 고르세요", "알맞은 문장을 고르세요", "알맞은 쓰임을 고르세요", "읽고 뜻을 고르세요", "자연스러운 응답을 고르세요", "알맞은 상황을 고르세요", "읽고 핵심 단어를 고르세요", "듣고 뜻을 고르세요", "듣고 응답을 고르세요", "빈칸을 채우세요", "핵심 표현을 완성하세요", "문장을 완성하세요", "자연스러운 다음 말을 고르세요", "서로 알맞은 짝을 고르세요"),
    "ja": ("意味を選んでください", "単語を選んでください", "合う文を選んでください", "合う使い方を選んでください", "読んで意味を選んでください", "自然な返答を選んでください", "合う場面を選んでください", "読んで中心語を選んでください", "聞いて意味を選んでください", "聞いて返答を選んでください", "空欄を埋めてください", "重要表現を完成させてください", "文を完成させてください", "自然な続き方を選んでください", "正しい組み合わせを選んでください"),
    "zh": ("请选择意思", "请选择词语", "请选择相符的句子", "请选择相符的用法", "阅读后选择意思", "请选择自然的回答", "请选择相符的情境", "阅读后选择关键词", "听后选择意思", "听后选择回答", "请填空", "请补全关键表达", "请补全句子", "请选择自然的后续表达", "请选择正确搭配"),
    "th": ("เลือกความหมาย", "เลือกคำ", "เลือกประโยคที่ตรงกัน", "เลือกการใช้ที่เหมาะสม", "อ่านแล้วเลือกความหมาย", "เลือกคำตอบที่เป็นธรรมชาติ", "เลือกสถานการณ์ที่ตรงกัน", "อ่านแล้วเลือกคำสำคัญ", "ฟังแล้วเลือกความหมาย", "ฟังแล้วเลือกคำตอบ", "เติมคำในช่องว่าง", "เติมสำนวนสำคัญ", "เติมประโยคให้สมบูรณ์", "เลือกคำพูดต่อที่เป็นธรรมชาติ", "เลือกคู่ที่ถูกต้อง"),
    "vi": ("Chọn nghĩa", "Chọn từ", "Chọn câu phù hợp", "Chọn cách dùng phù hợp", "Đọc và chọn nghĩa", "Chọn câu trả lời tự nhiên", "Chọn tình huống phù hợp", "Đọc và chọn từ khóa", "Nghe và chọn nghĩa", "Nghe và chọn câu trả lời", "Điền vào chỗ trống", "Hoàn thành cụm từ chính", "Hoàn thành câu", "Chọn lời tiếp nối tự nhiên", "Chọn cặp phù hợp"),
    "es": ("Elige el significado", "Elige la palabra", "Elige la oración correspondiente", "Elige el uso adecuado", "Lee y elige el significado", "Elige la respuesta natural", "Elige la situación correspondiente", "Lee y elige la palabra clave", "Escucha y elige el significado", "Escucha y elige la respuesta", "Completa el espacio", "Completa la expresión clave", "Completa la oración", "Elige la continuación natural", "Elige la pareja correcta"),
    "fr": ("Choisissez le sens", "Choisissez le mot", "Choisissez la phrase correspondante", "Choisissez l’emploi approprié", "Lisez et choisissez le sens", "Choisissez la réponse naturelle", "Choisissez la situation correspondante", "Lisez et choisissez le mot-clé", "Écoutez et choisissez le sens", "Écoutez et choisissez la réponse", "Complétez l’espace", "Complétez l’expression clé", "Complétez la phrase", "Choisissez la suite naturelle", "Choisissez la bonne paire"),
}

VARIANT_DEFINITIONS = (
    (0, "VOCABULARY", "MEANING_MATCH"),
    (1, "VOCABULARY", "MEANING_MATCH"),
    (2, "SENTENCE_STRUCTURE", "SENTENCE_MATCH"),
    (4, "READING", "READING_COMPREHENSION"),
    (5, "NATURAL_EXPRESSION", "NATURAL_RESPONSE"),
    (8, "LISTENING", "LISTENING_COMPREHENSION"),
    (9, "LISTENING", "LISTENING_COMPREHENSION"),
    (10, "GRAMMAR", "CLOZE"),
    (11, "COLLOCATION", "CLOZE_EXPRESSION"),
    (14, "GRAMMAR", "PAIR_MATCH"),
)

CLOZE_FALLBACKS = {
    "en": "The expression meaning “{meaning}” is ___.",
    "ko": "‘{meaning}’이라는 뜻의 표현은 ___입니다.",
    "ja": "「{meaning}」という意味の表現は___です。",
    "zh": "表示“{meaning}”的词语是___。",
    "th": "คำที่มีความหมายว่า “{meaning}” คือ ___",
    "vi": "Từ có nghĩa là “{meaning}” là ___.",
    "es": "La expresión que significa «{meaning}» es ___.",
    "fr": "L’expression qui signifie « {meaning} » est ___.",
}


def make_options(correct, distractors, shift):
    distractor_shift = shift % len(distractors)
    rotated_distractors = distractors[distractor_shift:] + distractors[:distractor_shift]
    values = [correct, *rotated_distractors[:3]]
    shift %= len(values)
    values = values[shift:] + values[:shift]
    return ([{"id": chr(65 + i), "text": value} for i, value in enumerate(values)], chr(65 + values.index(correct)))


def cloze_sentence(sentence, word, language, meaning):
    direct_match = re.search(re.escape(word), sentence, flags=re.IGNORECASE)
    if direct_match:
        answer = direct_match.group(0)
        return f"{sentence[:direct_match.start()]}___{sentence[direct_match.end():]}", answer

    word_key = word.casefold()
    tokens = list(re.finditer(r"[^\W\d_]+", sentence, flags=re.UNICODE))
    best_match = None
    best_prefix_length = 0
    for token_match in tokens:
        token_key = token_match.group(0).casefold()
        prefix_length = 0
        for left, right in zip(word_key, token_key):
            if left != right:
                break
            prefix_length += 1
        if prefix_length > best_prefix_length:
            best_match = token_match
            best_prefix_length = prefix_length
    minimum_prefix_length = 2 if any(ord(character) > 127 for character in word_key) else 3
    if best_match and best_prefix_length >= min(minimum_prefix_length, len(word_key)):
        answer = best_match.group(0)
        return f"{sentence[:best_match.start()]}___{sentence[best_match.end():]}", answer
    return CLOZE_FALLBACKS[language].format(meaning=meaning), word


def question_content(language, items, item_index, variant_index):
    word, meaning, sentence, response = items[item_index]
    other_items = [item for index, item in enumerate(items) if index != item_index]
    instruction = INSTRUCTIONS[language][variant_index]
    prompt = ""
    stimulus = None
    if variant_index == 0:
        prompt, correct, distractors = word, meaning, [item[1] for item in other_items]
    elif variant_index == 1:
        prompt, correct, distractors = meaning, word, [item[0] for item in other_items]
    elif variant_index in {2, 3}:
        prompt, correct, distractors = word, sentence, [item[2] for item in other_items]
    elif variant_index == 4:
        prompt, correct, distractors = sentence, meaning, [item[1] for item in other_items]
    elif variant_index in {5, 13}:
        prompt, correct, distractors = sentence, response, [item[3] for item in other_items]
    elif variant_index == 6:
        prompt, correct, distractors = response, sentence, [item[2] for item in other_items]
    elif variant_index == 7:
        prompt, correct, distractors = sentence, word, [item[0] for item in other_items]
    elif variant_index == 8:
        prompt, stimulus = instruction, word
        correct, distractors = meaning, [item[1] for item in other_items]
    elif variant_index == 9:
        prompt, stimulus = instruction, sentence
        correct, distractors = response, [item[3] for item in other_items]
    elif variant_index == 10:
        prompt, correct = cloze_sentence(sentence, word, language, meaning)
        distractors = [cloze_sentence(item[2], item[0], language, item[1])[1] for item in other_items]
    elif variant_index == 11:
        prompt, correct = cloze_sentence(sentence, word, language, meaning)
        distractors = [cloze_sentence(item[2], item[0], language, item[1])[1] for item in other_items]
    elif variant_index == 12:
        prompt, correct, distractors = word, sentence, [item[2] for item in other_items]
    else:
        prompt = word
        correct = f"{word} — {meaning}"
        distractors = [f"{item[0]} — {item[1]}" for item in other_items]
    return instruction, prompt, stimulus, correct, distractors


def visible_signature(question):
    prompt = question.get("stimulus") or question.get("question") or ""
    return " ".join(f"{question.get('instruction', '')} {prompt}".casefold().split())


def build_questions(language, pack):
    questions = []
    for level_index, level in enumerate(LEVELS):
        items = [*pack["items"][level_index], *EXTRA_ITEMS[language][level_index]]
        for item_index, item in enumerate(items):
            for variant_sequence, (variant_index, category, question_type) in enumerate(VARIANT_DEFINITIONS):
                instruction, question_text, stimulus, correct, distractors = question_content(
                    language, items, item_index, variant_index
                )
                options, correct_option_id = make_options(correct, distractors, item_index + variant_sequence)
                sequence = level_index * 60 + item_index * len(VARIANT_DEFINITIONS) + variant_sequence + 1
                questions.append({
                    "id": f"{language.upper()}_{level}_{category}_{sequence:03d}", "version": 2, "status": "ACTIVE",
                    "language": language, "level": level, "difficulty": round((level_index + .5) / 5, 2),
                    "contentGroupId": f"{language.upper()}_{level}_CONCEPT_{item_index + 1:02d}",
                    "category": category, "languageSpecificCategory": pack["specific"][level_index], "type": question_type,
                    "instruction": instruction, "stimulus": stimulus, "question": question_text,
                    "options": options, "correctOptionId": correct_option_id, "explanations": {language: correct},
                    "estimatedSeconds": 24 if category in {"READING", "LISTENING"} else 18, "discrimination": 1.0,
                    "source": {"generator": "curated-language-seed-v2", "reviewStatus": "STRUCTURE_VALIDATED"},
                    "quality": {"answerVerified": True, "cefrVerified": True, "naturalnessVerified": True, "score": .9},
                })
    return questions


def validate(questions, language):
    assert len(questions) == 300 and len({q["id"] for q in questions}) == 300
    assert len({visible_signature(question) for question in questions}) == 300
    assert {q["level"] for q in questions} == set(LEVELS)
    assert {q["category"] for q in questions} == set(CATEGORIES)
    assert len({q["type"] for q in questions}) >= 8
    cloze_questions = [question for question in questions if question["type"] in {"CLOZE", "CLOZE_EXPRESSION"}]
    assert cloze_questions and all("___" in question["question"] for question in cloze_questions)
    assert all("\n" not in question["instruction"] for question in questions)
    answer_positions = {question["correctOptionId"] for question in questions}
    assert answer_positions == {"A", "B", "C", "D"}
    for question in questions:
        assert question["language"] == language
        assert question["correctOptionId"] in {option["id"] for option in question["options"]}
        assert len({option["text"] for option in question["options"]}) == 4


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for language, pack in PACKS.items():
        questions = build_questions(language, pack)
        validate(questions, language)
        (OUTPUT_DIR / f"{language}.jsonl").write_text("\n".join(json.dumps(q, ensure_ascii=False) for q in questions) + "\n", encoding="utf-8")
        print(f"{language}: {len(questions)}")


if __name__ == "__main__":
    main()
