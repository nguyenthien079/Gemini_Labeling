import asyncio
import json
import csv
import os
import re
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Medical NER Labeler")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY", ""))

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

CORPUS_DIR = Path(__file__).parent.parent / "Corpus_Redone"

batch_state = {
    "running": False,
    "total": 0,
    "done": 0,
    "current": "",
    "errors": [],
    "stopped": False,
}

ENTITY_TYPES = [
    "DISEASE", "SYMPTOM", "MEDICATION", "TREATMENT",
    "BODY_PART", "TEST", "VALUE", "DOCTOR", "PATIENT", "LOCATION", "DATE"
]


class LabelRequest(BaseModel):
    text: str
    filename: str = "document"
    title: str | None = None


class RelabelRequest(BaseModel):
    text: str
    filename: str
    current_entities: list
    feedback: str
    title: str | None = None


class ExportRequest(BaseModel):
    text: str
    filename: str
    entities: list


class BatchStartRequest(BaseModel):
    files: list[str] | None = None  # None = tất cả file trong corpus


def parse_json(raw: str) -> dict:
    raw = raw.strip()
    if "```" in raw:
        parts = raw.split("```")
        for part in parts:
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            try:
                return json.loads(part)
            except Exception:
                continue
    try:
        return json.loads(raw)
    except Exception:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            return json.loads(match.group())
    raise ValueError(f"Cannot parse JSON from LLM response: {raw[:200]}")


CHUNK_SIZE = 400   # nhỏ hơn để model tập trung hơn
OVERLAP     = 80   # overlap giữa các chunk để không bỏ entity ở ranh giới


def build_prompt(text: str, feedback: str = None, title: str = None) -> str:
    context_hint = f"Bài viết về: {title}\n\n" if title else ""
    prompt = f"""{context_hint}Bạn là chuyên gia NER y tế tiếng Việt. Nhiệm vụ: liệt kê TẤT CẢ thực thể y tế xuất hiện trong đoạn văn sau — đừng bỏ sót bất kỳ từ nào có liên quan đến y tế.

Loại thực thể và quy tắc phân biệt:
- DISEASE: tên bệnh/hội chứng được chẩn đoán chính thức (Alzheimer, COVID-19, ung thư phổi, tiểu đường, sa sút trí tuệ, viêm phổi...)
- SYMPTOM: biểu hiện/trạng thái người bệnh trải qua (mất trí nhớ, đau đầu, bối rối, lo lắng, sốt, khó thở, không thể đi lại...)
- MEDICATION: tên thuốc cụ thể (Paracetamol, Aspirin, Metformin...)
- TREATMENT: phương pháp/liệu pháp điều trị (phẫu thuật, hóa trị, xạ trị, vật lý trị liệu, chăm sóc giảm nhẹ...)
- BODY_PART: bộ phận/cơ quan cơ thể (não, phổi, gan, tim, tế bào thần kinh, dạ dày...)
- TEST: xét nghiệm, chẩn đoán hình ảnh, thủ thuật đánh giá (X-quang, MRI, xét nghiệm máu, sinh thiết...)
- VALUE: chỉ số/số liệu y khoa kèm đơn vị (39°C, 120/80 mmHg, 5mg, 100 tỷ tế bào...)
- DOCTOR: tên riêng của bác sĩ/chuyên gia
- PATIENT: tên riêng hoặc mã số định danh bệnh nhân cụ thể (KHÔNG label "người bệnh", "bệnh nhân" chung chung)
- LOCATION: địa điểm khám chữa bệnh cụ thể (tên bệnh viện, phòng khám, khoa...)
- DATE: ngày tháng, khoảng thời gian cụ thể (ngày 5/3, tháng 6, 3 ngày sau...)

Quy tắc quan trọng:
- DISEASE vs SYMPTOM: "sa sút trí tuệ" khi là chẩn đoán → DISEASE; "mất trí nhớ", "bối rối", "lo lắng" → luôn là SYMPTOM
- PATIENT: CHỈ label khi có tên riêng hoặc mã số cụ thể, KHÔNG label "người bệnh"/"bệnh nhân" nói chung
- TREATMENT vs MEDICATION: thuốc cụ thể → MEDICATION; phương pháp/liệu trình → TREATMENT
- Một cụm từ chỉ được gán 1 label (label phù hợp nhất)

Đoạn văn bản:
---
{text}
---
"""
    if feedback:
        prompt += f"\nLưu ý bổ sung từ người dùng: {feedback}\n"

    prompt += """
Yêu cầu:
1. Đọc từng câu, tìm TẤT CẢ thực thể y tế — không bỏ sót
2. "text" phải là chuỗi NGUYÊN VĂN xuất hiện trong đoạn trên, không thêm/bớt ký tự
3. Chỉ trả về JSON, không giải thích

Ví dụ output:
{"entities": [
  {"text": "Alzheimer", "label": "DISEASE"},
  {"text": "mất trí nhớ", "label": "SYMPTOM"},
  {"text": "tế bào thần kinh", "label": "BODY_PART"},
  {"text": "MRI", "label": "TEST"},
  {"text": "Paracetamol", "label": "MEDICATION"},
  {"text": "phẫu thuật", "label": "TREATMENT"}
]}
"""
    return prompt


