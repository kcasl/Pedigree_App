# Pedigree FastAPI Backend

## 1) Install

```bash
pip install -r requirements.txt
```

## 2) Environment

Copy `.env.example` to `.env` and edit values.

```bash
DB_HOST=13.209.15.25
DB_PORT=3306
DB_USER=pedigree_app
DB_PASSWORD=your_password
DB_NAME=pedigree_app
GOOGLE_CLIENT_ID=1086441770395-u066dpf25ppfjcktmtai6092p5e2pa6d.apps.googleusercontent.com
```

## 3) Run

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## 4) Endpoints

- `GET /health`
- `POST /v1/auth/google`
  - 권장: `Authorization: Bearer <google_access_token>`
  - Request: `{ "id_token": "..."}`
  - Dev fallback: `{ "google_sub": "...", "email": "...", "name": "...", "photo_url": "..." }`
- `GET /v1/pedigree/{google_sub}`
- `PUT /v1/pedigree/{google_sub}`
  - Request: `{ "people_by_id": { ... } }`
- `PATCH /v1/pedigree/{google_sub}`
  - 변경분만 저장
  - 권장 body: `{ "compressed": true, "payload_b64": "<gzip+base64>" }`
  - 압축 해제 원본 예시: `{ "upserts": { "id": {...} }, "deletes": ["id"] }`
- `DELETE /v1/pedigree/{google_sub}`
- `POST /v1/uploads/photo?google_sub=...` (multipart/form-data)
  - image 파일 업로드 + 서버에서 JPG 압축 저장
  - 응답: `{ "url": "http://.../uploads/....jpg" }`

`/v1/pedigree/*` 는 `Authorization: Bearer <google_access_token>` 헤더가 필요합니다.

## 5) SQL

Run `sql/schema.sql` in MySQL Workbench.
