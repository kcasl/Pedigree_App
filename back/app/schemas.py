from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field


class GoogleLoginRequest(BaseModel):
    id_token: str | None = None
    google_sub: str | None = None
    email: EmailStr | None = None
    name: str | None = None
    photo_url: str | None = None


class UserResponse(BaseModel):
    id: int
    google_sub: str
    email: EmailStr
    name: str | None
    photo_url: str | None
    created_at: datetime
    updated_at: datetime


class SnapshotUpsertRequest(BaseModel):
    people_by_id: dict[str, Any] = Field(default_factory=dict)


class SnapshotPatchRequest(BaseModel):
    upserts: dict[str, Any] = Field(default_factory=dict)
    deletes: list[str] = Field(default_factory=list)
    compressed: bool = False
    payload_b64: str | None = None


class SnapshotResponse(BaseModel):
    user_id: int
    people_by_id: dict[str, Any]
    updated_at: datetime
