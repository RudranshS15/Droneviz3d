@echo off
rem Finishes the storage relocation: re-syncs the copy, renames this folder
rem aside, puts a junction in its place, then deletes the old copy.
rem
rem It cd's to the parent folder first so no process holds the directory that
rem gets renamed. The Freebuff app must still be closed - it keeps the project
rem folder open for the entire session and Windows refuses to rename an open
rem directory. If it is running, the script says so and changes nothing.
cd /d "%~dp0..\.."

echo DroneViz3D - move storage to D:
echo.
echo   1. re-sync the copy at D:\DroneViz3D
echo   2. rename this folder aside and put a junction in its place
echo   3. delete the old copy (frees about 1 GB on C:)
echo.
echo Close the Freebuff app before continuing.
echo.
pause
node "%~dp0move-project-to-d.mjs" --finish
echo.
echo Finished. The project still opens at its original path.
pause
