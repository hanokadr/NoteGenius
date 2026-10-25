"""Settings for NoteGenius. Values come from the .env file (see .env.example)."""
import os
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DATABASE_NAME = os.getenv("DATABASE_NAME", "note_genius")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gpt-oss:20b-cloud")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", "300"))  # seconds

MAX_TITLE_CHARS = 120
MIN_NOTES_CHARS = 20
MAX_NOTES_CHARS = 12000

# Server and CORS (which frontend addresses may call this API)
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "5000"))
FRONTEND_ORIGINS = [o.strip() for o in os.getenv(
    "FRONTEND_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500").split(",") if o.strip()]

# File upload
MAX_UPLOAD_MB = 20
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