def find_in_text(full_text: str, query: str, used_ranges: list) -> tuple[int, int] | None:
    """Tìm query trong full_text, bỏ qua vùng đã dùng. Thử exact rồi fuzzy."""
    candidates = [query]
    # Thử bỏ khoảng trắng đầu/cuối thừa, chuẩn hóa space
    normalized = " ".join(query.split())
    if normalized != query:
        candidates.append(normalized)

    for q in candidates:
        start = 0
        while True:
            pos = full_text.find(q, start)
            if pos == -1:
                break
            end = pos + len(q)
            overlap = any(not (end <= r[0] or pos >= r[1]) for r in used_ranges)
            if not overlap:
                return pos, end
            start = pos + 1
    return None


def resolve_positions(full_text: str, entities: list) -> list:
    """Tìm vị trí thực của từng entity trong text."""
    result = []
    used_ranges = []

    for e in entities:
        entity_text = e.get("text", "").strip()
        label = e.get("label", "")
        if not entity_text or not label:
            continue

        found = find_in_text(full_text, entity_text, used_ranges)
        if found:
            pos, end = found
            used_ranges.append((pos, end))
            actual_text = full_text[pos:end]
            result.append({"text": actual_text, "label": label, "start": pos, "end": end})

    return sorted(result, key=lambda x: x["start"])


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = OVERLAP) -> list[tuple[str, int]]:
    """Chia text thành các đoạn có overlap, trả về (chunk, offset)."""
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        # Cắt tại dấu chấm/xuống dòng gần nhất để không cắt giữa câu
        if end < len(text):
            for sep in ('\n', '.', ' '):
                pos = text.rfind(sep, start + size // 2, end)
                if pos > start:
                    end = pos + 1
                    break
        chunks.append((text[start:end], start))
        if end >= len(text):
            break
        # Lùi lại overlap để không bỏ entity ở ranh giới
        start = max(start + 1, end - overlap)
    return chunks


def call_groq(prompt: str) -> dict:
    import time
    for attempt in range(5):
        try:
            response = groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
            )
            return parse_json(response.choices[0].message.content)
        except Exception as e:
            msg = str(e)
            if "429" in msg or "rate_limit" in msg.lower():
                # Đọc thời gian chờ từ error message: "try again in Xm Ys"
                wait = 180  # default 3 phút
                m = re.search(r"try again in (\d+)m([\d.]+)s", msg)
                if m:
                    wait = int(m.group(1)) * 60 + float(m.group(2)) + 5
                time.sleep(wait)
            else:
                raise
    raise RuntimeError("Groq rate limit: đã thử 5 lần vẫn fail")


@app.get("/api/entity-types")
async def get_entity_types():
    return ENTITY_TYPES


def dedup_entities(entities: list) -> list:
    """Loại bỏ entity trùng lặp do overlap chunk (giữ lại theo start position)."""
    seen = set()
    result = []
    for e in sorted(entities, key=lambda x: x["start"]):
        key = (e["start"], e["end"])
        if key not in seen:
            seen.add(key)
            result.append(e)
    return result


async def run_ner(text: str, feedback: str = None, title: str = None) -> list:
    chunks = chunk_text(text)
    all_entities = []
    loop = asyncio.get_event_loop()
    for chunk, offset in chunks:
        prompt = build_prompt(chunk, feedback, title)
        # Chạy call_groq trong thread pool để không block event loop
        result = await loop.run_in_executor(None, call_groq, prompt)
        raw = result.get("entities", [])
        positioned = resolve_positions(chunk, raw)
        for e in positioned:
            e["start"] += offset
            e["end"] += offset
        all_entities.extend(positioned)
    return dedup_entities(all_entities)


def title_from_filename(filename: str, explicit_title: str = None) -> str:
    if explicit_title:
        return explicit_title
    # "alzheimer.txt" → "alzheimer", "benh-cum.txt" → "benh-cum"
    return Path(filename).stem


