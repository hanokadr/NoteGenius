# NoteGenius – AI Notes Summarizer

Paste study notes, get an AI summary with key points, concepts and a conclusion, then save, search, open and delete notes. Backend and frontend are separate.

```text
notegenius/
├── .gitignore
├── README.md
├── backend/                  Flask REST API (Ollama + MongoDB)
│   ├── app.py
│   ├── config.py
│   ├── requirements.txt
│   ├── .env.example   →  copy to .env
│   └── services/ (__init__.py, ollama_service.py, notes_service.py)
└── frontend/public/          Website: index.html, config.js, css/style.css, js/app.js
```
The browser (frontend, port 5500) calls the Flask API (backend, port 5000). `FRONTEND_ORIGINS` in `backend/.env` must contain the address you open in the browser.

## Environment (backend/.env)
```env
BACKEND_PORT=5000
FRONTEND_ORIGINS=http://127.0.0.1:5500,http://localhost:5500
MONGO_URI=mongodb://localhost:27017/
DATABASE_NAME=note_genius
OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=gpt-oss:20b-cloud
OLLAMA_TIMEOUT=180
```
The frontend has no `.env`. Its only setting, the backend address, is in `frontend/public/config.js`.

## Setup on Windows (VS Code)
1. Install Python 3 (tick *Add python.exe to PATH*) and MongoDB Community Server (as a service).
2. Install Ollama, then run `ollama signin` and `ollama run gpt-oss:20b-cloud` once.
3. Check MongoDB is running: `Get-Service MongoDB` (if stopped, run `net start MongoDB` as Administrator).

**Terminal 1 – backend**
```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python app.py
```
**Terminal 2 – frontend** (no install needed)
```powershell
cd frontend
python -m http.server 5500 --directory public
```
Or use the VS Code *Live Server* extension: right-click `frontend/public/index.html` → Open with Live Server.

Open http://127.0.0.1:5500. Either paste your notes, or click **Upload notes file** (or drop a .txt, .md, .pdf or .docx file, up to 20 MB) and it is summarized automatically. The note is saved to MongoDB automatically after summarizing (untick *Save to MongoDB automatically* if you prefer the **Save Notes** button). Scanned PDFs and images are not supported. Use the sidebar to search, open and delete saved notes.

## Common errors
| Problem | Fix |
|---|---|
| Activation blocked | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then activate again |
| `ModuleNotFoundError` | Activate the venv and run `pip install -r requirements.txt` in `backend` |
| "Cannot reach the NoteGenius backend" | Start the backend; check `API_BASE_URL` in `config.js` |
| CORS error in the browser console | Add the address from the browser's address bar to `FRONTEND_ORIGINS`, restart the backend |
| "Cannot reach the database" | Start MongoDB; check `MONGO_URI` |
| "Cannot connect to Ollama" | Start Ollama (open the app or run `ollama serve`) |
| "Model ... is not available" | Run `ollama signin`, then `ollama run gpt-oss:20b-cloud` |
| "AI took too long" | Use shorter notes or raise `OLLAMA_TIMEOUT`, then restart the backend |
| Port already in use | Close the other program, or change the port (and `FRONTEND_ORIGINS` / `config.js`) |
| Changed `.env` but nothing changed | Stop the backend with Ctrl+C and start it again |

## Upload to GitHub
```powershell
git init
git add .
git status        # .env must NOT be listed
git commit -m "NoteGenius: AI notes summarizer"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/notegenius.git
git push -u origin main
```
