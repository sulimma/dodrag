#!/usr/bin/env bash
# Build a local Debian package on the target Questing ABI; never install or start it.
set -euo pipefail
export LC_ALL=C

usage() { echo "Usage: $0 <X.Y.Z[rc]> [--test]" >&2; exit 2; }
[[ $# -ge 1 && $# -le 2 && ( $# -eq 1 || $2 == --test ) ]] || usage
version=$1
[[ $version =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(rc)?$ ]] || usage
# Debian must sort a prerelease below its corresponding final version.
deb_version=${version%rc}
[[ $version != *rc ]] || deb_version+=~rc
deb_version+=-1

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
root=$PWD
# shellcheck source=/dev/null
. /etc/os-release
if [[ ${ID:-} != ubuntu || ${VERSION_CODENAME:-} != questing || $(uname -m) != x86_64 || $(dpkg --print-architecture) != amd64 ]]; then
    echo 'Build on Ubuntu/Kubuntu 25.10 (Questing), amd64.' >&2
    exit 1
fi
for tool in go npm gcc pkg-config dpkg-deb dpkg-shlibdeps readelf desktop-file-validate; do
    command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }
done
pkg-config --exists gtk+-3.0 webkit2gtk-4.1 || { echo 'GTK3 and WebKitGTK 4.1 development files are required.' >&2; exit 1; }

out_dir="$root/build/bin"
mkdir -p -- "$out_dir"
stage=$(mktemp -d "$out_dir/.linux-XXXXXX")
trap 'rm -rf -- "$stage"' EXIT

# The repository does not commit a frontend lockfile.
(cd frontend && npm install --package-lock=false --no-audit --no-fund && npm run build)
export CGO_ENABLED=1 GOOS=linux GOARCH=amd64
if [[ ${2:-} == --test ]]; then
    (cd frontend && npm test)
    go test -tags webkit2_41 ./...
    go test -tags desktop,production,webkit2_41 ./...
fi
pkg="$stage/package"
build_time=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
install -d "$pkg/DEBIAN" "$pkg/usr/bin"
# Match Wails production tags and select Questing's available WebKitGTK API.
go build -mod=readonly -tags desktop,production,webkit2_41 -trimpath \
    -ldflags "-s -w -X main.buildVersion=$version -X main.buildTime=$build_time" \
    -o "$pkg/usr/bin/dodrag" .
readelf -h "$pkg/usr/bin/dodrag" | grep -q 'Advanced Micro Devices X86-64'
install -Dm644 build/linux/dodrag.desktop "$pkg/usr/share/applications/dodrag.desktop"
desktop-file-validate "$pkg/usr/share/applications/dodrag.desktop"
install -Dm644 frontend/src/assets/app-icon.png "$pkg/usr/share/icons/hicolor/512x512/apps/dodrag.png"
install -Dm644 LICENSE "$pkg/usr/share/doc/dodrag/copyright"

# Derive the actual runtime dependency names and minimum versions from the target distro.
mkdir "$stage/debian"
printf 'Source: dodrag\n\nPackage: dodrag\nArchitecture: amd64\n' > "$stage/debian/control"
deps=$(cd "$stage" && dpkg-shlibdeps -O -e package/usr/bin/dodrag)
[[ $deps == shlibs:Depends=*libwebkit2gtk-4.1-0* ]] || { echo "Wrong WebKitGTK dependency: $deps" >&2; exit 1; }
cat > "$pkg/DEBIAN/control" <<EOF
Package: dodrag
Version: $deb_version
Section: utils
Priority: optional
Architecture: amd64
Maintainer: Kolja <kolja@cronologic.de>
Depends: ${deps#shlibs:Depends=}, xdg-utils
Description: Put aside and resume small tasks
 DoDrag is a desktop application for quick task deferral and recovery.
EOF

# Validate metadata before publishing the package locally; never clobber an existing build.
filename="dodrag_${deb_version}_amd64.deb"
dpkg-deb --root-owner-group --build "$pkg" "$stage/$filename"
[[ $(dpkg-deb -f "$stage/$filename" Package) == dodrag ]]
[[ $(dpkg-deb -f "$stage/$filename" Architecture) == amd64 ]]
[[ $(dpkg-deb -f "$stage/$filename" Version) == "$deb_version" ]]
ln -T -- "$stage/$filename" "$out_dir/$filename"
printf 'Built %s (not installed or started)\n' "$out_dir/$filename"
