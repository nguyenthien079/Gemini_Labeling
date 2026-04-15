import json
import csv
import os
import re
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Medical NER Labeler")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
genai.configure(api_key=GEMINI_API_KEY)
gemini = genai.GenerativeModel(GEMINI_MODEL)

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


def parse_gemini_json(raw: str) -> dict:
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
    raise ValueError(f"Cannot parse JSON from Gemini response: {raw[:200]}")


def build_prompt(text: str, feedback: str = None) -> str:
    prompt = f"""Bạn là chuyên gia NER y tế tiếng Việt. Hãy xác định tất cả thực thể y tế trong văn bản.

Các loại thực thể:
- DISEASE: tên bệnh (COVID-19, ung thư, tiểu đường...)
- SYMPTOM: triệu chứng (sốt, ho, đau đầu, mệt mỏi...)
- MEDICATION: thuốc (Paracetamol, Aspirin, kháng sinh...)
- TREATMENT: phương pháp điều trị (phẫu thuật, hóa trị, xạ trị...)
- BODY_PART: bộ phận cơ thể (phổi, gan, tim, não...)
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
        prompt += f"\nLưu ý từ người dùng: {feedback}\n"

    prompt += """
Trả về JSON (chỉ JSON, không giải thích thêm):
{
  "entities": [
    {"text": "tên thực thể", "label": "DISEASE", "start": 0, "end": 10}
  ]
}

Quan trọng: start và end là vị trí ký tự (index) trong văn bản gốc.
"""
    return prompt


@app.get("/api/entity-types")
async def get_entity_types():
    return ENTITY_TYPES


@app.post("/api/label")
async def label_text(req: LabelRequest):
    try:
        prompt = build_prompt(req.text)
        response = gemini.generate_content(prompt)
        result = parse_gemini_json(response.text)
        entities = result.get("entities", [])
        # Verify positions match text
        verified = []
        for e in entities:
            s, end = e.get("start", 0), e.get("end", 0)
            if 0 <= s < end <= len(req.text):
                e["text"] = req.text[s:end]
                verified.append(e)
        return {"entities": verified, "filename": req.filename}
    except Exception as ex:
        raise HTTPException(status_code=500, detail=str(ex))


@app.post("/api/relabel")
async def relabel_text(req: RelabelRequest):
    try:
        prompt = build_prompt(req.text, req.feedback)
        response = gemini.generate_content(prompt)
        result = parse_gemini_json(response.text)
        entities = result.get("entities", [])
        verified = []
        for e in entities:
            s, end = e.get("start", 0), e.get("end", 0)
            if 0 <= s < end <= len(req.text):
                e["text"] = req.text[s:end]
                verified.append(e)
        return {"entities": verified, "filename": req.filename}
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
