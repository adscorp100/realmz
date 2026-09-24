#!/usr/bin/env bash
# Builds the browser (WebAssembly) version of Realmz into build_web/.
#
# Requires: emscripten (emcc/emcmake), cmake, ninja, git. On macOS:
#   brew install emscripten cmake ninja
# Emscripten needs Python 3.10+; set EMSDK_PYTHON if the default python3 is older.
#
# phosg and resource_dasm are cloned at the commits pinned in README.md and
# built for wasm into build_web_deps/prefix.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPS="$ROOT/build_web_deps"
PREFIX="$DEPS/prefix"
BUILD_TYPE="${BUILD_TYPE:-Release}"

PHOSG_COMMIT=b2e0c12edb7e274a5e20c460f44eee44f49f57ef
RESOURCE_DASM_COMMIT=27f64c89a5fed855e68c2a5e97b6c6c389d8eb19

mkdir -p "$DEPS"
SYSROOT="$(em-config CACHE)/sysroot"

fetch() {
  local name="$1" url="$2" commit="$3"
  if [ ! -d "$DEPS/$name" ]; then
    git clone -q "$url" "$DEPS/$name"
  fi
  git -C "$DEPS/$name" checkout -q "$commit"
}

build_dep() {
  local name="$1"
  emcmake cmake -S "$DEPS/$name" -B "$DEPS/build-$name" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DCMAKE_PREFIX_PATH="$PREFIX" \
    -DCMAKE_FIND_ROOT_PATH="$PREFIX" \
    "-DCMAKE_CXX_FLAGS=-fexceptions -sUSE_ZLIB=1" \
    "-DCMAKE_C_FLAGS=-sUSE_ZLIB=1" \
    -DZLIB_LIBRARY=z \
    -DZLIB_INCLUDE_DIR="$SYSROOT/include"
  cmake --build "$DEPS/build-$name"
  cmake --install "$DEPS/build-$name"
}

if [ ! -f "$PREFIX/lib/libresource_file.a" ]; then
  fetch phosg https://github.com/fuzziqersoftware/phosg.git "$PHOSG_COMMIT"
  if ! git -C "$DEPS/phosg" diff --quiet; then
    git -C "$DEPS/phosg" checkout -q -- .
  fi
  git -C "$DEPS/phosg" apply "$ROOT/scripts/phosg-emscripten.patch"
  build_dep phosg

  fetch resource_dasm https://github.com/fuzziqersoftware/resource_dasm.git "$RESOURCE_DASM_COMMIT"
  build_dep resource_dasm
fi

emcmake cmake -S "$ROOT" -B "$ROOT/build_web" -G Ninja \
  -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
  -DBUILD_SHARED_LIBS=OFF \
  -DSDLTTF_VENDORED=ON \
  -DSDLIMAGE_VENDORED=OFF \
  -DSDLIMAGE_AVIF=OFF \
  -DSDLIMAGE_JXL=OFF \
  -DSDLIMAGE_TIF=OFF \
  -DSDLIMAGE_WEBP=OFF \
  -DCMAKE_PREFIX_PATH="$PREFIX" \
  -DCMAKE_FIND_ROOT_PATH="$PREFIX"
cmake --build "$ROOT/build_web" --target Realmz

echo
echo "Built $ROOT/build_web. Serve it with:"
echo "  python3 -m http.server 8765 --directory \"$ROOT/build_web\""
echo "then open http://localhost:8765/"
