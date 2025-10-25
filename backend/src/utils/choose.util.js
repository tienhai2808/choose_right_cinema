const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

module.exports.calculateDistances = (cinemas, location) => {
  const osrmPromises = cinemas.map(async (cinema) => {
    const url = `http://router.project-osrm.org/route/v1/driving/${location.lng},${location.lat};${cinema.location.coordinates[0]},${cinema.location.coordinates[1]}?overview=false`;
    const response = await axios.get(url);
    const route = response.data.routes[0];
    return {
      distance: Math.round((route.distance / 1000) * 100) / 100,
      duration: Math.round((route.duration / 60) * 100) / 100,
    };
  });

  return Promise.all(osrmPromises);
};

const getTodayString = () => {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })
  );
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getCurrentTime = () => {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })
  );
  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
};

module.exports.getGeminiRecommendation = async (cinemas, film, date) => {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const todayString = getTodayString();
  const currentTime = getCurrentTime();
  const isToday = todayString === date;

  const cinemasDataString = cinemas
    .map((cinema, index) => {
      const showtimesString =
        cinema.showtimes
          .map((st) => {
            const priceDisplay = st.price
              ? `${st.price.toLocaleString("vi-VN")} VND`
              : "Không rõ";
            return `  - ${st.time} (Giá: ${priceDisplay})`;
          })
          .join("\n") || "  (Không có suất chiếu)";

      return `
Rạp ${index + 1}:
- Tên: ${cinema.name}
- Địa chỉ: ${cinema.address}
- Khoảng cách: ${cinema.distance} km
- Thời gian di chuyển: ${cinema.duration} phút
- Các suất chiếu có sẵn (định dạng HH:mm):
${showtimesString}
`;
    })
    .join("\n--------------------\n");

  const prompt = `
Bạn là một trợ lý tư vấn chọn rạp chiếu phim chuyên nghiệp và thông thái.

Nhiệm vụ của bạn là phân tích dữ liệu được cung cấp để gợi ý cho người dùng MỘT (1) rạp chiếu phim tốt nhất để xem phim "${film}".

BỐI CẢNH HIỆN TẠI:
- Ngày người dùng muốn xem: ${date}
- Hôm nay là ngày: ${todayString}
- Bây giờ là: ${currentTime} (định dạng 24 giờ)
- Phân tích này chỉ áp dụng cho ngày ${date}.

DỮ LIỆU CÁC RẠP:
${cinemasDataString}

YÊU CẦU PHÂN TÍCH (RẤT QUAN TRỌNG):
Bạn PHẢI thực hiện các bước sau theo đúng thứ tự:

1.  **Lọc Suất Chiếu Hợp Lệ:**
    * ${
      isToday
        ? `Vì hôm nay (${todayString}) là ngày xem phim, bạn PHẢI LỌC BỎ tất cả các suất chiếu CÓ THỜI GIAN TRƯỚC ${currentTime}. Chỉ giữ lại các suất chiếu từ ${currentTime} trở về sau.`
        : `Vì ngày xem phim (${date}) KHÔNG phải là hôm nay, bạn KHÔNG cần lọc bỏ suất chiếu nào theo giờ. Hãy giữ lại TẤT CẢ các suất chiếu của ngày hôm đó.`
    }
    * Sau khi lọc, nếu rạp nào không còn suất chiếu nào, hãy LOẠI BỎ rạp đó khỏi danh sách xem xét.

2.  **Tìm Suất Chiếu Sớm Nhất (Sau Lọc):**
    * Với mỗi rạp còn lại, tìm ra suất chiếu SỚM NHẤT và GẦN NHẤT với thời gian hiện tại (nếu là hôm nay) hoặc suất sớm nhất trong ngày (nếu là ngày khác). Ghi lại suất chiếu này.

3.  **So Sánh Giá (Nếu có thể):**
    * Sau khi đã có danh sách các rạp và suất chiếu sớm nhất của họ, hãy kiểm tra giá vé của các suất chiếu đó.
    * **Nếu TẤT CẢ các rạp đều có thông tin giá vé rõ ràng (không phải "Không rõ")**, hãy ưu tiên rạp có giá vé RẺ HƠN.
    * **Nếu có BẤT KỲ rạp nào không có giá vé ("Không rõ")**, hãy BỎ QUA tiêu chí giá vé và không dùng nó để so sánh.

4.  **Tổng Hợp và Quyết Định (Tiêu chí chính):**
    * Gợi ý rạp dựa trên sự cân bằng TỐI ƯU giữa các yếu tố sau (theo thứ tự ưu tiên):
        1.  **Suất chiếu phù hợp:** Phải có suất chiếu hợp lệ (sau bước 1).
        2.  **Thời gian di chuyển (duration):** Ưu tiên rạp có thời gian di chuyển NGẮN NHẤT. Đây là yếu tố quan trọng.
        3.  **Khoảng cách (distance):** Nếu thời gian di chuyển bằng nhau, ưu tiên khoảng cách GẦN HƠN.
        4.  **Giá vé:** Chỉ dùng làm yếu tố phụ nếu thỏa mãn điều kiện ở bước 3.

ĐỊNH DẠNG TRẢ VỀ:
Trả lời bằng một đoạn văn ngắn gọn, thân thiện, tập trung vào việc đưa ra gợi ý và lý do.

Ví dụ:
"Để xem phim ${film}, rạp tốt nhất cho bạn là [Tên rạp]. 
Lý do:
- Đây là rạp có thời gian di chuyển nhanh nhất (chỉ [Số] phút).
- Rạp có suất chiếu sớm và phù hợp là [HH:mm].
- (Nếu có so sánh giá) Ngoài ra, giá vé ở đây cũng rẻ hơn so với các rạp khác."
`;
  const result = await model.generateContent(prompt);
  const response = result.response.text();

  return response;
};
