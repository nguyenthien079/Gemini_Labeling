import json
import csv
import os
import re
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
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

ENTITY_TYPES = [
    "DISEASE", "SYMPTOM", "MEDICATION", "TREATMENT",
    "BODY_PART", "TEST", "VALUE", "DOCTOR", "PATIENT", "LOCATION", "DATE"
]


class LabelRequest(BaseModel):
    text: str
    filename: str = "document"


class RelabelRequest(BaseModel):
    text: str
    filename: str
    current_entities: list
    feedback: str


class ExportRequest(BaseModel):
    text: str
    filename: str
    entities: list


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


def build_prompt(text: str, feedback: str = None) -> str:
    prompt = f"""Bạn là chuyên gia NER y tế tiếng Việt. Nhiệm vụ: liệt kê TẤT CẢ thực thể y tế xuất hiện trong đoạn văn sau — đừng bỏ sót bất kỳ từ nào có liên quan đến y tế.

Loại thực thể cần tìm:
- DISEASE: tên bệnh (Alzheimer, COVID-19, ung thư, tiểu đường, sa sút trí tuệ...)
- SYMPTOM: triệu chứng, biểu hiện (mất trí nhớ, đau đầu, bối rối, lo lắng, không thể đi lại...)
- MEDICATION: thuốc, dược phẩm (Paracetamol, Aspirin...)
- TREATMENT: phương pháp điều trị (phẫu thuật, hóa trị, xạ trị, chăm sóc...)
- BODY_PART: bộ phận cơ thể (não, phổi, gan, tim, tế bào thần kinh...)
- TEST: xét nghiệm, chẩn đoán (X-quang, MRI, xét nghiệm máu...)
- VALUE: chỉ số y khoa (39°C, 120/80 mmHg, 5mg...)
- DOCTOR: tên bác sĩ
- PATIENT: bệnh nhân, người bệnh
- LOCATION: địa điểm khám chữa bệnh
- DATE: ngày tháng, thời điểm

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

{"entities": [{"text": "chuỗi nguyên văn", "label": "DISEASE"}]}
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
    response = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
    )
    return parse_json(response.choices[0].message.content)


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


async def run_ner(text: str, feedback: str = None) -> list:
    chunks = chunk_text(text)
    all_entities = []
    for chunk, offset in chunks:
        prompt = build_prompt(chunk, feedback)
        result = call_groq(prompt)
        raw = result.get("entities", [])
        positioned = resolve_positions(chunk, raw)
        for e in positioned:
            e["start"] += offset
            e["end"] += offset
        all_entities.extend(positioned)
    return dedup_entities(all_entities)


@app.post("/api/label")
async def label_text(req: LabelRequest):
    try:
        entities = await run_ner(req.text)
        return {"entities": entities, "filename": req.filename}
    except Exception as ex:
        raise HTTPException(status_code=500, detail=str(ex))


@app.post("/api/relabel")
async def relabel_text(req: RelabelRequest):
    try:
        entities = await run_ner(req.text, req.feedback)
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
