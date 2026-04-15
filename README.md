# Gemini Medical NER Labeler

Web app gán nhãn thực thể y tế tiếng Việt tự động bằng Gemini API.

## Tính năng

- Upload file `.txt` / `.html` hoặc paste text trực tiếp
- Gemini tự động nhận diện các thực thể y tế và gán nhãn
- Highlight entity theo màu trên văn bản, click để sửa hoặc xoá
- Chat với Gemini để báo sai và label lại
- Xuất kết quả ra `.json`, `.csv`, `.pipe`

## Entity types

| Label | Ý nghĩa |
|-------|---------|
| DISEASE | Tên bệnh |
| SYMPTOM | Triệu chứng |
| MEDICATION | Thuốc |
| TREATMENT | Phương pháp điều trị |
| BODY_PART | Bộ phận cơ thể |
| TEST | Xét nghiệm / chẩn đoán |
| VALUE | Chỉ số y khoa |
| DOCTOR | Bác sĩ |
| PATIENT | Bệnh nhân |
| LOCATION | Địa điểm |
| DATE | Ngày tháng |

## Cài đặt

### Backend

```bash
cd backend
python -m venv venv
venv/Scripts/activate        # Windows
# source venv/bin/activate   # Linux/Mac
pip install -r requirements.txt
```

Tạo file `.env` từ `.env.example`:

```bash
cp .env.example .env
```

Điền API key vào `.env`:

```
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-1.5-flash
```

Lấy API key tại: https://aistudio.google.com/apikey

### Frontend

```bash
cd frontend
npm install
```

## Chạy

```bash
# Terminal 1 — Backend
cd backend
venv/Scripts/uvicorn main:app --reload

# Terminal 2 — Frontend
cd frontend
npm run dev
```

Mở trình duyệt tại `http://localhost:5173`

## Output

File kết quả được lưu vào thư mục `data/` với format `<tên_file>_<timestamp>`:

- `.json` — full text + danh sách entities
- `.csv` — mỗi entity một dòng
- `.pipe` — `filename||LABEL||start||end`

## Cấu trúc

```
├── backend/
│   ├── main.py          # FastAPI app + Gemini integration
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── components/
│       │   ├── UploadZone.jsx   # Upload / paste text
│       │   ├── LabelViewer.jsx  # Highlight + sửa entity
│       │   └── ChatPanel.jsx    # Chat feedback → re-label
│       └── services/api.js
└── data/                        # Output files (gitignored)
```
