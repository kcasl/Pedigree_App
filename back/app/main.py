import base64
import gzip
import io
import json
import os
import uuid

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image
from sqlalchemy.orm import Session

from .crud import (
    apply_snapshot_patch,
    delete_snapshot,
    get_snapshot,
    get_user_by_google_sub,
    upsert_snapshot,
    upsert_user,
    verify_google_access_token,
    verify_google_identity,
)
from .database import Base, engine, get_db
from .schemas import (
    GoogleLoginRequest,
    SnapshotPatchRequest,
    SnapshotResponse,
    SnapshotUpsertRequest,
    UserResponse,
)
from .config import settings

app = FastAPI(title="Pedigree API", version="1.0.0")
app.add_middleware(GZipMiddleware, minimum_size=1024)

os.makedirs(settings.upload_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        return None
    return authorization[len(prefix) :].strip() or None


def get_identity_from_access_token(authorization: str | None) -> dict | None:
    token = extract_bearer_token(authorization)
    if not token:
        return None
    return verify_google_access_token(token)


@app.post("/v1/auth/google", response_model=UserResponse)
def google_login(
    payload: GoogleLoginRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserResponse:
    identity = None
    try:
        identity = get_identity_from_access_token(authorization)
    except ValueError:
        raise HTTPException(status_code=401, detail="invalid access token")

    if not identity:
        try:
            identity = verify_google_identity(payload)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=401, detail="invalid id token") from exc
    if not identity.get("google_sub") or not identity.get("email"):
        raise HTTPException(status_code=400, detail="google_sub/email is required")

    user = upsert_user(db, identity)
    return UserResponse(
        id=user.id,
        google_sub=user.google_sub,
        email=user.email,
        name=user.name,
        photo_url=user.photo_url,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@app.get("/v1/pedigree/{google_sub}", response_model=SnapshotResponse)
def get_pedigree(
    google_sub: str,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> SnapshotResponse:
    try:
        identity = get_identity_from_access_token(authorization)
    except ValueError:
        raise HTTPException(status_code=401, detail="invalid access token")
    if not identity:
        raise HTTPException(status_code=401, detail="access token is required")
    if identity.get("google_sub") != google_sub:
        raise HTTPException(status_code=403, detail="forbidden")

    user = get_user_by_google_sub(db, google_sub)
    if not user:
        raise HTTPException(status_code=404, detail="user not found")

    snapshot = get_snapshot(db, user.id)
    return SnapshotResponse(
        user_id=user.id,
        people_by_id=snapshot.people_json if snapshot else {},
        updated_at=snapshot.updated_at if snapshot else user.updated_at,
    )


@app.put("/v1/pedigree/{google_sub}", response_model=SnapshotResponse)
def put_pedigree(
    google_sub: str,
    payload: SnapshotUpsertRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> SnapshotResponse:
    try:
        identity = get_identity_from_access_token(authorization)
    except ValueError:
        raise HTTPException(status_code=401, detail="invalid access token")
    if not identity:
        raise HTTPException(status_code=401, detail="access token is required")
    if identity.get("google_sub") != google_sub:
        raise HTTPException(status_code=403, detail="forbidden")

    user = get_user_by_google_sub(db, google_sub)
    if not user:
        raise HTTPException(status_code=404, detail="user not found")

    snapshot = upsert_snapshot(db, user.id, payload.people_by_id)
    return SnapshotResponse(
        user_id=user.id,
        people_by_id=snapshot.people_json,
        updated_at=snapshot.updated_at,
    )


@app.delete("/v1/pedigree/{google_sub}")
def remove_pedigree(
    google_sub: str,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    try:
        identity = get_identity_from_access_token(authorization)
    except ValueError:
        raise HTTPException(status_code=401, detail="invalid access token")
    if not identity:
        raise HTTPException(status_code=401, detail="access token is required")
    if identity.get("google_sub") != google_sub:
        raise HTTPException(status_code=403, detail="forbidden")

    user = get_user_by_google_sub(db, google_sub)
    if not user:
        raise HTTPException(status_code=404, detail="user not found")
    deleted = delete_snapshot(db, user.id)
    return {"deleted": deleted}


@app.patch("/v1/pedigree/{google_sub}", response_model=SnapshotResponse)
def patch_pedigree(
    google_sub: str,
    payload: SnapshotPatchRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> SnapshotResponse:
    try:
        identity = get_identity_from_access_token(authorization)
    except ValueError:
        raise HTTPException(status_code=401, detail="invalid access token")
    if not identity:
        raise HTTPException(status_code=401, detail="access token is required")
    if identity.get("google_sub") != google_sub:
        raise HTTPException(status_code=403, detail="forbidden")

    user = get_user_by_google_sub(db, google_sub)
    if not user:
        raise HTTPException(status_code=404, detail="user not found")

    upserts = payload.upserts
    deletes = payload.deletes

    if payload.compressed:
        if not payload.payload_b64:
            raise HTTPException(status_code=400, detail="payload_b64 is required when compressed")
        try:
            raw = base64.b64decode(payload.payload_b64.encode("utf-8"))
            decoded = gzip.decompress(raw).decode("utf-8")
            body = json.loads(decoded)
            upserts = body.get("upserts", {})
            deletes = body.get("deletes", [])
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="invalid compressed payload") from exc

    snapshot = apply_snapshot_patch(db, user.id, upserts, deletes)
    return SnapshotResponse(
        user_id=user.id,
        people_by_id=snapshot.people_json,
        updated_at=snapshot.updated_at,
    )


@app.post("/v1/uploads/photo")
async def upload_photo(
    google_sub: str,
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    try:
        identity = get_identity_from_access_token(authorization)
    except ValueError:
        raise HTTPException(status_code=401, detail="invalid access token")
    if not identity:
        raise HTTPException(status_code=401, detail="access token is required")
    if identity.get("google_sub") != google_sub:
        raise HTTPException(status_code=403, detail="forbidden")

    user = get_user_by_google_sub(db, google_sub)
    if not user:
        raise HTTPException(status_code=404, detail="user not found")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="only image file is allowed")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty file")

    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid image format") from exc

    # Resize and compress for bandwidth/storage efficiency.
    image.thumbnail((1280, 1280))
    filename = f"{google_sub}_{uuid.uuid4().hex}.jpg"
    save_path = os.path.join(settings.upload_dir, filename)
    image.save(save_path, format="JPEG", optimize=True, quality=80)

    return {"url": f"{settings.public_base_url.rstrip('/')}/uploads/{filename}"}
