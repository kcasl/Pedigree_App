from google.auth.transport import requests
from google.oauth2 import id_token
from copy import deepcopy
import json
from urllib import error, request
from sqlalchemy.orm import Session

from .config import settings
from .models import PedigreeSnapshot, User
from .schemas import GoogleLoginRequest


def verify_google_identity(payload: GoogleLoginRequest) -> dict:
    if payload.id_token and settings.google_client_id:
        token_info = id_token.verify_oauth2_token(
            payload.id_token,
            requests.Request(),
            settings.google_client_id,
        )
        return {
            "google_sub": token_info.get("sub"),
            "email": token_info.get("email"),
            "name": token_info.get("name"),
            "photo_url": token_info.get("picture"),
        }

    # Local/dev fallback when id_token verification is unavailable
    return {
        "google_sub": payload.google_sub,
        "email": payload.email,
        "name": payload.name,
        "photo_url": payload.photo_url,
    }


def verify_google_access_token(access_token: str) -> dict:
    req = request.Request(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    try:
        with request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return {
                "google_sub": data.get("sub"),
                "email": data.get("email"),
                "name": data.get("name"),
                "photo_url": data.get("picture"),
            }
    except error.HTTPError as exc:
        raise ValueError("invalid_google_access_token") from exc
    except Exception as exc:  # noqa: BLE001
        raise ValueError("google_access_token_verify_failed") from exc


def upsert_user(db: Session, identity: dict) -> User:
    user = db.query(User).filter(User.google_sub == identity["google_sub"]).first()
    if user:
        user.email = identity["email"]
        user.name = identity.get("name")
        user.photo_url = identity.get("photo_url")
        db.commit()
        db.refresh(user)
        return user

    user = User(
        google_sub=identity["google_sub"],
        email=identity["email"],
        name=identity.get("name"),
        photo_url=identity.get("photo_url"),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_user_by_google_sub(db: Session, google_sub: str) -> User | None:
    return db.query(User).filter(User.google_sub == google_sub).first()


def get_snapshot(db: Session, user_id: int) -> PedigreeSnapshot | None:
    return db.query(PedigreeSnapshot).filter(PedigreeSnapshot.user_id == user_id).first()


def upsert_snapshot(db: Session, user_id: int, people_by_id: dict) -> PedigreeSnapshot:
    snapshot = get_snapshot(db, user_id)
    if snapshot:
        snapshot.people_json = people_by_id
        db.commit()
        db.refresh(snapshot)
        return snapshot

    snapshot = PedigreeSnapshot(user_id=user_id, people_json=people_by_id)
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot


def delete_snapshot(db: Session, user_id: int) -> bool:
    snapshot = get_snapshot(db, user_id)
    if not snapshot:
        return False
    db.delete(snapshot)
    db.commit()
    return True


def apply_snapshot_patch(
    db: Session,
    user_id: int,
    upserts: dict,
    deletes: list[str],
) -> PedigreeSnapshot:
    snapshot = get_snapshot(db, user_id)
    if snapshot:
        current = deepcopy(snapshot.people_json) if isinstance(snapshot.people_json, dict) else {}
    else:
        current = {}

    for delete_id in deletes:
        current.pop(delete_id, None)

    for key, value in upserts.items():
        current[key] = value

    return upsert_snapshot(db, user_id, current)
