"""Saves, finds and deletes notes in MongoDB (database: note_genius, collection: notes)."""
import functools
import logging
import re
from datetime import datetime, timezone

from bson import ObjectId
from pymongo import DESCENDING, MongoClient
from pymongo.errors import PyMongoError

import config
from services.ollama_service import clean_result

logger = logging.getLogger(__name__)
_collection = None


class NotesError(Exception):
    """A problem with a message that is safe to show to the user."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def _notes():
    """Connect on first use, so the app can start even if MongoDB is off."""
    global _collection
    if _collection is None:
        client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=3000, tz_aware=True)
        collection = client[config.DATABASE_NAME]["notes"]
        collection.create_index([("created_at", DESCENDING)])
        collection.create_index("title")
        _collection = collection
    return _collection


def _guard(func):
    """Turn any MongoDB failure into a friendly error."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except PyMongoError as err:
            logger.error("MongoDB operation failed in %s (%s)", func.__name__, type(err).__name__)
            raise NotesError("Cannot reach the database. Make sure MongoDB is running.", 503)
    return wrapper


def _object_id(note_id):
    if not ObjectId.is_valid(note_id):
        raise NotesError("Invalid note ID.", 400)
    return ObjectId(note_id)


def validate_input(data):
    """Validate the title and notes text. Returns (title, text)."""
    title = str(data.get("title") or "").strip()
    text = str(data.get("original_text") or "").strip()
    if not title:
        raise NotesError("Please enter a title for your notes.")
    if len(title) > config.MAX_TITLE_CHARS:
        raise NotesError(f"The title must be {config.MAX_TITLE_CHARS} characters or fewer.")
    if not text:
        raise NotesError("Please paste your study notes first.")
    if len(text) < config.MIN_NOTES_CHARS:
        raise NotesError(f"The notes are too short to summarize (minimum {config.MIN_NOTES_CHARS} characters).")
    if len(text) > config.MAX_NOTES_CHARS:
        raise NotesError(f"The notes are too long (maximum {config.MAX_NOTES_CHARS} characters).")
    return title, text


def _iso(value):
    return value.isoformat() if value else None


@_guard
def save_note(data):
    title, text = validate_input(data)
    try:
        result = clean_result(data)
    except ValueError:
        raise NotesError("The summary is incomplete, so the note was not saved.")

    # Same note already saved (for example a double click)? Return it instead of adding another.
    existing = _notes().find_one(
        {"title": title, "original_text": text, "summary": result["summary"]}, {"_id": 1})
    if existing:
        return {"id": str(existing["_id"]), "duplicate": True}

    now = datetime.now(timezone.utc)
    document = {"title": title, "original_text": text, **result, "created_at": now, "updated_at": now}
    inserted = _notes().insert_one(document)
    return {"id": str(inserted.inserted_id), "duplicate": False}


@_guard
def list_notes(query=""):
    filters = {}
    if query:
        pattern = {"$regex": re.escape(query[:100]), "$options": "i"}
        filters = {"$or": [{"title": pattern}, {"original_text": pattern}]}
    cursor = _notes().find(filters, {"title": 1, "summary": 1, "created_at": 1}) \
        .sort("created_at", DESCENDING).limit(100)
    return [
        {
            "id": str(doc["_id"]),
            "title": doc.get("title", ""),
            "created_at": _iso(doc.get("created_at")),
            "preview": doc.get("summary", "")[:140],
        }
        for doc in cursor
    ]


@_guard
def get_note(note_id):
    doc = _notes().find_one({"_id": _object_id(note_id)})
    if not doc:
        raise NotesError("Note not found.", 404)
    doc["id"] = str(doc.pop("_id"))
    doc["created_at"] = _iso(doc.get("created_at"))
    doc["updated_at"] = _iso(doc.get("updated_at"))
    return doc


@_guard
def delete_note(note_id):
    result = _notes().delete_one({"_id": _object_id(note_id)})
    if result.deleted_count == 0:
        raise NotesError("Note not found.", 404)
