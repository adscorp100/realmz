# Copies web/index.html into the build directory with @BUILD_ID@ replaced, so
# every build's CSS/JS/wasm/data URLs are unique and no browser or CDN cache
# can mix files from different builds.
string(TIMESTAMP BUILD_ID "%Y%m%d%H%M%S" UTC)
file(READ "${SRC}" html)
string(REPLACE "@BUILD_ID@" "${BUILD_ID}" html "${html}")
file(WRITE "${DST}" "${html}")
