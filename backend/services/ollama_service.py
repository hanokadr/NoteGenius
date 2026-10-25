"""Talks to the Ollama API and turns the model's reply into structured data."""
import json
import logging
import re

import requests

import config

logger = logging.getLogger(__name__)


class OllamaError(Exception):
    """An AI problem with a message that is safe to show to the user."""

    def __init__(self, message, status=502):
        super().__init__(message)
        self.message = message
        self.status = status


PROMPT_TEMPLATE = """You are a friendly study assistant for college students.
Turn the study notes below into easy, detailed study notes.

Rules:
- Use very simple words and short sentences, as if you are explaining to a beginner.
- Go through the notes from start to end. For EVERY sentence or idea in the notes, write one short, simple point. Do not skip any idea. Keep the same order as the notes. Use at most 40 points.
- Keep the original meaning. Do NOT add facts that are not in the notes.
- Put every important term in important_concepts with a simple meaning.
- Reply with ONLY one valid JSON object. No markdown and no code fences.

The JSON object must have exactly this shape:
{{
  "summary": "A simple overview in 3-5 short sentences.",
  "key_points": ["One simple point for each line or idea, in order", "Next point"],
  "important_concepts": [{{"term": "Term", "explanation": "Simple meaning in one short sentence."}}],
  "conclusion": "One or two simple sentences that wrap up the topic."
}}

Title: {title}

Study notes:
-----
{text}
-----
"""


def _text(value, limit):
    return value.strip()[:limit] if isinstance(value, str) else ""


def _list(value):
    return value if isinstance(value, list) else []


def clean_result(data):
    """Check and tidy a result dict. Raises ValueError if it is unusable."""
    if not isinstance(data, dict):
        raise ValueError("result is not an object")

    summary = _text(data.get("summary"), 3000)
    points = [_text(p, 400) for p in _list(data.get("key_points"))]
    points = [p for p in points if p][:40]

    concepts = []
    for item in _list(data.get("important_concepts")):
        if isinstance(item, dict):
            term = _text(item.get("term"), 100)
            explanation = _text(item.get("explanation"), 400)
            if term and explanation:
                concepts.append({"term": term, "explanation": explanation})

    if not summary or not points:
        raise ValueError("summary or key points missing")

    return {
        "summary": summary,
        "key_points": points,
        "important_concepts": concepts[:20],
        "conclusion": _text(data.get("conclusion"), 600),
    }


def _extract_json(raw):
    """Find the JSON object in the model's reply (it may add fences or extra text)."""
    raw = re.sub(r"^```(?:json)?|```$", "", (raw or "").strip(), flags=re.MULTILINE)
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON found")
    return json.loads(raw[start:end + 1])


def generate_summary(title, text):
    """Ask Ollama for a summary. Returns a dict or raises OllamaError."""
    payload = {
        "model": config.OLLAMA_MODEL,
        "prompt": PROMPT_TEMPLATE.format(title=title, text=text),
        "stream": False,
    }

    try:
        response = requests.post(config.OLLAMA_URL, json=payload, timeout=config.OLLAMA_TIMEOUT)
    except requests.exceptions.ConnectionError:
        raise OllamaError("Cannot connect to Ollama. Start Ollama and try again.", 503)
    except requests.exceptions.Timeout:
        raise OllamaError("The AI took too long to respond. Try shorter notes or try again.", 504)
    except requests.exceptions.RequestException:
        raise OllamaError("Could not reach the AI service.", 503)

    if response.status_code == 404:
        raise OllamaError(
            f"Model '{config.OLLAMA_MODEL}' is not available. Run 'ollama signin' and "
            f"'ollama run {config.OLLAMA_MODEL}' once, then try again.", 503)
    if response.status_code != 200:
        logger.error("Ollama returned HTTP %s", response.status_code)
        raise OllamaError("The AI service returned an error. Please try again.", 502)

    try:
        body = response.json()
        if body.get("error"):
            raise ValueError("ollama error")
        return clean_result(_extract_json(body.get("response")))
    except (ValueError, AttributeError):
        logger.error("Could not read the model response")
        raise OllamaError("The AI reply was incomplete or in the wrong format. Please try again.", 502)
