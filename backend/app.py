"""NoteGenius backend (REST API only). Run with:  python app.py"""
import logging

from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

import config
from services import file_service, notes_service, ollama_service
from services.file_service import FileError
from services.notes_service import NotesError
from services.ollama_service import OllamaError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = config.MAX_UPLOAD_BYTES + 1024 * 1024  # reject very large requests
CORS(app, origins=config.FRONTEND_ORIGINS)     # lets the frontend (another port) call this API


def json_body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise NotesError("The request must contain valid JSON.", 400)
    return data


@app.errorhandler(NotesError)
@app.errorhandler(OllamaError)
@app.errorhandler(FileError)
def handle_known_error(err):
    return jsonify({"error": err.message}), err.status


@app.errorhandler(Exception)
def handle_unexpected_error(err):
    if isinstance(err, HTTPException):
        if err.code == 413:
            return jsonify({"error": f"The file is too large (maximum {config.MAX_UPLOAD_MB} MB)."}), 413
        return jsonify({"error": err.description}), err.code
    app.logger.error("Unexpected error: %s", type(err).__name__)
    return jsonify({"error": "Something went wrong on the server."}), 500


@app.get("/")
def home():
    return jsonify({"status": "NoteGenius API is running"})


@app.post("/api/upload")
def upload_file():
    """Read text from an uploaded notes file. Nothing is summarized or saved here."""
    return jsonify(file_service.extract_text(request.files.get("file")))


@app.post("/api/summarize")
def summarize():
    title, text = notes_service.validate_input(json_body())
    return jsonify(ollama_service.generate_summary(title, text))  # not saved yet


@app.post("/api/notes")
def save_note():
    saved = notes_service.save_note(json_body())
    message = "This note was already saved." if saved["duplicate"] else "Note saved successfully."
    return jsonify({"id": saved["id"], "message": message}), (200 if saved["duplicate"] else 201)


@app.get("/api/notes")
def list_notes():
    return jsonify({"notes": notes_service.list_notes(request.args.get("q", "").strip())})


@app.get("/api/notes/<note_id>")
def get_note(note_id):
    return jsonify(notes_service.get_note(note_id))


@app.delete("/api/notes/<note_id>")
def delete_note(note_id):
    notes_service.delete_note(note_id)
    return jsonify({"message": "Note deleted."})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=config.BACKEND_PORT, debug=False)