@app.post("/api/label")
async def label_text(req: LabelRequest):
    try:
        title = title_from_filename(req.filename, req.title)
        entities = await run_ner(req.text, title=title)
        return {"entities": entities, "filename": req.filename}
    except Exception as ex:
        raise HTTPException(status_code=500, detail=str(ex))


@app.post("/api/relabel")
async def relabel_text(req: RelabelRequest):
    try:
        title = title_from_filename(req.filename, req.title)
        entities = await run_ner(req.text, req.feedback, title=title)
        return {"entities": entities, "filename": req.filename}
    except Exception as ex:
        raise HTTPException(status_code=500, detail=str(ex))


@app.post("/api/export")
async def export_data(req: ExportRequest):
    try:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        base = f"{req.filename}_{ts}"

        json_path = DATA_DIR / f"{base}.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(
                {"filename": req.filename, "text": req.text, "entities": req.entities},
                f, ensure_ascii=False, indent=2
            )

        csv_path = DATA_DIR / f"{base}.csv"
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["filename", "text", "label", "start", "end"])
            writer.writeheader()
            for e in req.entities:
                writer.writerow({
                    "filename": req.filename,
                    "text": e["text"],
                    "label": e["label"],
                    "start": e["start"],
                    "end": e["end"],
                })

        pipe_path = DATA_DIR / f"{base}.pipe"
        with open(pipe_path, "w", encoding="utf-8") as f:
            for e in req.entities:
                f.write(f"{req.filename}||{e['label']}||{e['start']}||{e['end']}\n")

        return {
            "message": "Saved",
            "files": {
                "json": str(json_path),
                "csv": str(csv_path),
                "pipe": str(pipe_path),
            }
        }
    except Exception as ex:
        raise HTTPException(status_code=500, detail=str(ex))


def save_to_data(filename: str, text: str, entities: list):
    """Lưu kết quả NER ra data/ (dùng chung cho batch và export)."""
    base = Path(filename).stem
    json_path = DATA_DIR / f"{base}.json"
    csv_path = DATA_DIR / f"{base}.csv"
    pipe_path = DATA_DIR / f"{base}.pipe"

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({"filename": filename, "text": text, "entities": entities}, f, ensure_ascii=False, indent=2)

    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["filename", "text", "label", "start", "end"])
        writer.writeheader()
        for e in entities:
            writer.writerow({"filename": filename, "text": e["text"], "label": e["label"], "start": e["start"], "end": e["end"]})

    with open(pipe_path, "w", encoding="utf-8") as f:
        for e in entities:
            f.write(f"{filename}||{e['label']}||{e['start']}||{e['end']}\n")


async def run_batch(file_list: list):
    for fname in file_list:
        if batch_state["stopped"]:
            break
        batch_state["current"] = fname
        try:
            text = (CORPUS_DIR / fname).read_text(encoding="utf-8")
            title = Path(fname).stem
            entities = await run_ner(text, title=title)
            save_to_data(fname, text, entities)
        except Exception as e:
            batch_state["errors"].append({"file": fname, "error": str(e)})
        finally:
            batch_state["done"] += 1
        await asyncio.sleep(1)  # tránh bắn quá nhanh
    batch_state["running"] = False
    batch_state["current"] = ""


@app.get("/api/corpus/files")
async def list_corpus_files():
    if not CORPUS_DIR.exists():
        return {"files": [], "total": 0}
    files = sorted(f.name for f in CORPUS_DIR.glob("*.txt"))
    return {"files": files, "total": len(files)}


@app.post("/api/batch/start")
async def start_batch(req: BatchStartRequest, background_tasks: BackgroundTasks):
    if batch_state["running"]:
        raise HTTPException(status_code=400, detail="Batch đang chạy")
    if not CORPUS_DIR.exists():
        raise HTTPException(status_code=404, detail=f"Không tìm thấy corpus: {CORPUS_DIR}")

    file_list = req.files or sorted(f.name for f in CORPUS_DIR.glob("*.txt"))
    if not file_list:
        raise HTTPException(status_code=400, detail="Không có file nào để xử lý")

    batch_state.update({
        "running": True, "total": len(file_list), "done": 0,
        "current": "", "errors": [], "stopped": False,
    })
    background_tasks.add_task(run_batch, file_list)
    return {"started": True, "total": len(file_list)}


@app.get("/api/batch/status")
async def batch_status():
    return batch_state


@app.post("/api/batch/stop")
async def stop_batch():
    batch_state["stopped"] = True
    return {"stopping": True}
