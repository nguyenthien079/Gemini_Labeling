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


CHUNK_SIZE = 800  # ký tự mỗi chunk


def build_prompt(text: str, feedback: str = None) -> str:
    prompt = f"""Bạn là chuyên gia NER y tế tiếng Việt. Hãy xác định tất cả thực thể y tế trong đoạn văn bản sau.

Các loại thực thể:
- DISEASE: tên bệnh (Alzheimer, COVID-19, ung thư, tiểu đường...)
- SYMPTOM: triệu chứng (sốt, ho, đau đầu, mất trí nhớ...)
- MEDICATION: thuốc (Paracetamol, Aspirin, kháng sinh...)
- TREATMENT: phương pháp điều trị (phẫu thuật, hóa trị, xạ trị...)
- BODY_PART: bộ phận cơ thể (phổi, gan, tim, não, tế bào thần kinh...)
- TEST: xét nghiệm/chẩn đoán (X-quang, MRI, xét nghiệm máu...)
- VALUE: chỉ số y khoa (39°C, 120/80 mmHg, 5mg...)
- DOCTOR: tên bác sĩ
- PATIENT: thông tin bệnh nhân
- LOCATION: địa điểm (bệnh viện, thành phố...)
- DATE: ngày tháng

Văn bản:
{text}
"""
    if feedback:
        prompt += f"\nLưu ý bổ sung: {feedback}\n"

    prompt += """
Chỉ trả về JSON, không giải thích:
{"entities": [{"text": "tên thực thể nguyên văn trong đoạn", "label": "DISEASE"}]}

Quan trọng:
- "text" phải là chuỗi xuất hiện NGUYÊN VĂN trong đoạn văn bản trên
- Không tự ý thêm hay bớt ký tự
- Không trả về start/end, chỉ cần text và label
"""
    return prompt


def resolve_positions(full_text: str, entities: list) -> list:
    """Tìm vị trí thực của entity trong text bằng string matching."""
    result = []
    used_ranges = []

    for e in entities:
        entity_text = e.get("text", "").strip()
        label = e.get("label", "")
        if not entity_text or not label:
            continue

        # Tìm tất cả vị trí xuất hiện, chọn cái chưa bị dùng
        start = 0
        while True:
            pos = full_text.find(entity_text, start)
            if pos == -1:
                break
            end = pos + len(entity_text)
            # Kiểm tra overlap với entities đã có
            overlap = any(not (end <= r[0] or pos >= r[1]) for r in used_ranges)
            if not overlap:
                used_ranges.append((pos, end))
                result.append({"text": entity_text, "label": label, "start": pos, "end": end})
                break
            start = pos + 1

    return sorted(result, key=lambda x: x["start"])


def chunk_text(text: str, size: int = CHUNK_SIZE) -> list[tuple[str, int]]:
    """Chia text thành các đoạn, trả về (chunk, offset)."""
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        # Cắt tại dấu xuống dòng gần nhất để không cắt giữa câu
        if end < len(text):
            newline = text.rfind('\n', start, end)
            if newline > start:
                end = newline + 1
        chunks.append((text[start:end], start))
        start = end
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


@app.post("/api/label")
async def label_text(req: LabelRequest):
    try:
        chunks = chunk_text(req.text)
        all_entities = []

        for chunk, offset in chunks:
            prompt = build_prompt(chunk)
            result = call_groq(prompt)
            raw_entities = result.get("entities", [])
            # Resolve positions trong chunk rồi cộng offset
            positioned = resolve_positions(chunk, raw_entities)
            for e in positioned:
                e["start"] += offset
                e["end"] += offset
            all_entities.extend(positioned)

        return {"entities": all_entities, "filename": req.filename}
    except Exception as ex:
        raise HTTPException(status_code=500, detail=str(ex))


@app.post("/api/relabel")
async def relabel_text(req: RelabelRequest):
    try:
        chunks = chunk_text(req.text)
        all_entities = []

        for chunk, offset in chunks:
            prompt = build_prompt(chunk, req.feedback)
            result = call_groq(prompt)
            raw_entities = result.get("entities", [])
            positioned = resolve_positions(chunk, raw_entities)
            for e in positioned:
                e["start"] += offset
                e["end"] += offset
            all_entities.extend(positioned)

        return {"entities": all_entities, "filename": req.filename}
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
