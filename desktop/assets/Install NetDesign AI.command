#!/bin/bash
# Double-click this file to install NetDesign AI without the "damaged" error.

set -e
APP="NetDesign AI.app"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "============================================"
echo "  NetDesign AI Installer"
echo "============================================"
echo ""

# Find the .app — either next to this script (DMG) or in Downloads
if [ -d "$SCRIPT_DIR/$APP" ]; then
  SRC="$SCRIPT_DIR/$APP"
elif [ -d "$HOME/Downloads/$APP" ]; then
  SRC="$HOME/Downloads/$APP"
else
  echo "ERROR: Could not find '$APP'."
  echo "Make sure this script is in the same folder as the app."
  read -p "Press Enter to close..."
  exit 1
fi

DEST="/Applications/$APP"

echo "1. Copying to /Applications..."
cp -r "$SRC" "$DEST" 2>/dev/null && echo "   Done." || {
  echo "   Already exists — updating..."
  rm -rf "$DEST"
  cp -r "$SRC" "$DEST"
}

echo "2. Clearing macOS security quarantine..."
xattr -cr "$DEST"
echo "   Done."

echo "3. Opening NetDesign AI..."
open "$DEST"

echo ""
echo "============================================"
echo "  Installation complete!"
echo "  NetDesign AI is starting..."
echo "============================================"
echo ""
echo "  FIRST LAUNCH: You need Colima running."
echo "  If not installed yet, open a new Terminal"
echo "  and run:"
echo ""
echo "    brew install colima docker"
echo "    colima start"
echo ""
read -p "Press Enter to close this window..."
