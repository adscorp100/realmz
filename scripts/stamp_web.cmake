# Copies web files that reference other assets into the build directory with
# @BUILD_ID@ replaced, so every build's asset URLs are unique and no browser
# or CDN cache can mix files from different builds. SRC_DIR and DST_DIR are
# directories; FILES is a ;-separated list of names within them.
string(TIMESTAMP BUILD_ID "%Y%m%d%H%M%S" UTC)
foreach(name ${FILES})
  file(READ "${SRC_DIR}/${name}" text)
  string(REPLACE "@BUILD_ID@" "${BUILD_ID}" text "${text}")
  file(WRITE "${DST_DIR}/${name}" "${text}")
endforeach()
