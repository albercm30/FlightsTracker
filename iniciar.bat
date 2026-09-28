@echo off
REM Arranque rapido en Windows: doble clic en este archivo.
cd /d "%~dp0"
if not exist .venv (
  echo Creando entorno de Python...
  python -m venv .venv || (echo Instala Python 3.10+ desde python.org y marca "Add to PATH" & pause & exit /b 1)
)
call .venv\Scripts\activate.bat
pip install -q -r requirements.txt
start "" http://localhost:8000
python -m app
pause
