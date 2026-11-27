#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(rc)?$ ]]; then
  echo "Usage: $0 <version>" >&2
  exit 2
fi
version=$1
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

for tool in go npm dpkg-deb pkg-config cc; do
  command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }
done

# Build the embedded frontend from source; this repository intentionally has no npm lockfile.
(
  cd frontend
  npm install --no-audit --no-fund --package-lock=false
  npm run build
)

build_time=$(date -u +%Y-%m-%dT%H:%M:%SZ)
export GOTOOLCHAIN=${GOTOOLCHAIN:-go1.23.12}
go test -tags webkit2_41 ./...
go run github.com/wailsapp/wails/v2/cmd/wails@v2.9.2 build -s \
  -platform linux/amd64 -tags webkit2_41 \
  -ldflags "-X main.buildVersion=$version -X main.buildTime=$build_time" \
  -o dodrag

binary="$root/build/bin/dodrag"
if [[ ! -x "$binary" ]]; then
  echo "Wails output missing or not executable: $binary" >&2
  exit 1
fi

staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
package_root="$staging/package"
install -d "$package_root/DEBIAN" "$package_root/opt/dodrag" \
  "$package_root/usr/share/doc/dodrag" "$package_root/usr/share/applications" \
  "$package_root/usr/share/icons/hicolor/512x512/apps"
install -m 0755 "$binary" "$package_root/opt/dodrag/dodrag"
install -m 0644 LICENSE "$package_root/usr/share/doc/dodrag/copyright"
install -m 0644 frontend/src/assets/app-icon.png \
  "$package_root/usr/share/icons/hicolor/512x512/apps/dodrag.png"
cat > "$package_root/DEBIAN/control" <<EOF
Package: dodrag
Version: $version
Section: utils
Priority: optional
Architecture: amd64
Maintainer: Kolja Sulimma <kolja@cronologic.de>
Depends: libgtk-3-0t64, libwebkit2gtk-4.1-0
Description: Focus-first local task manager
 DoDrag is a native task manager designed to show only tasks that can be acted
 on now. It stores task data locally in SQLite.
EOF
cat > "$package_root/usr/share/applications/dodrag.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=DoDrag
Comment=Focus-first local task manager
Exec=/opt/dodrag/dodrag
Icon=dodrag
Terminal=false
Categories=Office;ProjectManagement;
StartupWMClass=dodrag
EOF
mkdir -p build/bin
package="$root/build/bin/dodrag_${version}_amd64.deb"
dpkg-deb --build --root-owner-group "$package_root" "$package"
dpkg-deb --info "$package"
test "$(dpkg-deb -f "$package" Architecture)" = amd64
test "$(dpkg-deb -f "$package" Depends)" = 'libgtk-3-0t64, libwebkit2gtk-4.1-0'
contents=$(dpkg-deb --contents "$package")
grep -q './opt/dodrag/dodrag' <<<"$contents"
grep -q './usr/share/applications/dodrag.desktop' <<<"$contents"
printf '%s\n' "$contents"
printf 'Created %s\n' "$package"
