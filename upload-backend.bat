@echo off
echo ==============================================
echo   VEDAINVPRO Backend GitHub Upload Helper
echo ==============================================
echo.

:: Check if git is installed
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Git is not installed or not added to your PATH.
    echo Please install Git from https://git-scm.com and try again.
    pause
    exit /b
)

:: Check if already initialized
if not exist .git (
    echo [INFO] Initializing Git repository...
    git init
) else (
    echo [INFO] Git repository already initialized.
)

:: Add files
echo [INFO] Adding files to commit...
git add .

:: Check if git author is configured
git config user.email >nul 2>nul
if %errorlevel% neq 0 (
    echo [INFO] Git identity not found. Setting local repository fallback...
    git config user.name "vedtech31"
    git config user.email "contact@vedtech.in"
)

:: Commit
echo [INFO] Committing files...
git commit -m "Initial commit: VEDAINVPRO Backend"

:: Target repository configured by Antigravity
set REPO_URL=https://github.com/vedtech31/vedainvpro-backend.git
echo [INFO] Target repository: %REPO_URL%

if "%REPO_URL%"=="" (
    echo [ERROR] Repository URL cannot be empty.
    pause
    exit /b
)

:: Set branch to main
git branch -M main

:: Add remote origin (remove if exists first to avoid conflict)
git remote remove origin >nul 2>nul
git remote add origin %REPO_URL%

echo.
echo [INFO] Pushing files to GitHub main branch...
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ==============================================
    echo [SUCCESS] Backend project successfully uploaded!
    echo ==============================================
) else (
    echo.
    echo [WARNING] Push failed. If you haven't logged into GitHub on your machine,
    echo please sign in through the prompt and run: git push -u origin main
)

pause
